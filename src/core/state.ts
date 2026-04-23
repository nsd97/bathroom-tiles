import { DEFAULT_PALETTE } from './palette';
import type { Tile } from './tile';

export type Tool = 'paint' | 'eyedrop' | 'erase';
export type ViewMode = '2d' | '3d';
export type SurfaceGroup = 'Floors' | 'Ceiling' | 'Walls';

export interface Surface {
  id: string;
  group: SurfaceGroup;
  name: string;
  widthIn: number;
  heightIn: number;
  tileId: string;
  note?: string;
  heightLocked?: boolean;
}

export interface Orbit {
  rotX: number;
  rotY: number;
}

export interface State {
  ceilFt: number;
  palette: string[];
  selectedColor: string;
  tileLibrary: Tile[];
  tool: Tool;
  surfaces: Surface[];
  tiles: Record<string, Map<string, string>>;
  viewMode: ViewMode;
  orbit: Orbit;
}

export function initialState(): State {
  return {
    ceilFt: 9,
    palette: [...DEFAULT_PALETTE],
    selectedColor: DEFAULT_PALETTE[4]!,
    tool: 'paint',
    surfaces: [],
    tiles: {},
    tileLibrary: [],
    viewMode: '2d',
    orbit: { rotX: -18, rotY: -28 },
  };
}

export function initTiles(
  surfaces: Surface[],
  prev?: Record<string, Map<string, string>>,
): Record<string, Map<string, string>> {
  const tiles: Record<string, Map<string, string>> = {};
  for (const s of surfaces) tiles[s.id] = prev?.[s.id] ?? new Map();
  return tiles;
}
