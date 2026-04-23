import { describe, it, expect } from 'vitest';
import { computeSurfaceStats, computeTotals } from '@/core/stats';
import { TILE_INCH } from '@/core/grid';

describe('computeSurfaceStats', () => {
  it('exact fit: full count equals total, cut=0', () => {
    const stats = computeSurfaceStats({ widthIn: TILE_INCH * 4, heightIn: TILE_INCH * 3 });
    expect(stats.total).toBe(12);
    expect(stats.full).toBe(12);
    expect(stats.cut).toBe(0);
    expect(stats.areaFt2).toBeCloseTo((TILE_INCH * 4 * TILE_INCH * 3) / 144, 4);
  });

  it('fractional col: adds a cut column', () => {
    const stats = computeSurfaceStats({ widthIn: TILE_INCH * 4 + 2, heightIn: TILE_INCH * 3 });
    expect(stats.full).toBe(12);
    expect(stats.total).toBe(15);
    expect(stats.cut).toBe(3);
  });
});

describe('computeTotals', () => {
  const surface = {
    id: 'x',
    group: 'Floors' as const,
    name: 'x',
    widthIn: TILE_INCH * 4 + 2,
    heightIn: TILE_INCH * 3,
  };

  it('counts painted tiles grouped by color; splits full vs cut', () => {
    const tiles = { x: new Map<string, string>() };
    tiles.x.set('0,0', '#000');
    tiles.x.set('0,1', '#000');
    tiles.x.set('0,4', '#f00');
    const t = computeTotals([surface], tiles);
    expect(t.totalPaintedFull).toBe(2);
    expect(t.totalPaintedCut).toBe(1);
    expect(t.byColor.get('#000')).toBe(2);
    expect(t.byColor.get('#f00')).toBe(1);
    expect(t.byColorCut.get('#f00')).toBe(1);
    expect(t.order).toBe(Math.ceil(3 * 1.1));
  });

  it('ignores stale keys outside the current grid', () => {
    const tiles = { x: new Map<string, string>() };
    tiles.x.set('99,99', '#000');
    const t = computeTotals([surface], tiles);
    expect(t.totalPaintedFull).toBe(0);
    expect(t.totalPaintedCut).toBe(0);
  });
});
