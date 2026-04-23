import { getGrid, isCutCell, type Grid, type SurfaceDims } from './grid';
import type { Surface } from './state';
import type { Tile } from './tile';

export interface SurfaceStats {
  /** Present for square tiles only; hex surfaces leave this undefined. */
  grid?: Grid;
  total: number;
  full: number;
  cut: number;
  areaFt2: number;
}

export function computeSurfaceStats(s: SurfaceDims, tile: Tile): SurfaceStats {
  const areaFt2 = (s.widthIn * s.heightIn) / 144;
  // Hex support lands in Task 6.4; for now only square is implemented and the
  // surface renderer never passes a hex tile here.
  const grid = getGrid(s, tile.sizeIn);
  const total = grid.cols * grid.rows;
  const full = grid.fullCols * grid.fullRows;
  const cut = total - full;
  return { grid, total, full, cut, areaFt2 };
}

export interface Totals {
  byColor: Map<string, number>;
  byColorCut: Map<string, number>;
  totalPaintedFull: number;
  totalPaintedCut: number;
  totalPainted: number;
  order: number;
}

export function computeTotals(
  surfaces: Surface[],
  tiles: Record<string, Map<string, string>>,
  tileLibrary: Tile[],
): Totals {
  const byColor = new Map<string, number>();
  const byColorCut = new Map<string, number>();
  let totalPaintedFull = 0;
  let totalPaintedCut = 0;
  const tilesById = new Map(tileLibrary.map((t) => [t.id, t]));
  for (const s of surfaces) {
    const tile = tilesById.get(s.tileId);
    if (!tile) continue;
    const grid = getGrid(s, tile.sizeIn);
    const map = tiles[s.id];
    if (!map) continue;
    for (const [k, color] of map) {
      if (!color) continue;
      const [rStr, cStr] = k.split(',');
      const r = Number(rStr);
      const c = Number(cStr);
      if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
      if (r < 0 || c < 0 || r >= grid.rows || c >= grid.cols) continue;
      byColor.set(color, (byColor.get(color) ?? 0) + 1);
      if (isCutCell(grid, r, c)) {
        byColorCut.set(color, (byColorCut.get(color) ?? 0) + 1);
        totalPaintedCut++;
      } else {
        totalPaintedFull++;
      }
    }
  }
  const totalPainted = totalPaintedFull + totalPaintedCut;
  const order = Math.ceil(totalPainted * 1.1);
  return { byColor, byColorCut, totalPaintedFull, totalPaintedCut, totalPainted, order };
}
