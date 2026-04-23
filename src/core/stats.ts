import { getGrid, isCutCell, type Grid, type SurfaceDims } from './grid';
import type { Surface } from './state';
import type { Tile } from './tile';
import { hexesInRect, hexVertices, type HexOpts } from '@/ui/hex-grid';

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
  if (tile.shape === 'square') {
    const grid = getGrid(s, tile.sizeIn);
    const total = grid.cols * grid.rows;
    const full = grid.fullCols * grid.fullRows;
    const cut = total - full;
    return { grid, total, full, cut, areaFt2 };
  }
  // Hex: enumerate all overlapping hexes; "full" = every vertex inside the rect.
  const opts: HexOpts = { shape: tile.shape, sizeIn: tile.sizeIn };
  const list = hexesInRect(s, opts);
  let full = 0;
  for (const a of list) {
    const verts = hexVertices(a, opts);
    const allInside = verts.every(
      (v) => v.x >= 0 && v.x <= s.widthIn && v.y >= 0 && v.y <= s.heightIn,
    );
    if (allInside) full++;
  }
  const total = list.length;
  const cut = total - full;
  return { total, full, cut, areaFt2 };
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
    const map = tiles[s.id];
    if (!map) continue;
    if (tile.shape === 'square') {
      const grid = getGrid(s, tile.sizeIn);
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
    } else {
      // Hex: cell keys are axial "q,r". A painted hex counts only when it
      // actually overlaps the surface rect (any vertex inside); it's "cut"
      // iff at least one of its 6 vertices lies outside the rect.
      const opts: HexOpts = { shape: tile.shape, sizeIn: tile.sizeIn };
      for (const [k, color] of map) {
        if (!color) continue;
        const [qStr, rStr] = k.split(',');
        const q = Number(qStr);
        const r = Number(rStr);
        if (!Number.isFinite(q) || !Number.isFinite(r)) continue;
        const verts = hexVertices({ q, r }, opts);
        const anyInside = verts.some(
          (v) => v.x >= 0 && v.x <= s.widthIn && v.y >= 0 && v.y <= s.heightIn,
        );
        if (!anyInside) continue;
        const allInside = verts.every(
          (v) => v.x >= 0 && v.x <= s.widthIn && v.y >= 0 && v.y <= s.heightIn,
        );
        byColor.set(color, (byColor.get(color) ?? 0) + 1);
        if (allInside) {
          totalPaintedFull++;
        } else {
          byColorCut.set(color, (byColorCut.get(color) ?? 0) + 1);
          totalPaintedCut++;
        }
      }
    }
  }
  const totalPainted = totalPaintedFull + totalPaintedCut;
  const order = Math.ceil(totalPainted * 1.1);
  return { byColor, byColorCut, totalPaintedFull, totalPaintedCut, totalPainted, order };
}
