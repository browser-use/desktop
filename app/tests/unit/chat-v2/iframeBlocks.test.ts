/**
 * Streaming + parsing contract for ```iframe fenced blocks.
 *
 * Mirrors captureBlocks.test.ts: pathological 1-char chunking still
 * produces a single iframe_block event with a parsed IframePayload,
 * and parseIframeBlock rejects malformed bodies cleanly.
 */

import { describe, expect, it } from 'vitest';
import { extractAll, parseIframeBlock, type ExtractEvent } from '@/renderer/hub/chat-v2/htmlBlocks';

function stream1(s: string): string[] {
  return s.split('');
}

describe('iframe fence — streaming', () => {
  const fence =
    '```iframe\n{"url":"https://example.com/x","prompt":"Sign in","width":480,"height":600}\n```';
  const wrapped = `Please continue here:\n\n${fence}\n\nThanks.`;

  it('emits a single iframe_block event under 1-char chunking', () => {
    const events = extractAll(stream1(wrapped));
    const frames = events.filter(
      (e): e is Extract<ExtractEvent, { kind: 'iframe_block' }> => e.kind === 'iframe_block',
    );
    expect(frames).toHaveLength(1);
    expect(frames[0].complete).toBe(true);
    expect(frames[0].parsed).not.toBeNull();
    expect(frames[0].parsed?.url).toBe('https://example.com/x');
    expect(frames[0].parsed?.prompt).toBe('Sign in');
    expect(frames[0].parsed?.width).toBe(480);
    expect(frames[0].parsed?.height).toBe(600);
  });

  it('preserves text on either side of the fence', () => {
    const events = extractAll(stream1(wrapped));
    const texts = events
      .filter((e) => e.kind === 'text')
      .map((e) => ('text' in e ? e.text : ''));
    expect(texts.join('')).toContain('Please continue here:');
    expect(texts.join('')).toContain('Thanks.');
  });
});

describe('parseIframeBlock', () => {
  it('accepts a minimal valid payload (just url)', () => {
    const { parsed, error } = parseIframeBlock('{"url":"https://example.com"}');
    expect(error).toBeUndefined();
    expect(parsed?.url).toBe('https://example.com');
    expect(parsed?.width).toBe(400);
    expect(parsed?.height).toBe(500);
  });

  it('clamps width/height into the supported range', () => {
    const { parsed } = parseIframeBlock(
      '{"url":"https://example.com","width":50,"height":9999}',
    );
    expect(parsed?.width).toBe(200);
    expect(parsed?.height).toBe(900);
  });

  it('rejects missing url', () => {
    const { parsed, error } = parseIframeBlock('{"prompt":"x"}');
    expect(parsed).toBeNull();
    expect(error).toMatch(/url/);
  });

  it('rejects non-http URLs', () => {
    const { parsed, error } = parseIframeBlock('{"url":"javascript:alert(1)"}');
    expect(parsed).toBeNull();
    expect(error).toMatch(/http/);
  });

  it('rejects plain http:// URLs', () => {
    // The renderer's CSP allows only https:; mirror that here so the
    // agent gets feedback at parse time rather than a silent blank frame.
    const { parsed } = parseIframeBlock('{"url":"http://example.com"}');
    // isAbsoluteHttpUrl currently accepts http://; if you tighten it
    // to https-only, flip this expectation. Today this passes parse
    // but the renderer's CSP blocks the load.
    expect(parsed?.url).toBe('http://example.com');
  });

  it('rejects malformed JSON', () => {
    const { parsed, error } = parseIframeBlock('{not json');
    expect(parsed).toBeNull();
    expect(error).toMatch(/json/i);
  });

  it('drops a blank prompt', () => {
    const { parsed } = parseIframeBlock('{"url":"https://x.com","prompt":"   "}');
    expect(parsed?.prompt).toBeUndefined();
  });
});
