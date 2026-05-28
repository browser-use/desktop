/**
 * Streaming + parsing contract for ```capture fenced blocks.
 *
 * Mirrors askBlocks.test.ts in shape: pathological 1-char chunking still
 * produces a single `capture_block` event with a parsed CapturePayload,
 * and the parseCaptureBlock guard rejects malformed bodies cleanly.
 */

import { describe, expect, it } from 'vitest';
import { extractAll, parseCaptureBlock, type ExtractEvent } from '@/renderer/hub/chat-v2/htmlBlocks';

function stream1(s: string): string[] {
  return s.split('');
}

describe('capture fence — streaming', () => {
  const fence = '```capture\n{"image":"/tmp/grid.png","prompt":"Select motorcycles","rows":3,"cols":3}\n```';
  const wrapped = `Here it is:\n\n${fence}\n\nPress verify when done.`;

  it('emits a single capture_block event under 1-char chunking', () => {
    const events = extractAll(stream1(wrapped));
    const captures = events.filter((e): e is Extract<ExtractEvent, { kind: 'capture_block' }> => e.kind === 'capture_block');
    expect(captures).toHaveLength(1);
    expect(captures[0].complete).toBe(true);
    expect(captures[0].parsed).not.toBeNull();
    expect(captures[0].parsed?.image).toBe('/tmp/grid.png');
    expect(captures[0].parsed?.prompt).toBe('Select motorcycles');
    expect(captures[0].parsed?.rows).toBe(3);
    expect(captures[0].parsed?.cols).toBe(3);
  });

  it('preserves the surrounding text on either side', () => {
    const events = extractAll(stream1(wrapped));
    const texts = events.filter((e) => e.kind === 'text').map((e) => 'text' in e ? e.text : '');
    expect(texts.join('')).toContain('Here it is:');
    expect(texts.join('')).toContain('Press verify when done.');
  });
});

describe('parseCaptureBlock', () => {
  it('accepts a minimal valid payload (just image)', () => {
    const { parsed, error } = parseCaptureBlock('{"image":"/tmp/g.png"}');
    expect(error).toBeUndefined();
    expect(parsed).toEqual({ image: '/tmp/g.png', prompt: undefined, rows: 3, cols: 3 });
  });

  it('clamps absurd rows/cols into the [1, 8] range', () => {
    const { parsed } = parseCaptureBlock('{"image":"/tmp/g.png","rows":99,"cols":0}');
    expect(parsed?.rows).toBe(8);
    expect(parsed?.cols).toBe(1);
  });

  it('rejects missing image', () => {
    const { parsed, error } = parseCaptureBlock('{"prompt":"x"}');
    expect(parsed).toBeNull();
    expect(error).toMatch(/image/);
  });

  it('rejects malformed JSON', () => {
    const { parsed, error } = parseCaptureBlock('{not json');
    expect(parsed).toBeNull();
    expect(error).toMatch(/json/i);
  });

  it('rejects a top-level array', () => {
    const { parsed, error } = parseCaptureBlock('[]');
    expect(parsed).toBeNull();
    expect(error).toMatch(/object/);
  });

  it('drops a blank prompt', () => {
    const { parsed } = parseCaptureBlock('{"image":"/x.png","prompt":"   "}');
    expect(parsed?.prompt).toBeUndefined();
  });
});
