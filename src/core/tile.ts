export type TileShape = 'square' | 'hex-pointy' | 'hex-flat';

export interface Tile {
  id: string;
  shape: TileShape;
  sizeIn: number;
  label: string;
}

/** Generate a human-readable default label from shape + size. Throws if `sizeIn` is not a positive finite number. */
export function defaultTileLabel(shape: TileShape, sizeIn: number): string {
  if (!Number.isFinite(sizeIn) || sizeIn <= 0) {
    throw new Error(`defaultTileLabel: sizeIn must be a positive finite number (got ${sizeIn})`);
  }
  const size = String(parseFloat(sizeIn.toFixed(2)));
  switch (shape) {
    case 'square':
      return `Square ${size}"`;
    case 'hex-pointy':
      return `Hex (pointy) ${size}"`;
    case 'hex-flat':
      return `Hex (flat) ${size}"`;
  }
}
