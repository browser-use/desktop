import React, { useEffect, useRef } from 'react';
import { subscribeThemeMode, resolveThemeMode, getThemeMode } from '../design/themeMode';

const FRAME_INTERVAL_MS = 1000 / 12;

// Theme-paired palette for the WebGL dashboard background. Hardcoded floats
// (not CSS vars) because GLSL uniforms can't read from the cascade — but
// they're paired with the light/dark token philosophy in theme.global.css.
const PALETTE = {
  dark: {
    bg:  [0.055, 0.055, 0.067] as const,
    dot: [0.32,  0.38,  0.52]  as const,
    mix: 0.55,
  },
  light: {
    bg:  [0.929, 0.914, 0.886] as const, /* matches --color-bg-base #ede9e2 */
    dot: [0.30,  0.40,  0.58]  as const, /* slate-blue, deeper for paper bg */
    mix: 0.55,
  },
};

const VERTEX_SHADER = `#version 300 es
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

const FRAGMENT_SHADER = `#version 300 es
precision mediump float;
out vec4 fragColor;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_bg;
uniform vec3 u_dot;
uniform float u_mix;

// Sine band: density 0..1 from perpendicular distance to a sine curve across the width.
float sineBand(vec2 uv, float aspect, float t) {
  float x = uv.x * aspect;
  float width = aspect;
  // One wavelength across width. Very slow drift so it feels alive but nearly static.
  float phase = (x / width) * 6.2831853 + t * 0.12;
  float curveY = 0.5 + sin(phase) * 0.14 + sin(t * 0.25) * 0.01;
  float d = abs(uv.y - curveY);
  float thickness = 0.20;
  float band = 1.0 - smoothstep(0.0, thickness, d);
  return clamp(band, 0.0, 1.0);
}

void main() {
  float aspect = u_resolution.x / u_resolution.y;

  // Uniform dot lattice in pixel space.
  float DOT_SPACING = 12.0;
  float MAX_RADIUS  = 3.2;
  vec2 cell = floor(gl_FragCoord.xy / DOT_SPACING);
  vec2 cellCenter = (cell + 0.5) * DOT_SPACING;
  float distPx = length(gl_FragCoord.xy - cellCenter);

  // Sample density at each cell center so all pixels of one dot share the same size.
  vec2 cellUv = cellCenter / u_resolution;
  float density = sineBand(cellUv, aspect, u_time);

  // Nonlinear radius curve: stays small across most of the band, ramps up sharply near the peak.
  float sizeCurve = pow(density, 3.0);
  float radius = MAX_RADIUS * sizeCurve;
  float dotMask = 1.0 - smoothstep(radius - 0.6, radius + 0.4, distPx);
  // Kill dots where density is basically zero so the edges fade cleanly.
  dotMask *= smoothstep(0.02, 0.12, density);

  fragColor = vec4(mix(u_bg, u_dot, dotMask * u_mix), 1.0);
}
`;

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('createShader failed');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

export function DashboardBackground(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: false });
    if (!gl) {
      console.warn('[DashboardBackground] WebGL2 unavailable');
      return;
    }

    let program: WebGLProgram | null = null;
    let vs: WebGLShader | null = null;
    let fs: WebGLShader | null = null;
    try {
      vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
      fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      program = gl.createProgram();
      if (!program) throw new Error('createProgram failed');
      gl.attachShader(program, vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
      }
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      vs = null;
      fs = null;
    } catch (err) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      if (program) gl.deleteProgram(program);
      console.error('[DashboardBackground] shader setup failed', err);
      return;
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    const resLoc = gl.getUniformLocation(program, 'u_resolution');
    const timeLoc = gl.getUniformLocation(program, 'u_time');
    const bgLoc  = gl.getUniformLocation(program, 'u_bg');
    const dotLoc = gl.getUniformLocation(program, 'u_dot');
    const mixLoc = gl.getUniformLocation(program, 'u_mix');

    gl.useProgram(program);

    let palette = PALETTE[resolveThemeMode(getThemeMode())];
    const applyPalette = () => {
      gl.uniform3f(bgLoc,  palette.bg[0],  palette.bg[1],  palette.bg[2]);
      gl.uniform3f(dotLoc, palette.dot[0], palette.dot[1], palette.dot[2]);
      gl.uniform1f(mixLoc, palette.mix);
      // Pre-fill the framebuffer with the bg color so the first composited
      // frame already matches the theme — no black flash before render().
      gl.clearColor(palette.bg[0], palette.bg[1], palette.bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    };
    applyPalette();
    const unsubscribeTheme = subscribeThemeMode((_mode, resolved) => {
      palette = PALETTE[resolved];
      applyPalette();
      schedule();
    });

    const dpr = 1;

    const resize = () => {
      const w = canvas.clientWidth * dpr;
      const h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    let raf: number | null = null;
    let frameTimer: number | null = null;
    let running = true;
    let visible = true;
    const start = performance.now();

    const shouldRun = () => running && visible && !document.hidden;

    const cancelScheduledFrame = () => {
      if (frameTimer != null) {
        window.clearTimeout(frameTimer);
        frameTimer = null;
      }
      if (raf != null) {
        cancelAnimationFrame(raf);
        raf = null;
      }
    };

    const schedule = () => {
      if (!shouldRun()) return;
      if (frameTimer != null || raf != null) return;
      frameTimer = window.setTimeout(() => {
        frameTimer = null;
        raf = requestAnimationFrame(render);
      }, FRAME_INTERVAL_MS);
    };

    const render = () => {
      raf = null;
      if (!shouldRun()) return;
      const t = (performance.now() - start) / 1000;
      gl.uniform2f(resLoc, canvas.width, canvas.height);
      gl.uniform1f(timeLoc, t);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      schedule();
    };
    schedule();

    const onVisibility = () => {
      if (document.hidden) {
        cancelScheduledFrame();
      } else {
        schedule();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (!visible) {
        cancelScheduledFrame();
      } else {
        schedule();
      }
    });
    io.observe(canvas);

    return () => {
      running = false;
      cancelScheduledFrame();
      unsubscribeTheme();
      document.removeEventListener('visibilitychange', onVisibility);
      io.disconnect();
      ro.disconnect();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, []);

  return <canvas ref={canvasRef} className="dashboard__bg" aria-hidden="true" />;
}

export default DashboardBackground;
