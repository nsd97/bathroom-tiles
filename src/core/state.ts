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

/**
 * Slim in-memory projection of a saved version row. The `*Snapshot` fields
 * are the raw JSONB blobs as returned by Supabase — they're consumed by
 * `restoreVersion` and `restoreIntoState` at load time. Kept as `unknown` so
 * `core/state` doesn't have to bake in the snapshot shape (see
 * `core/version.ts` for the validated `Snapshot` type).
 */
export interface Version {
  id: string;
  label: string;
  createdAt: string;
  createdBy: string | null;
  schemaVersion: number;
  surfacesSnapshot: unknown;
  paintedCellsSnapshot: unknown;
  settingsSnapshot: unknown;
}

export interface State {
  ceilFt: number;
  palette: string[];
  selectedColor: string;
  tileLibrary: Tile[];
  tool: Tool;
  surfaces: Surface[];
  tiles: Record<string, Map<string, string>>;
  versions: Version[];
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
    versions: [],
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
