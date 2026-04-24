import { describe, expect, it } from 'vitest';
import { labelDraftState, SHAPE_GLYPHS } from '@/ui/tile-library';

// Pure-function tests — no DOM. Vitest is configured with `environment: 'node'`
// in vitest.config.ts, so these tests intentionally avoid `document` / jsdom.

describe('labelDraftState', () => {
  it('returns the default label when labelDirty is false and size is positive', () => {
    expect(
      labelDraftState({ shape: 'square', sizeIn: 3, userTyped: '', labelDirty: false }),
    ).toBe('Square 3"');
  });

  it('follows shape changes while the user has not typed', () => {
    expect(
      labelDraftState({ shape: 'hex-pointy', sizeIn: 4, userTyped: '', labelDirty: false }),
    ).toBe('Hex (pointy) 4"');
    expect(
      labelDraftState({ shape: 'hex-flat', sizeIn: 4, userTyped: '', labelDirty: false }),
    ).toBe('Hex (flat) 4"');
  });

  it('preserves the user-typed value when labelDirty is true', () => {
    expect(
      labelDraftState({
        shape: 'square',
        sizeIn: 3,
        userTyped: 'Pebble beige',
        labelDirty: true,
      }),
    ).toBe('Pebble beige');
  });

  it('falls back to the user-typed value when sizeIn is not positive finite', () => {
    // sizeIn=NaN — default label is not derivable; echo the current input.
    expect(
      labelDraftState({ shape: 'square', sizeIn: NaN, userTyped: 'partial', labelDirty: false }),
    ).toBe('partial');
    expect(
      labelDraftState({ shape: 'square', sizeIn: 0, userTyped: '', labelDirty: false }),
    ).toBe('');
    expect(
      labelDraftState({ shape: 'square', sizeIn: -1, userTyped: 'x', labelDirty: false }),
    ).toBe('x');
  });
});

describe('SHAPE_GLYPHS', () => {
  it('maps each shape to the intended unicode glyph', () => {
    expect(SHAPE_GLYPHS.square).toBe('\u25A0');
    expect(SHAPE_GLYPHS['hex-pointy']).toBe('\u2B22');
    expect(SHAPE_GLYPHS['hex-flat']).toBe('\u2B21');
  });
});
