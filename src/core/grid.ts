/**
 * Square-tile grid geometry. Per-surface tile size is passed in as `tileSizeIn`
 * (inches per cell); the rendering layer scales inches to pixels via
 * `PX_PER_INCH`. The historical 7.87" × 18px mapping is preserved — 18 / 7.87
 * ≈ 2.287 px/in — so existing surfaces render identically when their tile is a
 * 7.87" square.
 */

export const PX_PER_INCH = 18 / 7.87;

export interface SurfaceDims {
  widthIn: number;
  heightIn: number;
}

export interface Grid {
  cols: number;
  rows: number;
  fullCols: number;
  fullRows: number;
  hasColCut: boolean;
  hasRowCut: boolean;
  colSizes: number[];
  rowSizes: number[];
}

export function cellKey(r: number, c: number): string {
  return `${r},${c}`;
}

export function getGrid(s: SurfaceDims, tileSizeIn: number): Grid {
  const tilePx = tileSizeIn * PX_PER_INCH;
  const wTiles = s.widthIn / tileSizeIn;
  const hTiles = s.heightIn / tileSizeIn;
  const fullCols = Math.floor(wTiles + 1e-6);
  const fullRows = Math.floor(hTiles + 1e-6);
  const colRem = +(wTiles - fullCols).toFixed(6);
  const rowRem = +(hTiles - fullRows).toFixed(6);
  const hasColCut = colRem > 0.01;
  const hasRowCut = rowRem > 0.01;
  const cols = fullCols + (hasColCut ? 1 : 0);
  const rows = fullRows + (hasRowCut ? 1 : 0);
  const colSizes: number[] = [];
  for (let i = 0; i < fullCols; i++) colSizes.push(tilePx);
  if (hasColCut) colSizes.push(+(colRem * tilePx).toFixed(2));
  const rowSizes: number[] = [];
  for (let i = 0; i < fullRows; i++) rowSizes.push(tilePx);
  if (hasRowCut) rowSizes.push(+(rowRem * tilePx).toFixed(2));
  return { cols, rows, fullCols, fullRows, hasColCut, hasRowCut, colSizes, rowSizes };
}

export function isCutCell(grid: Grid, r: number, c: number): boolean {
  return (grid.hasColCut && c === grid.cols - 1) || (grid.hasRowCut && r === grid.rows - 1);
}
