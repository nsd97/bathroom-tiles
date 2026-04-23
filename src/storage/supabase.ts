import type {
  RealtimePostgresChangesPayload,
  SupabaseClient,
} from '@supabase/supabase-js';
import type { Surface } from '@/core/state';
import type { Tile, TileShape } from '@/core/tile';

/**
 * A `tiles` row as fetched from Supabase: the core `Tile` domain model plus
 * storage-layer metadata (created_by). Kept out of `core/tile.ts` so that
 * UI modules depend only on the minimal `Tile` interface. `TileRow[]` is
 * assignable to `Tile[]` since TileRow extends Tile.
 */
export interface TileRow extends Tile {
  createdBy: string | null;
}

export interface VersionRow {
  id: string;
  label: string;
  createdAt: string;
  surfacesSnapshot: unknown;
  paintedCellsSnapshot: unknown;
  settingsSnapshot: unknown;
  schemaVersion: number;
  createdBy: string | null;
}

export interface LoadedState {
  tileLibrary: TileRow[];
  surfaces: Surface[];
  paintedCells: Record<string, Map<string, string>>;
  settings: { ceilFt: number; palette: string[]; selectedColor: string };
  versions: VersionRow[];
}

// --- Internal DB row shapes (snake_case). These describe what Supabase
// returns for each select(). Using `as unknown as T[]` at the query boundary
// gives TS schema-drift protection without the client needing generated types.

export interface TileDbRow {
  id: string;
  shape: string;
  size_in: number | string;
  label: string;
  created_by: string | null;
}

export interface SurfaceDbRow {
  id: string;
  group: Surface['group'];
  name: string;
  width_in: number | string;
  height_in: number | string;
  note: string | null;
  height_locked: boolean;
  tile_id: string;
}

export interface PaintedCellDbRow {
  surface_id: string;
  cell_key: string;
  color: string;
}

export interface ProjectSettingsDbRow {
  id: number;
  ceil_ft: number | string;
  palette: string[] | null;
  selected_color: string;
}

export interface VersionDbRow {
  id: string;
  label: string;
  created_at: string;
  surfaces_snapshot: unknown;
  painted_cells_snapshot: unknown;
  settings_snapshot: unknown;
  schema_version: number;
  created_by: string | null;
}

/**
 * Load all persisted state from Supabase in parallel. Maps snake_case columns
 * to camelCase fields and groups `painted_cells` rows into a Map per surface.
 * Bubbles a descriptive error if any query fails.
 *
 * Throws if the `project_settings` singleton row is missing (migration drift).
 */
