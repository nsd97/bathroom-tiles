export type TileShape = 'square' | 'hex-pointy' | 'hex-flat';

export interface Tile {
  id: string;
  shape: TileShape;
  sizeIn: number;
  label: string;
}

export function defaultTileLabel(shape: TileShape, sizeIn: number): string {
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
