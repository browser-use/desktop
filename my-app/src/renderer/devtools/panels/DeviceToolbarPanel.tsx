/**
 * DeviceToolbarPanel — responsive device emulation toolbar.
 *
 * Provides:
 *   - Device presets (iPhone, Pixel, iPad, etc.) with DPR
 *   - Rotate button (swaps width/height)
 *   - Network throttle presets
 *   - CPU throttle presets
 *   - Custom user-agent override
 */

import React, { useState, useCallback, useEffect } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────

const LOG_PREFIX = '[DeviceToolbarPanel]';

interface DevicePreset {
  name: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
  userAgent?: string;
}

const DEVICE_PRESETS: DevicePreset[] = [
  { name: 'iPhone SE', width: 375, height: 667, deviceScaleFactor: 2, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1' },
  { name: 'iPhone 14 Pro', width: 393, height: 852, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
  { name: 'iPhone 14 Pro Max', width: 430, height: 932, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
  { name: 'Pixel 7', width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36' },
  { name: 'Pixel 7 Pro', width: 480, height: 1040, deviceScaleFactor: 3.5, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36' },
  { name: 'Samsung Galaxy S23', width: 360, height: 780, deviceScaleFactor: 3, mobile: true, userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36' },
  { name: 'iPad Mini', width: 768, height: 1024, deviceScaleFactor: 2, mobile: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
  { name: 'iPad Air', width: 820, height: 1180, deviceScaleFactor: 2, mobile: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
  { name: 'iPad Pro 12.9"', width: 1024, height: 1366, deviceScaleFactor: 2, mobile: true, userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1' },
];

type NetworkThrottle = 'No throttling' | 'Fast 4G' | 'Slow 4G' | '3G' | 'Offline';
type CpuThrottle = 'No throttling' | '4x slowdown' | '6x slowdown';

interface NetworkThrottleConfig {
  downloadThroughput: number;
  uploadThroughput: number;
  latency: number;
  offline: boolean;
}

// Values in bytes/sec and ms. -1 means no limit.
const NETWORK_THROTTLE_CONFIGS: Record<NetworkThrottle, NetworkThrottleConfig> = {
  'No throttling': { downloadThroughput: -1, uploadThroughput: -1, latency: 0, offline: false },
  'Fast 4G':       { downloadThroughput: 4194304, uploadThroughput: 2097152, latency: 20, offline: false },
  'Slow 4G':       { downloadThroughput: 1572864, uploadThroughput: 786432,  latency: 38, offline: false },
  '3G':            { downloadThroughput: 393216,  uploadThroughput: 196608,  latency: 100, offline: false },
  'Offline':       { downloadThroughput: 0,       uploadThroughput: 0,       latency: 0, offline: true },
};

const CPU_THROTTLE_RATES: Record<CpuThrottle, number> = {
  'No throttling': 1,
  '4x slowdown':   4,
  '6x slowdown':   6,
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeviceToolbarPanelProps {
  sendCdp: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
  onClose: () => void;
}

interface DeviceState {
  preset: DevicePreset | null;
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
  rotated: boolean;
  networkThrottle: NetworkThrottle;
  cpuThrottle: CpuThrottle;
  userAgent: string;
}

const DEFAULT_STATE: DeviceState = {
  preset: null,
  width: 375,
  height: 667,
  deviceScaleFactor: 2,
  mobile: true,
  rotated: false,
  networkThrottle: 'No throttling',
  cpuThrottle: 'No throttling',
  userAgent: '',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function DeviceToolbarPanel({ sendCdp, onClose }: DeviceToolbarPanelProps): React.ReactElement {
  const [state, setState] = useState<DeviceState>(DEFAULT_STATE);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);
  const [uaInput, setUaInput] = useState('');
  const [uaDirty, setUaDirty] = useState(false);

  // ── Apply emulation via CDP ────────────────────────────────────────────────

  const applyEmulation = useCallback(async (s: DeviceState) => {
    console.log(LOG_PREFIX, 'applyEmulation', {
      preset: s.preset?.name ?? 'custom',
      width: s.rotated ? s.height : s.width,
      height: s.rotated ? s.width : s.height,
      dpr: s.deviceScaleFactor,
      mobile: s.mobile,
      networkThrottle: s.networkThrottle,
      cpuThrottle: s.cpuThrottle,
    });

    setApplying(true);
    try {
      const w = s.rotated ? s.height : s.width;
      const h = s.rotated ? s.width : s.height;

      // Device metrics override
      await sendCdp('Emulation.setDeviceMetricsOverride', {
        width: w,
        height: h,
        deviceScaleFactor: s.deviceScaleFactor,
        mobile: s.mobile,
        screenWidth: w,
        screenHeight: h,
      });

      // Touch emulation
      await sendCdp('Emulation.setTouchEmulationEnabled', {
        enabled: s.mobile,
        maxTouchPoints: s.mobile ? 5 : 0,
      });

      // User agent
      const ua = s.userAgent.trim() || (s.preset?.userAgent ?? '');
      if (ua) {
        await sendCdp('Emulation.setUserAgentOverride', { userAgent: ua });
        console.log(LOG_PREFIX, 'userAgent set:', ua.slice(0, 60));
      }

      // Network throttle
      const netConfig = NETWORK_THROTTLE_CONFIGS[s.networkThrottle];
      await sendCdp('Network.emulateNetworkConditions', {
        offline: netConfig.offline,
        downloadThroughput: netConfig.downloadThroughput,
        uploadThroughput: netConfig.uploadThroughput,
        latency: netConfig.latency,
      });

      // CPU throttle
      await sendCdp('Emulation.setCPUThrottlingRate', {
        rate: CPU_THROTTLE_RATES[s.cpuThrottle],
      });

      setApplied(true);
      console.log(LOG_PREFIX, 'emulation applied successfully');
    } catch (err) {
      console.error(LOG_PREFIX, 'applyEmulation failed:', err);
    } finally {
      setApplying(false);
    }
  }, [sendCdp]);

  // ── Reset all overrides ────────────────────────────────────────────────────

  const resetEmulation = useCallback(async () => {
    console.log(LOG_PREFIX, 'resetEmulation');
    setApplying(true);
    try {
      await sendCdp('Emulation.clearDeviceMetricsOverride');
      await sendCdp('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 0 });
      await sendCdp('Emulation.setUserAgentOverride', { userAgent: '' });
      await sendCdp('Network.emulateNetworkConditions', {
        offline: false,
        downloadThroughput: -1,
        uploadThroughput: -1,
        latency: 0,
      });
      await sendCdp('Emulation.setCPUThrottlingRate', { rate: 1 });
      setApplied(false);
      setState(DEFAULT_STATE);
      setUaInput('');
      setUaDirty(false);
      console.log(LOG_PREFIX, 'emulation reset');
    } catch (err) {
      console.error(LOG_PREFIX, 'resetEmulation failed:', err);
    } finally {
      setApplying(false);
    }
  }, [sendCdp]);

  // Reset when toolbar mounts (enable Network domain)
  useEffect(() => {
    void sendCdp('Network.enable', {});
    return () => {
      // Reset emulation on unmount
      void sendCdp('Emulation.clearDeviceMetricsOverride').catch(() => {});
      void sendCdp('Emulation.setTouchEmulationEnabled', { enabled: false, maxTouchPoints: 0 }).catch(() => {});
      void sendCdp('Emulation.setUserAgentOverride', { userAgent: '' }).catch(() => {});
      void sendCdp('Network.emulateNetworkConditions', {
        offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0,
      }).catch(() => {});
      void sendCdp('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
    };
  }, [sendCdp]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleSelectPreset = useCallback((preset: DevicePreset) => {
    console.log(LOG_PREFIX, 'selectPreset', preset.name);
    const next: DeviceState = {
      ...state,
      preset,
      width: preset.width,
      height: preset.height,
      deviceScaleFactor: preset.deviceScaleFactor,
      mobile: preset.mobile,
      rotated: false,
      userAgent: uaDirty ? state.userAgent : (preset.userAgent ?? ''),
    };
    setState(next);
    setUaInput(uaDirty ? uaInput : (preset.userAgent ?? ''));
    void applyEmulation(next);
  }, [state, uaDirty, uaInput, applyEmulation]);

  const handleRotate = useCallback(() => {
    console.log(LOG_PREFIX, 'rotate');
    const next = { ...state, rotated: !state.rotated };
    setState(next);
    void applyEmulation(next);
  }, [state, applyEmulation]);

  const handleNetworkThrottle = useCallback((value: NetworkThrottle) => {
    console.log(LOG_PREFIX, 'networkThrottle:', value);
    const next = { ...state, networkThrottle: value };
    setState(next);
    void applyEmulation(next);
  }, [state, applyEmulation]);

  const handleCpuThrottle = useCallback((value: CpuThrottle) => {
    console.log(LOG_PREFIX, 'cpuThrottle:', value);
    const next = { ...state, cpuThrottle: value };
    setState(next);
    void applyEmulation(next);
  }, [state, applyEmulation]);

  const handleUaChange = useCallback((value: string) => {
    setUaInput(value);
    setUaDirty(value !== (state.preset?.userAgent ?? ''));
  }, [state.preset]);

  const handleUaApply = useCallback(() => {
    console.log(LOG_PREFIX, 'applyUserAgent');
    const next = { ...state, userAgent: uaInput };
    setState(next);
    void applyEmulation(next);
  }, [state, uaInput, applyEmulation]);

  const handleWidthChange = useCallback((value: string) => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n > 0) {
      const next: DeviceState = { ...state, width: n, preset: null };
      setState(next);
    }
  }, [state]);

  const handleHeightChange = useCallback((value: string) => {
    const n = parseInt(value, 10);
    if (!isNaN(n) && n > 0) {
      const next: DeviceState = { ...state, height: n, preset: null };
      setState(next);
    }
  }, [state]);

  const handleDimensionApply = useCallback(() => {
    console.log(LOG_PREFIX, 'applyDimensions', state.width, 'x', state.height);
    void applyEmulation(state);
  }, [state, applyEmulation]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const displayW = state.rotated ? state.height : state.width;
  const displayH = state.rotated ? state.width : state.height;

  return (
    <div className="device-toolbar">
      {/* Row 1: Presets */}
      <div className="device-toolbar-row">
        <span className="device-toolbar-label">Device</span>
        <div className="device-preset-list">
          {DEVICE_PRESETS.map((p) => (
            <button
              key={p.name}
              className="device-preset-btn"
              data-active={state.preset?.name === p.name ? 'true' : 'false'}
              onClick={() => handleSelectPreset(p)}
              title={`${p.width}×${p.height} @${p.deviceScaleFactor}x`}
            >
              {p.name}
            </button>
          ))}
        </div>
      </div>

      {/* Row 2: Dimensions + DPR + Rotate + Throttles */}
      <div className="device-toolbar-row device-toolbar-row-controls">
        <span className="device-toolbar-label">Size</span>
        <input
          className="device-dim-input"
          type="number"
          min={100}
          max={3840}
          value={displayW}
          onChange={(e) => handleWidthChange(e.target.value)}
          onBlur={handleDimensionApply}
          onKeyDown={(e) => { if (e.key === 'Enter') handleDimensionApply(); }}
          title="Width (px)"
        />
        <span className="device-dim-sep">×</span>
        <input
          className="device-dim-input"
          type="number"
          min={100}
          max={3840}
          value={displayH}
          onChange={(e) => handleHeightChange(e.target.value)}
          onBlur={handleDimensionApply}
          onKeyDown={(e) => { if (e.key === 'Enter') handleDimensionApply(); }}
          title="Height (px)"
        />

        <span className="device-toolbar-label device-toolbar-label-mid">DPR</span>
        <select
          className="device-select"
          value={state.deviceScaleFactor}
          onChange={(e) => {
            const next = { ...state, deviceScaleFactor: parseFloat(e.target.value) };
            setState(next);
            void applyEmulation(next);
          }}
        >
          <option value={1}>1x</option>
          <option value={1.5}>1.5x</option>
          <option value={2}>2x</option>
          <option value={2.625}>2.625x</option>
          <option value={3}>3x</option>
          <option value={3.5}>3.5x</option>
        </select>

        <button
          className="device-rotate-btn"
          onClick={handleRotate}
          title="Rotate viewport"
          data-rotated={state.rotated ? 'true' : 'false'}
        >
          ⟳
        </button>

        <div className="device-toolbar-divider" />

        <span className="device-toolbar-label">Network</span>
        <select
          className="device-select"
          value={state.networkThrottle}
          onChange={(e) => handleNetworkThrottle(e.target.value as NetworkThrottle)}
        >
          {(Object.keys(NETWORK_THROTTLE_CONFIGS) as NetworkThrottle[]).map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>

        <span className="device-toolbar-label device-toolbar-label-mid">CPU</span>
        <select
          className="device-select"
          value={state.cpuThrottle}
          onChange={(e) => handleCpuThrottle(e.target.value as CpuThrottle)}
        >
          {(Object.keys(CPU_THROTTLE_RATES) as CpuThrottle[]).map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>

        <div className="device-toolbar-divider" />

        {applied && (
          <button
            className="device-reset-btn"
            onClick={() => void resetEmulation()}
            disabled={applying}
            title="Reset all emulation"
          >
            Reset
          </button>
        )}

        <button
          className="device-toolbar-close-btn"
          onClick={onClose}
          title="Close device toolbar (Cmd+Shift+M)"
        >
          ✕
        </button>
      </div>

      {/* Row 3: User-Agent */}
      <div className="device-toolbar-row device-toolbar-row-ua">
        <span className="device-toolbar-label">User Agent</span>
        <input
          className="device-ua-input"
          type="text"
          placeholder="Override user agent string (leave blank to use device default)"
          value={uaInput}
          onChange={(e) => handleUaChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleUaApply(); }}
        />
        <button
          className="device-ua-apply-btn"
          onClick={handleUaApply}
          disabled={applying}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
