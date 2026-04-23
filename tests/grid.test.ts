import { describe, it, expect } from 'vitest';
import { getGrid, isCutCell, cellKey, TILE_INCH, TILE_PX } from '@/core/grid';

const exactFit = { widthIn: TILE_INCH * 4, heightIn: TILE_INCH * 3 };
const fracCol = { widthIn: TILE_INCH * 4 + 2, heightIn: TILE_INCH * 3 };
const fracRow = { widthIn: TILE_INCH * 4, heightIn: TILE_INCH * 3 + 2 };
const fracBoth = { widthIn: TILE_INCH * 4 + 2, heightIn: TILE_INCH * 3 + 2 };

describe('getGrid', () => {
  it('returns full grid with no cuts for exact fit', () => {
    const g = getGrid(exactFit);
    expect(g.cols).toBe(4);
    expect(g.rows).toBe(3);
    expect(g.fullCols).toBe(4);
    expect(g.fullRows).toBe(3);
    expect(g.hasColCut).toBe(false);
    expect(g.hasRowCut).toBe(false);
    expect(g.colSizes).toEqual([TILE_PX, TILE_PX, TILE_PX, TILE_PX]);
    expect(g.rowSizes).toEqual([TILE_PX, TILE_PX, TILE_PX]);
  });

  it('adds fractional col when width overhangs', () => {
    const g = getGrid(fracCol);
    expect(g.cols).toBe(5);
    expect(g.fullCols).toBe(4);
    expect(g.hasColCut).toBe(true);
    expect(g.hasRowCut).toBe(false);
    expect(g.colSizes).toHaveLength(5);
    expect(g.colSizes[4]).toBeCloseTo((2 / TILE_INCH) * TILE_PX, 2);
  });

  it('adds fractional row when height overhangs', () => {
    const g = getGrid(fracRow);
    expect(g.rows).toBe(4);
    expect(g.fullRows).toBe(3);
    expect(g.hasRowCut).toBe(true);
    expect(g.hasColCut).toBe(false);
  });

  it('adds both fractional row and col', () => {
    const g = getGrid(fracBoth);
    expect(g.cols).toBe(5);
    expect(g.rows).toBe(4);
    expect(g.hasColCut).toBe(true);
    expect(g.hasRowCut).toBe(true);
  });

  it('treats sub-epsilon remainder as no cut', () => {
    const g = getGrid({ widthIn: TILE_INCH * 4 + 0.001, heightIn: TILE_INCH * 3 });
    expect(g.hasColCut).toBe(false);
    expect(g.cols).toBe(4);
  });
});

describe('isCutCell', () => {
  it('marks last col cut when hasColCut', () => {
    const g = getGrid(fracCol);
    expect(isCutCell(g, 0, 4)).toBe(true);
    expect(isCutCell(g, 0, 3)).toBe(false);
  });
  it('marks last row cut when hasRowCut', () => {
    const g = getGrid(fracRow);
    expect(isCutCell(g, 3, 0)).toBe(true);
    expect(isCutCell(g, 2, 0)).toBe(false);
  });
  it('marks nothing as cut on exact fit', () => {
    const g = getGrid(exactFit);
    for (let r = 0; r < g.rows; r++)
      for (let c = 0; c < g.cols; c++)
        expect(isCutCell(g, r, c)).toBe(false);
  });
});

describe('cellKey', () => {
  it('produces stable string keys', () => {
    expect(cellKey(2, 5)).toBe('2,5');
    expect(cellKey(0, 0)).toBe('0,0');
  });
});
