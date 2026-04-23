import { getGrid, isCutCell, type Grid } from './grid';
import type { Surface } from './state';

export interface SurfaceStats {
  grid: Grid;
  total: number;
  full: number;
  cut: number;
  areaFt2: number;
}

export function computeSurfaceStats(s: Pick<Surface, 'widthIn' | 'heightIn'>): SurfaceStats {
  const grid = getGrid(s);
  const total = grid.cols * grid.rows;
  const full = grid.fullCols * grid.fullRows;
  const cut = total - full;
  const areaFt2 = (s.widthIn * s.heightIn) / 144;
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
): Totals {
  const byColor = new Map<string, number>();
  const byColorCut = new Map<string, number>();
  let totalPaintedFull = 0;
  let totalPaintedCut = 0;
  for (const s of surfaces) {
    const grid = getGrid(s);
    const map = tiles[s.id];
    if (!map) continue;
    for (const [k, color] of map) {
      if (!color) continue;
      const [rStr, cStr] = k.split(',');
      const r = Number(rStr);
      const c = Number(cStr);
      if (r >= grid.rows || c >= grid.cols) continue;
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
  const order = totalPainted ? Math.ceil(totalPainted * 1.1) : 0;
  return { byColor, byColorCut, totalPaintedFull, totalPaintedCut, totalPainted, order };
}
