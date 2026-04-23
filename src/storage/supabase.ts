import type { SupabaseClient } from '@supabase/supabase-js';
import type { Surface } from '@/core/state';
import type { Tile, TileShape } from '@/core/tile';

export interface VersionRow {
  id: string;
  label: string;
  createdAt: string;
  surfacesSnapshot: unknown;
  paintedCellsSnapshot: unknown;
  settingsSnapshot: unknown;
}

export interface LoadedState {
  tileLibrary: Tile[];
  surfaces: Surface[];
  paintedCells: Record<string, Map<string, string>>;
  settings: { ceilFt: number; palette: string[]; selectedColor: string };
  versions: VersionRow[];
}

/**
 * Load all persisted state from Supabase in parallel. Maps snake_case columns
 * to camelCase fields and groups `painted_cells` rows into a Map per surface.
 * Bubbles a descriptive error if any query fails.
 */
export async function fetchAll(client: SupabaseClient): Promise<LoadedState> {
  const [tilesQ, surfacesQ, cellsQ, settingsQ, versionsQ] = await Promise.all([
    client.from('tiles').select('id,shape,size_in,label'),
    client
      .from('surfaces')
      .select('id,group,name,width_in,height_in,note,height_locked,tile_id'),
    client.from('painted_cells').select('surface_id,cell_key,color'),
    client.from('project_settings').select('id,ceil_ft,palette,selected_color'),
    client
      .from('versions')
      .select(
        'id,label,created_at,surfaces_snapshot,painted_cells_snapshot,settings_snapshot',
      )
      .order('created_at', { ascending: false }),
  ]);

  for (const q of [tilesQ, surfacesQ, cellsQ, settingsQ, versionsQ]) {
    if (q.error) throw new Error(`Supabase fetch failed: ${q.error.message}`);
  }

  const tileLibrary: Tile[] = (tilesQ.data ?? []).map((r: any) => ({
    id: r.id,
    shape: r.shape as TileShape,
    sizeIn: Number(r.size_in),
    label: r.label,
  }));

  const surfaces: Surface[] = (surfacesQ.data ?? []).map((r: any) => ({
    id: r.id,
    group: r.group,
    name: r.name,
    widthIn: Number(r.width_in),
    heightIn: Number(r.height_in),
    note: r.note ?? undefined,
    heightLocked: !!r.height_locked,
    tileId: r.tile_id,
  }));

  const paintedCells: Record<string, Map<string, string>> = {};
  for (const s of surfaces) paintedCells[s.id] = new Map();
  for (const c of (cellsQ.data ?? []) as Array<{
    surface_id: string;
    cell_key: string;
    color: string;
  }>) {
    let m = paintedCells[c.surface_id];
    if (!m) {
      m = new Map();
      paintedCells[c.surface_id] = m;
    }
    m.set(c.cell_key, c.color);
  }

  const settingsRow = (settingsQ.data ?? [])[0] ?? {
    ceil_ft: 9,
    palette: [],
    selected_color: '#b85450',
  };
  const settings = {
    ceilFt: Number(settingsRow.ceil_ft),
    palette: (settingsRow.palette ?? []) as string[],
    selectedColor: settingsRow.selected_color as string,
  };

  const versions: VersionRow[] = (versionsQ.data ?? []).map((r: any) => ({
    id: r.id,
    label: r.label,
    createdAt: r.created_at,
    surfacesSnapshot: r.surfaces_snapshot,
    paintedCellsSnapshot: r.painted_cells_snapshot,
    settingsSnapshot: r.settings_snapshot,
  }));

  return { tileLibrary, surfaces, paintedCells, settings, versions };
}

/** Upsert a single painted cell. */
export async function paintCell(
  client: SupabaseClient,
  surfaceId: string,
  cellKey: string,
  color: string,
): Promise<void> {
  const { error } = await client
    .from('painted_cells')
    .upsert(
      [{ surface_id: surfaceId, cell_key: cellKey, color }],
      { onConflict: 'surface_id,cell_key' },
    );
  if (error) throw new Error(`paintCell failed: ${error.message}`);
}

/** Batch-upsert many painted cells in one round-trip. No-op for an empty map. */
export async function paintCells(
  client: SupabaseClient,
  surfaceId: string,
  cells: Map<string, string>,
): Promise<void> {
  if (cells.size === 0) return;
  const rows = Array.from(cells, ([cell_key, color]) => ({
    surface_id: surfaceId,
    cell_key,
    color,
  }));
  const { error } = await client
    .from('painted_cells')
    .upsert(rows, { onConflict: 'surface_id,cell_key' });
  if (error) throw new Error(`paintCells failed: ${error.message}`);
}

/** Delete a single painted cell by composite key, using chained .eq() filters. */
export async function eraseCell(
  client: SupabaseClient,
  surfaceId: string,
  cellKey: string,
): Promise<void> {
  const { error } = await client
    .from('painted_cells')
    .delete()
    .eq('surface_id', surfaceId)
    .eq('cell_key', cellKey);
  if (error) throw new Error(`eraseCell failed: ${error.message}`);
}

/**
 * Delete every painted cell belonging to a single surface. Used by the
 * "switching tile shape clears paint" confirm-flow.
 */
export async function eraseSurfacePaint(
  client: SupabaseClient,
  surfaceId: string,
): Promise<void> {
  const { error } = await client
    .from('painted_cells')
    .delete()
    .eq('surface_id', surfaceId);
  if (error) throw new Error(`eraseSurfacePaint failed: ${error.message}`);
}