export async function fetchAll(client: SupabaseClient): Promise<LoadedState> {
  const [tilesQ, surfacesQ, cellsQ, settingsQ, versionsQ] = await Promise.all([
    client.from('tiles').select('id,shape,size_in,label,created_by'),
    client
      .from('surfaces')
      .select('id,group,name,width_in,height_in,note,height_locked,tile_id'),
    client.from('painted_cells').select('surface_id,cell_key,color'),
    client.from('project_settings').select('id,ceil_ft,palette,selected_color'),
    client
      .from('versions')
      .select(
        'id,label,created_at,surfaces_snapshot,painted_cells_snapshot,settings_snapshot,schema_version,created_by',
      )
      .order('created_at', { ascending: false }),
  ]);

  for (const q of [tilesQ, surfacesQ, cellsQ, settingsQ, versionsQ]) {
    if (q.error) throw new Error(`Supabase fetch failed: ${q.error.message}`);
  }

  const tileRows = (tilesQ.data ?? []) as unknown as TileDbRow[];
  const tileLibrary: TileRow[] = tileRows.map((r) => ({
    id: r.id,
    shape: r.shape as TileShape,
    sizeIn: Number(r.size_in),
    label: r.label,
    createdBy: r.created_by ?? null,
  }));

  const surfaceRows = (surfacesQ.data ?? []) as unknown as SurfaceDbRow[];
  const surfaces: Surface[] = surfaceRows.map((r) => ({
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
  const cellRows = (cellsQ.data ?? []) as unknown as PaintedCellDbRow[];
  for (const c of cellRows) {
    let m = paintedCells[c.surface_id];
    if (!m) {
      m = new Map();
      paintedCells[c.surface_id] = m;
    }
    m.set(c.cell_key, c.color);
  }

  const settingsRows = (settingsQ.data ?? []) as unknown as ProjectSettingsDbRow[];
  const settingsRow = settingsRows[0];
  if (!settingsRow) {
    throw new Error('project_settings row missing — run migrations?');
  }
  const settings = {
    ceilFt: Number(settingsRow.ceil_ft),
    palette: (settingsRow.palette ?? []) as string[],
    selectedColor: settingsRow.selected_color,
  };

  const versionRows = (versionsQ.data ?? []) as unknown as VersionDbRow[];
  const versions: VersionRow[] = versionRows.map((r) => ({
    id: r.id,
    label: r.label,
    createdAt: r.created_at,
    surfacesSnapshot: r.surfaces_snapshot,
    paintedCellsSnapshot: r.painted_cells_snapshot,
    settingsSnapshot: r.settings_snapshot,
    schemaVersion: r.schema_version,
    createdBy: r.created_by ?? null,
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

/**
 * Insert a tile and return it mapped to the camelCase `Tile` shape. Uses
 * `.select().single()` to get the created row.
 *
 * If `input.id` is omitted the DB default (`gen_random_uuid()`) generates the
 * primary key. If `input.id` is supplied, that value is used — this is how
 * the tile-library UI seeds an echo-suppression key (`tile:<id>`) BEFORE
 * awaiting the insert, avoiding a realtime-echo race.
 */
export async function createTile(
  client: SupabaseClient,
  input: { id?: string; shape: TileShape; sizeIn: number; label: string },
): Promise<Tile> {
  const payload: Record<string, unknown> = {
    shape: input.shape,
    size_in: input.sizeIn,
    label: input.label,
  };
  if (input.id !== undefined) payload['id'] = input.id;
  const { data, error } = await client
    .from('tiles')
    .insert(payload)
    .select()
    .single();
  if (error) throw new Error(`createTile failed: ${error.message}`);
  const row = data as unknown as TileDbRow;
  return {
    id: row.id,
    shape: row.shape as TileShape,
    sizeIn: Number(row.size_in),
    label: row.label,
  };
}

/**
 * Delete a tile. If the row is referenced by any surface, Postgres FK-restrict
 * will reject the delete and the error message is bubbled as-is.
 */
export async function deleteTile(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('tiles').delete().eq('id', id);
  if (error) throw new Error(`deleteTile failed: ${error.message}`);
}

/** Update a surface's width/height. */
export async function updateSurfaceDims(
  client: SupabaseClient,
  id: string,
  dims: { widthIn: number; heightIn: number },
): Promise<void> {
  const { error } = await client
    .from('surfaces')
    .update({ width_in: dims.widthIn, height_in: dims.heightIn })
    .eq('id', id);
  if (error) throw new Error(`updateSurfaceDims failed: ${error.message}`);
}

/** Assign a different tile to a surface. */
export async function setSurfaceTile(
  client: SupabaseClient,
  surfaceId: string,
  tileId: string,
): Promise<void> {
  const { error } = await client
    .from('surfaces')
    .update({ tile_id: tileId })
    .eq('id', surfaceId);
  if (error) throw new Error(`setSurfaceTile failed: ${error.message}`);
}

/**
 * Patch the singleton `project_settings` row (id=1). Only the camelCase keys
 * present in `partial` are mapped and sent; omitting a key leaves the DB
 * value unchanged. No-op when `partial` is empty.
 */
export async function updateSettings(
  client: SupabaseClient,
  partial: { ceilFt?: number; palette?: string[]; selectedColor?: string },
): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (partial.ceilFt !== undefined) patch['ceil_ft'] = partial.ceilFt;
  if (partial.palette !== undefined) patch['palette'] = partial.palette;
  if (partial.selectedColor !== undefined) patch['selected_color'] = partial.selectedColor;
  if (Object.keys(patch).length === 0) return;
  const { error } = await client.from('project_settings').update(patch).eq('id', 1);
  if (error) throw new Error(`updateSettings failed: ${error.message}`);
}

export interface VersionSnapshots {
  surfaces: unknown;
  paintedCells: unknown;
  settings: unknown;
}

/**
 * Insert a versions row carrying JSON snapshots of surfaces / painted cells /
 * settings, and return the new row mapped to `VersionRow`.
 */
export async function saveVersion(
  client: SupabaseClient,
  label: string,
  snapshots: VersionSnapshots,
): Promise<VersionRow> {
  const { data, error } = await client
    .from('versions')
    .insert({
      label,
      surfaces_snapshot: snapshots.surfaces,
      painted_cells_snapshot: snapshots.paintedCells,
      settings_snapshot: snapshots.settings,
    })
    .select()
    .single();
  if (error) throw new Error(`saveVersion failed: ${error.message}`);
  const row = data as unknown as VersionDbRow;
  return {
    id: row.id,
    label: row.label,
    createdAt: row.created_at,
    surfacesSnapshot: row.surfaces_snapshot,
    paintedCellsSnapshot: row.painted_cells_snapshot,
    settingsSnapshot: row.settings_snapshot,
    schemaVersion: row.schema_version,
    createdBy: row.created_by ?? null,
  };
}

/** Delete a single versions row by id. */
export async function deleteVersion(client: SupabaseClient, id: string): Promise<void> {
  const { error } = await client.from('versions').delete().eq('id', id);
  if (error) throw new Error(`deleteVersion failed: ${error.message}`);
}

// --- Snapshot row shapes for restoreVersion. The DB expects snake_case
// rows because the snapshot arrays were serialized directly from DB reads.

interface SurfaceSnapshotRow {
  id: string;
  group: Surface['group'];
  name: string;
  width_in: number;
  height_in: number;
  note: string | null;
  height_locked: boolean;
  tile_id: string;
}

interface PaintedCellSnapshotRow {
  surface_id: string;
  cell_key: string;
  color: string;
}

interface SettingsSnapshotRow {
  id: number;
  ceil_ft: number;
  palette: string[];
  selected_color: string;
}

/** Shape of a snapshot that can be restored. Rows are already in snake_case. */
export interface RestoreSnapshot {
  surfaces: unknown[];
  paintedCells: unknown[];
  settings: unknown;
}

/**
 * Restore working state from a saved snapshot. The sequence is:
 *   1. Upsert all `surfaces` rows from the snapshot.
 *   2. Upsert `project_settings` (id=1).
 *   3. Delete all existing `painted_cells` (PostgREST requires a filter as a
 *      safety net — we use `.not('surface_id', 'is', null)`, which matches
 *      every row since `surface_id` is NOT NULL).
 *   4. Upsert all `painted_cells` from the snapshot.
 *
 * NOT atomic: PostgREST does not expose multi-statement transactions to the
 * client SDK, so a failure partway through may leave the database in an
 * intermediate state. This ordering minimizes damage from partial failure:
 *
 *   - Failure in step 1 or 2 leaves `painted_cells` untouched — the user
 *     still sees their previous design.
 *   - Failure in step 3 (the wipe) leaves prior painted_cells intact; only
 *     surfaces/settings are drifted from before.
 *   - Failure in step 4 after step 3 succeeds leaves an empty `painted_cells`
 *     table; the narrowest partial-loss window. The caller should re-attempt
 *     the restore or warn the user.
 *
 * Each step bubbles its error with a descriptive prefix, and a thrown error
 * aborts the remaining steps so later operations do not run against a
 * partially-restored database.
 */
export async function restoreVersion(
  client: SupabaseClient,
  snapshot: RestoreSnapshot,
): Promise<void> {
  // Step 1: upsert surfaces.
  const surfRes = await client
    .from('surfaces')
    .upsert(snapshot.surfaces as unknown as SurfaceSnapshotRow[]);
  if (surfRes.error) throw new Error(`restoreVersion failed: ${surfRes.error.message}`);

  // Step 2: upsert project_settings.
  const setRes = await client
    .from('project_settings')
    .upsert(snapshot.settings as unknown as SettingsSnapshotRow);
  if (setRes.error) throw new Error(`restoreVersion failed: ${setRes.error.message}`);

  // Step 3: wipe existing painted_cells.
  const clearRes = await client
    .from('painted_cells')
    .delete()
    .not('surface_id', 'is', null);
  if (clearRes.error) throw new Error(`restoreVersion failed: ${clearRes.error.message}`);

  // Step 4: upsert painted_cells (if any).
  if (snapshot.paintedCells.length > 0) {
    const cellsRes = await client
      .from('painted_cells')
      .upsert(snapshot.paintedCells as unknown as PaintedCellSnapshotRow[]);
    if (cellsRes.error) throw new Error(`restoreVersion failed: ${cellsRes.error.message}`);
  }
}

// --- Realtime subscription + echo suppression --------------------------------

/**
 * A change event surfaced to the UI layer. `row` is the new row for
 * insert/update; for deletes we copy `oldRow` into `row` so that consumers
 * always have a populated `row` to index into. `oldRow` is present for
 * update/delete and undefined for insert.
 *
 * `TRow` narrows the row shape per-table (see the `*DbRow` interfaces).
 * Defaults to `Record<string, unknown>` when no narrowing is needed.
 */
export interface Change<TRow = Record<string, unknown>> {
  kind: 'insert' | 'update' | 'delete';
  row: TRow;
  oldRow?: TRow;
}

/**
 * Handlers invoked by `subscribeAll` when non-echo realtime events arrive.
 * `project_settings` is a singleton row that only ever updates, so its
 * handler takes a simpler shape.
 */
export interface ChangeHandlers {
  onTile: (change: Change<TileDbRow>) => void;
  onSurface: (change: Change<SurfaceDbRow>) => void;
  onPaintedCell: (change: Change<PaintedCellDbRow>) => void;
  onSettings: (change: { row: ProjectSettingsDbRow }) => void;
  onVersion: (change: Change<VersionDbRow>) => void;
  /**
   * Optional channel-status hook. Invoked by Supabase's realtime client on
   * `SUBSCRIBED` / `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED`. Use this to
   * surface a "Reconnecting…" UI pill or log transport failures.
   */
  onStatus?: (
    status: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED',
    err?: Error,
  ) => void;
}

/**
 * Public alias for the Supabase realtime payload we consume. Typed against a
 * permissive row shape (`Record<string, unknown>`) because each table has a
 * different schema; callers / dispatcher narrow fields explicitly when reading.
 */
export type RealtimePayload = RealtimePostgresChangesPayload<Record<string, unknown>>;

/** Narrow a payload's `new`/`old` (typed as `{}` on some variants) to an index signature. */
function asRow(v: unknown): Record<string, unknown> {
  return (v ?? {}) as Record<string, unknown>;
}

/** Pick a string field out of a row, returning undefined when absent or non-string. */
function strField(row: Record<string, unknown>, key: string): string | undefined {
  const v = row[key];
  return typeof v === 'string' ? v : undefined;
}

/**
 * Compute the echo-suppression key that the controller's mutation path seeded
 * before issuing the write. Returning undefined means "no well-formed key for
 * this payload" — the dispatcher then treats the event as non-echo.
 *
 * Formats (must match those seeded by the controller):
 *   - tile:<id>
 *   - surface:<id>
 *   - painted_cell:<surface_id>:<cell_key>:<color>  (insert/update)
 *     painted_cell:<surface_id>:<cell_key>          (delete)
 *   - settings:1
 *   - version:<id>
 *
 * Pending keys are NOT multiset-safe. If two concurrent mutations produce the
 * same key (e.g., two users paint the same cell with the same color), the
 * first echo will consume the pending key and the second echo will reach
 * handlers. Acceptable for last-write-wins; rely on UI-level reconciliation
 * for the edge case.
 */
function computePendingKey(payload: RealtimePayload): string | undefined {
  const kindTable = payload.table;
  const newRow = asRow(payload.new);
  const oldRow = asRow(payload.old);
  const primary = payload.eventType === 'DELETE' ? oldRow : newRow;

  switch (kindTable) {
    case 'tiles': {
      const id = strField(primary, 'id');
      return id ? `tile:${id}` : undefined;
    }
    case 'surfaces': {
      const id = strField(primary, 'id');
      return id ? `surface:${id}` : undefined;
    }
    case 'painted_cells': {
      const surfaceId = strField(primary, 'surface_id');
      const cellKey = strField(primary, 'cell_key');
      if (!surfaceId || !cellKey) return undefined;
      if (payload.eventType === 'DELETE') {
        return `painted_cell:${surfaceId}:${cellKey}`;
      }
      const color = strField(primary, 'color');
      return color ? `painted_cell:${surfaceId}:${cellKey}:${color}` : undefined;
    }
    case 'project_settings':
      return 'settings:1';
    case 'versions': {
      const id = strField(primary, 'id');
      return id ? `version:${id}` : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * Pure dispatcher: given a realtime payload, either suppress (echo of our own
 * write) or route to the appropriate handler. Exported so tests can exercise
 * it directly without mocking an entire channel.
 *
 * Side-effect: mutates `pendingKeys` by removing the matched key on
 * echo-suppression. Returns `void`.
 */
export function dispatchRealtimeEvent(
  payload: RealtimePayload,
  handlers: ChangeHandlers,
  pendingKeys: Set<string>,
): void {
  const key = computePendingKey(payload);
  if (key && pendingKeys.has(key)) {
    pendingKeys.delete(key);
    return;
  }

  const newRow = asRow(payload.new);
  const oldRow = asRow(payload.old);
  const kind =
    payload.eventType === 'INSERT'
      ? 'insert'
      : payload.eventType === 'UPDATE'
        ? 'update'
        : payload.eventType === 'DELETE'
          ? 'delete'
          : undefined;
  if (!kind) return;

  // Row chosen by kind: insert/update surface `newRow` as the row; delete
  // exposes `oldRow` as the row so consumers always have something to index.
  const row = kind === 'delete' ? oldRow : newRow;
  const oldRowOrUndef = kind === 'insert' ? undefined : oldRow;

  // Cast happens once here at the dispatch boundary; handlers downstream
  // then have typed access to their per-table row shape. `as unknown as T`
  // because each TRow has required fields that the opaque `Record` doesn't
  // structurally satisfy — this matches the schema-drift pattern used for
  // `select()` results above.
  switch (payload.table) {
    case 'tiles':
      handlers.onTile({
        kind,
        row: row as unknown as TileDbRow,
        oldRow: oldRowOrUndef as unknown as TileDbRow | undefined,
      });
      return;
    case 'surfaces':
      handlers.onSurface({
        kind,
        row: row as unknown as SurfaceDbRow,
        oldRow: oldRowOrUndef as unknown as SurfaceDbRow | undefined,
      });
      return;
    case 'painted_cells':
      handlers.onPaintedCell({
        kind,
        row: row as unknown as PaintedCellDbRow,
        oldRow: oldRowOrUndef as unknown as PaintedCellDbRow | undefined,
      });
      return;
    case 'project_settings':
      handlers.onSettings({ row: row as unknown as ProjectSettingsDbRow });
      return;
    case 'versions':
      handlers.onVersion({
        kind,
        row: row as unknown as VersionDbRow,
        oldRow: oldRowOrUndef as unknown as VersionDbRow | undefined,
      });
      return;
    default:
      return;
  }
}

/**
 * Open a single `bathroom-tiles` realtime channel that listens for all
 * postgres_changes on the five app tables. Returns an unsubscribe function
 * that removes the channel from the client.
 *
 * Echo suppression: the caller shares a `Set<string>` that mutation helpers
 * seed with a pending key before each write (see `computePendingKey` for the
 * format). On each event the dispatcher consumes and removes a matching key,
 * or otherwise invokes the corresponding handler. Supabase's SDK retries on
 * CHANNEL_ERROR / TIMED_OUT internally, so we do not layer our own retry.
 *
 * **Contract for callers:** before awaiting any mutation (paintCell,
 * createTile, etc.), call `pendingKeys.add(<key>)` using the same format as
 * `computePendingKey`. If you seed AFTER the await, the realtime echo can
 * race and cause flicker. The canonical pattern is:
 * ```ts
 * const key = `painted_cell:${surfaceId}:${cellKey}:${color}`;
 * pendingKeys.add(key);
 * await paintCell(client, surfaceId, cellKey, color);
 * ```
 */
export function subscribeAll(
  client: SupabaseClient,
  handlers: ChangeHandlers,
  pendingKeys: Set<string>,
): () => void {
  const channel = client.channel('bathroom-tiles');
  const tables = [
    'tiles',
    'surfaces',
    'painted_cells',
    'project_settings',
    'versions',
  ] as const;
  for (const table of tables) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      (payload: RealtimePayload) => dispatchRealtimeEvent(payload, handlers, pendingKeys),
    );
  }
  if (handlers.onStatus) {
    const onStatus = handlers.onStatus;
    channel.subscribe((status, err) => onStatus(status, err));
  } else {
    channel.subscribe();
  }
  return () => {
    client.removeChannel(channel).catch((err: unknown) => {
      console.warn('[storage] removeChannel failed', err);
    });
  };
}
