import { describe, it, expect } from 'vitest';
import { defaultTileLabel, type Tile } from '@/core/tile';

describe('defaultTileLabel — square', () => {
  it('formats integer size without decimal', () => {
    expect(defaultTileLabel('square', 3)).toBe('Square 3"');
  });
  it('formats fractional size', () => {
    expect(defaultTileLabel('square', 7.87)).toBe('Square 7.87"');
  });
});

describe('defaultTileLabel — hex-pointy', () => {
  it('labels hex-pointy tiles', () => {
    expect(defaultTileLabel('hex-pointy', 2)).toBe('Hex (pointy) 2"');
  });
});

describe('defaultTileLabel — hex-flat', () => {
  it('labels hex-flat tiles', () => {
    expect(defaultTileLabel('hex-flat', 4)).toBe('Hex (flat) 4"');
  });
});

describe('defaultTileLabel — trailing-zero trim', () => {
  it('keeps one decimal when present', () => {
    expect(defaultTileLabel('square', 3.5)).toBe('Square 3.5"');
  });
  it('trims trailing-zero fractions to integer', () => {
    expect(defaultTileLabel('square', 3.0)).toBe('Square 3"');
  });
});

describe('Tile type', () => {
  it('can construct a Tile value', () => {
    const t: Tile = { id: 'tile-1', shape: 'square', sizeIn: 7.87, label: 'Square 7.87"' };
    expect(t.id).toBe('tile-1');
    expect(t.shape).toBe('square');
    expect(t.sizeIn).toBe(7.87);
    expect(t.label).toBe('Square 7.87"');
  });
});
