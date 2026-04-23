export const TILE_INCH = 7.87;
export const TILE_PX = 18;

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

export function getGrid(s: SurfaceDims): Grid {
  const wTiles = s.widthIn / TILE_INCH;
  const hTiles = s.heightIn / TILE_INCH;
  const fullCols = Math.floor(wTiles + 1e-6);
  const fullRows = Math.floor(hTiles + 1e-6);
  const colRem = +(wTiles - fullCols).toFixed(6);
  const rowRem = +(hTiles - fullRows).toFixed(6);
  const hasColCut = colRem > 0.01;
  const hasRowCut = rowRem > 0.01;
  const cols = fullCols + (hasColCut ? 1 : 0);
  const rows = fullRows + (hasRowCut ? 1 : 0);
  const colSizes: number[] = [];
  for (let i = 0; i < fullCols; i++) colSizes.push(TILE_PX);
  if (hasColCut) colSizes.push(+(colRem * TILE_PX).toFixed(2));
  const rowSizes: number[] = [];
  for (let i = 0; i < fullRows; i++) rowSizes.push(TILE_PX);
  if (hasRowCut) rowSizes.push(+(rowRem * TILE_PX).toFixed(2));
  return { cols, rows, fullCols, fullRows, hasColCut, hasRowCut, colSizes, rowSizes };
}

export function isCutCell(grid: Grid, r: number, c: number): boolean {
  return (grid.hasColCut && c === grid.cols - 1) || (grid.hasRowCut && r === grid.rows - 1);
}
