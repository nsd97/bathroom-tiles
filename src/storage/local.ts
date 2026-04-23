import type { State } from '@/core/state';
import { defaultSurfaces, initTiles } from '@/core/state';

const STORAGE_KEY = 'tilePlanner.v2';

export interface SavedShape {
  ceilFt?: number;
  palette?: string[];
  selectedColor?: string;
  surfaces?: Array<{ id: string; widthIn?: number; heightIn?: number }>;
  tiles?: Record<string, Record<string, string>>;
  viewMode?: '2d' | '3d';
  orbit?: { rotX: number; rotY: number };
}

export function loadSaved(): SavedShape | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as SavedShape;
  } catch {
    // ignore
  }
  return null;
}

export function serializeTiles(tiles: State['tiles']): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const [k, m] of Object.entries(tiles)) out[k] = Object.fromEntries(m);
  return out;
}

export function persist(state: State): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ceilFt: state.ceilFt,
      palette: state.palette,
      selectedColor: state.selectedColor,
      surfaces: state.surfaces.map(s => ({ id: s.id, widthIn: s.widthIn, heightIn: s.heightIn })),
      tiles: serializeTiles(state.tiles),
      viewMode: state.viewMode,
      orbit: state.orbit,
    }));
  } catch {
    // ignore
  }
}

export function applySaved(state: State, saved: SavedShape): void {
  if (typeof saved.ceilFt === 'number') state.ceilFt = saved.ceilFt;
  if (Array.isArray(saved.palette) && saved.palette.length) state.palette = saved.palette;
  if (saved.selectedColor) state.selectedColor = saved.selectedColor;
  if (saved.viewMode === '2d' || saved.viewMode === '3d') state.viewMode = saved.viewMode;
  if (saved.orbit && typeof saved.orbit.rotX === 'number' && typeof saved.orbit.rotY === 'number') {
    state.orbit = saved.orbit;
  }
  // Reset surfaces to defaults so heightLocked walls re-derive from current ceiling; saved widths/heights overlay below.
  state.surfaces = defaultSurfaces(state.ceilFt);
  if (Array.isArray(saved.surfaces)) {
    const ov = Object.fromEntries(saved.surfaces.map(s => [s.id, s]));
    state.surfaces = state.surfaces.map(s => {
      const o = ov[s.id];
      if (!o) return s;
      const m = { ...s };
      if (typeof o.widthIn === 'number') m.widthIn = o.widthIn;
      if (typeof o.heightIn === 'number') m.heightIn = o.heightIn;
      return m;
    });
  }
  const prev: Record<string, Map<string, string>> = {};
  if (saved.tiles) {
    for (const [id, obj] of Object.entries(saved.tiles)) prev[id] = new Map(Object.entries(obj));
  }
  state.tiles = initTiles(state.surfaces, prev);
}
