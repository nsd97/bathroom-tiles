import type { State, Surface, SurfaceGroup } from './state';

/**
 * Plain-JSON shape of a saved project state. The three JSONB columns on the
 * `versions` table serialize directly to/from these three fields. We keep the
 * surface shape camelCase (it matches the in-memory `Surface` type), and cells
 * as nested plain objects instead of `Map`s for JSONB round-trip friendliness.
 *
 * Snapshots intentionally do NOT capture `tileLibrary` — tiles are a shared
 * catalog across versions. Restoring a snapshot whose surfaces reference a
 * tile that has since been deleted is rejected by `restoreIntoState`.
 */
export interface Snapshot {
  surfaces: Array<{
    id: string;
    group: SurfaceGroup;
    name: string;
    widthIn: number;
    heightIn: number;
    note?: string;
    heightLocked?: boolean;
    tileId: string;
  }>;
  paintedCells: Record<string, Record<string, string>>;
  settings: { ceilFt: number; palette: string[]; selectedColor: string };
}

/**
 * Produce a `Snapshot` that captures everything a restore needs to bring the
 * working state back — surfaces, painted cells, and project settings — and
 * nothing it doesn't. Pure: no cloning guarantees, no Supabase, no DOM.
 *
 * Fields omitted on a surface (note / heightLocked) are omitted in the output
 * so a JSON round-trip doesn't invent spurious `undefined`s.
 */
export function buildSnapshot(state: State): Snapshot {
  const surfaces: Snapshot['surfaces'] = state.surfaces.map((s) => {
    const out: Snapshot['surfaces'][number] = {
      id: s.id,
      group: s.group,
      name: s.name,
      widthIn: s.widthIn,
      heightIn: s.heightIn,
      tileId: s.tileId,
    };
    if (s.note !== undefined) out.note = s.note;
    if (s.heightLocked !== undefined) out.heightLocked = s.heightLocked;
    return out;
  });

  const paintedCells: Record<string, Record<string, string>> = {};
  for (const surfaceId of Object.keys(state.tiles)) {
    const map = state.tiles[surfaceId];
    const cells: Record<string, string> = {};
    if (map) {
      for (const [cellKey, color] of map) cells[cellKey] = color;
    }
    paintedCells[surfaceId] = cells;
  }

  return {
    surfaces,
    paintedCells,
    settings: {
      ceilFt: state.ceilFt,
      palette: [...state.palette],
      selectedColor: state.selectedColor,
    },
  };
}

/**
 * Overwrite the mutable fields of `state` with the contents of `snap`. The
 * `tileLibrary` is intentionally left alone — it's a shared catalog that lives
 * outside of versioned state. Before any mutation we verify every surface's
 * `tileId` exists in the current library; if any doesn't, we throw with a
 * `/missing tile/i`-matchable message and leave `state` unmutated.
 */
export function restoreIntoState(state: State, snap: Snapshot): void {
  const validIds = new Set(state.tileLibrary.map((t) => t.id));
  for (const s of snap.surfaces) {
    if (!validIds.has(s.tileId)) {
      throw new Error(`Version references missing tile: ${s.tileId}`);
    }
  }

  const surfaces: Surface[] = snap.surfaces.map((s) => {
    const out: Surface = {
      id: s.id,
      group: s.group,
      name: s.name,
      widthIn: s.widthIn,
      heightIn: s.heightIn,
      tileId: s.tileId,
    };
    if (s.note !== undefined) out.note = s.note;
    if (s.heightLocked !== undefined) out.heightLocked = s.heightLocked;
    return out;
  });

  const tiles: Record<string, Map<string, string>> = {};
  for (const surfaceId of Object.keys(snap.paintedCells)) {
    const cells = snap.paintedCells[surfaceId] ?? {};
    tiles[surfaceId] = new Map(Object.entries(cells));
  }
  // Ensure every surface has an entry (even if empty) so paint handlers
  // can read state.tiles[surfaceId] without a null check.
  for (const s of surfaces) {
    if (!tiles[s.id]) tiles[s.id] = new Map();
  }

  state.surfaces = surfaces;
  state.tiles = tiles;
  state.ceilFt = snap.settings.ceilFt;
  state.palette = [...snap.settings.palette];
  state.selectedColor = snap.settings.selectedColor;
}
