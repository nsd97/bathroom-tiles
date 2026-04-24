import { describe, it, expect } from 'vitest';
import { computeSurfaceStats, computeTotals } from '@/core/stats';
import type { Tile } from '@/core/tile';

const TILE_INCH = 7.87;

const squareTile: Tile = {
  id: 'square-default',
  shape: 'square',
  sizeIn: TILE_INCH,
  label: 'Square 7.87"',
};

const hexPointy2: Tile = {
  id: 'hex-pointy-2',
  shape: 'hex-pointy',
  sizeIn: 2,
  label: 'Hex (pointy) 2"',
};

describe('computeSurfaceStats (square)', () => {
  it('exact fit: full count equals total, cut=0', () => {
    const stats = computeSurfaceStats(
      { widthIn: TILE_INCH * 4, heightIn: TILE_INCH * 3 },
      squareTile,
    );
    expect(stats.total).toBe(12);
    expect(stats.full).toBe(12);
    expect(stats.cut).toBe(0);
    expect(stats.areaFt2).toBeCloseTo((TILE_INCH * 4 * TILE_INCH * 3) / 144, 4);
  });

  it('fractional col: adds a cut column', () => {
    const stats = computeSurfaceStats(
      { widthIn: TILE_INCH * 4 + 2, heightIn: TILE_INCH * 3 },
      squareTile,
    );
    expect(stats.full).toBe(12);
    expect(stats.total).toBe(15);
    expect(stats.cut).toBe(3);
  });

  it('fractional row: adds a cut row', () => {
    const stats = computeSurfaceStats(
      { widthIn: TILE_INCH * 4, heightIn: TILE_INCH * 3 + 2 },
      squareTile,
    );
    expect(stats.full).toBe(12);
    expect(stats.total).toBe(16);
    expect(stats.cut).toBe(4);
  });
});

describe('computeSurfaceStats (hex-pointy)', () => {
  it('12x12 surface with 2" pointy hex: total = full + cut; area unchanged', () => {
    const stats = computeSurfaceStats({ widthIn: 12, heightIn: 12 }, hexPointy2);
    // Area of one pointy hex, edge 2" = 1.5·√3·s² ≈ 10.39 sq in.
    // 12×12 = 144 sq in → roughly 14 fully-inside hexes, plus edge-clipped cuts.
    expect(stats.total).toBeGreaterThan(0);
    expect(stats.full).toBeGreaterThan(0);
    expect(stats.cut).toBeGreaterThan(0);
    expect(stats.full + stats.cut).toBe(stats.total);
    expect(stats.areaFt2).toBeCloseTo(1, 4);
  });
});

describe('computeTotals', () => {
  const surface = {
    id: 'x',
    group: 'Floors' as const,
    name: 'x',
    widthIn: TILE_INCH * 4 + 2,
    heightIn: TILE_INCH * 3,
    tileId: squareTile.id,
  };

  it('counts painted tiles grouped by color; splits full vs cut', () => {
    const tiles = { x: new Map<string, string>() };
    tiles.x.set('0,0', '#000');
    tiles.x.set('0,1', '#000');
    tiles.x.set('0,4', '#f00');
    const t = computeTotals([surface], tiles, [squareTile]);
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
    const t = computeTotals([surface], tiles, [squareTile]);
    expect(t.totalPaintedFull).toBe(0);
    expect(t.totalPaintedCut).toBe(0);
  });

  it('returns zeros and empty maps for empty tiles', () => {
    const t = computeTotals([surface], {}, [squareTile]);
    expect(t.totalPainted).toBe(0);
    expect(t.totalPaintedFull).toBe(0);
    expect(t.totalPaintedCut).toBe(0);
    expect(t.byColor.size).toBe(0);
    expect(t.byColorCut.size).toBe(0);
    expect(t.order).toBe(0);
  });

  it('returns zeros for empty surfaces', () => {
    const t = computeTotals([], { x: new Map([['0,0', '#000']]) }, [squareTile]);
    expect(t.totalPainted).toBe(0);
    expect(t.byColor.size).toBe(0);
  });

  it('aggregates across multiple surfaces', () => {
    const s1 = { ...surface, id: 's1' };
    const s2 = { ...surface, id: 's2' };
    const tiles = {
      s1: new Map([['0,0', '#000'], ['0,1', '#fff']]),
      s2: new Map([['0,0', '#000']]),
    };
    const t = computeTotals([s1, s2], tiles, [squareTile]);
    expect(t.byColor.get('#000')).toBe(2);
    expect(t.byColor.get('#fff')).toBe(1);
    expect(t.totalPainted).toBe(3);
  });

  it('ignores malformed cell keys', () => {
    const tiles = { x: new Map([['not-a-key', '#000'], ['', '#000'], ['-1,-1', '#000']]) };
    const t = computeTotals([surface], tiles, [squareTile]);
    expect(t.totalPainted).toBe(0);
  });

  it('skips surfaces whose tile is missing from the library', () => {
    const orphan = { ...surface, tileId: 'does-not-exist' };
    const tiles = { x: new Map([['0,0', '#000']]) };
    const t = computeTotals([orphan], tiles, [squareTile]);
    expect(t.totalPainted).toBe(0);
  });

  it('counts painted hex cells with axial "q,r" keys', () => {
    const hexSurface = {
      id: 'hx',
      group: 'Floors' as const,
      name: 'hx',
      widthIn: 12,
      heightIn: 12,
      tileId: hexPointy2.id,
    };
    // Axial coords known to overlap the 12x12 rect. (1,1) and (2,1) sit well
    // inside; (0,0)'s center is at the corner so some vertices land outside.
    const tiles = {
      hx: new Map<string, string>([
        ['1,1', '#aaa'],
        ['2,1', '#aaa'],
        ['0,0', '#bbb'],
      ]),
    };
    const t = computeTotals([hexSurface], tiles, [hexPointy2]);
    expect(t.totalPainted).toBe(3);
    expect(t.byColor.get('#aaa')).toBe(2);
    expect(t.byColor.get('#bbb')).toBe(1);
  });

  it('ignores hex paint keys far outside the surface rect', () => {
    const hexSurface = {
      id: 'hx',
      group: 'Floors' as const,
      name: 'hx',
      widthIn: 12,
      heightIn: 12,
      tileId: hexPointy2.id,
    };
    const tiles = { hx: new Map([['99,99', '#000']]) };
    const t = computeTotals([hexSurface], tiles, [hexPointy2]);
    expect(t.totalPainted).toBe(0);
  });
});
