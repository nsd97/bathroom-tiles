import { describe, expect, it, vi } from 'vitest';
import {
  fetchAll,
  paintCell,
  paintCells,
  eraseCell,
  eraseSurfacePaint,
  createTile,
  deleteTile,
  updateSurfaceDims,
  setSurfaceTile,
  updateSettings,
  saveVersion,
  deleteVersion,
  restoreVersion,
  dispatchRealtimeEvent,
  subscribeAll,
  type ChangeHandlers,
  type RealtimePayload,
} from '@/storage/supabase';

/**
 * Minimal thenable that resolves to {data, error}. Also exposes a `.order()` chain
 * method that returns an identical thenable, so query chains like
 * `from(t).select(...)` and `from(t).select(...).order(...)` both resolve properly.
 */
function makeResult(data: unknown, error: unknown = null) {
  const result = { data, error };
  const thenable: any = {
    then: (resolve: (v: any) => void) => resolve(result),
    order: vi.fn(() => thenable),
  };
  return thenable;
}

function mockReadClient(rows: Record<string, any[]>) {
  return {
    from(table: string) {
      const data = rows[table] ?? [];
      return {
        select: vi.fn(() => makeResult(data)),
      };
    },
  } as any;
}

describe('fetchAll', () => {
  it('loads tiles, surfaces, painted cells, settings, versions and maps snake_case to camelCase', async () => {
    const client = mockReadClient({
      tiles: [{ id: 't1', shape: 'square', size_in: 3, label: 'Square 3"' }],
      surfaces: [
        {
          id: 'main',
          group: 'Floors',
          name: 'Main',
          width_in: 130,
          height_in: 78,
          note: null,
          height_locked: false,
          tile_id: 't1',
        },
      ],
      painted_cells: [{ surface_id: 'main', cell_key: '0,0', color: '#fff' }],
      project_settings: [
        { id: 1, ceil_ft: 9, palette: ['#fff'], selected_color: '#fff' },
      ],
      versions: [],
    });

    const result = await fetchAll(client);

    expect(result.tileLibrary).toEqual([
      { id: 't1', shape: 'square', sizeIn: 3, label: 'Square 3"', createdBy: null },
    ]);
    expect(result.surfaces).toHaveLength(1);
    expect(result.surfaces[0]!.tileId).toBe('t1');
    expect(result.surfaces[0]!.widthIn).toBe(130);
    expect(result.surfaces[0]!.heightIn).toBe(78);
    expect(result.surfaces[0]!.group).toBe('Floors');
    expect(result.paintedCells['main']).toBeInstanceOf(Map);
    expect(result.paintedCells['main']!.get('0,0')).toBe('#fff');
    expect(result.settings.ceilFt).toBe(9);
    expect(result.settings.palette).toEqual(['#fff']);
    expect(result.settings.selectedColor).toBe('#fff');
    expect(result.versions).toEqual([]);
  });

  it('returns an empty Map for a surface with no painted cells', async () => {
    const client = mockReadClient({
      tiles: [{ id: 't1', shape: 'square', size_in: 3, label: 'Square 3"' }],
      surfaces: [
        {
          id: 'blank',
          group: 'Walls',
          name: 'Blank',
          width_in: 10,
          height_in: 10,
          note: null,
          height_locked: false,
          tile_id: 't1',
        },
      ],
      painted_cells: [],
      project_settings: [{ id: 1, ceil_ft: 9, palette: [], selected_color: '#000' }],
      versions: [],
    });
    const result = await fetchAll(client);
    expect(result.paintedCells['blank']).toBeInstanceOf(Map);
    expect(result.paintedCells['blank']!.size).toBe(0);
  });

  it('bubbles a readable error when any query fails', async () => {
    const client = {
      from(table: string) {
        if (table === 'surfaces') {
          return { select: vi.fn(() => makeResult(null, { message: 'boom' })) };
        }
        return { select: vi.fn(() => makeResult([])) };
      },
    } as any;
    await expect(fetchAll(client)).rejects.toThrow(/boom/);
  });

  it('throws when project_settings has zero rows (migration drift)', async () => {
    const client = mockReadClient({
      tiles: [],
      surfaces: [],
      painted_cells: [],
      project_settings: [],
      versions: [],
    });
    await expect(fetchAll(client)).rejects.toThrow(/project_settings row missing/);
  });

  it('surfaces schema_version and created_by on versions rows', async () => {
    const client = mockReadClient({
      tiles: [],
      surfaces: [],
      painted_cells: [],
      project_settings: [{ id: 1, ceil_ft: 9, palette: [], selected_color: '#000' }],
      versions: [
        {
          id: 'v1',
          label: 'snap',
          created_at: '2026-04-23T00:00:00Z',
          surfaces_snapshot: [],
          painted_cells_snapshot: [],
          settings_snapshot: {},
          schema_version: 1,
          created_by: 'user-uuid',
        },
      ],
    });
    const result = await fetchAll(client);
    expect(result.versions).toHaveLength(1);
    expect(result.versions[0]!.schemaVersion).toBe(1);
    expect(result.versions[0]!.createdBy).toBe('user-uuid');
  });

  it('surfaces created_by on tiles rows (null when unset)', async () => {
    const client = mockReadClient({
      tiles: [
        { id: 't1', shape: 'square', size_in: 3, label: 'Square 3"', created_by: null },
      ],
      surfaces: [],
      painted_cells: [],
      project_settings: [{ id: 1, ceil_ft: 9, palette: [], selected_color: '#000' }],
      versions: [],
    });
    const result = await fetchAll(client);
    expect(result.tileLibrary).toHaveLength(1);
    expect(result.tileLibrary[0]!.createdBy).toBeNull();
  });
});

describe('paintCell', () => {
  it('upserts one painted_cells row with composite onConflict', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const from = vi.fn(() => ({ upsert }));
    const client = { from } as any;
    await paintCell(client, 'main', '3,5', '#abc');
    expect(from).toHaveBeenCalledWith('painted_cells');
    expect(upsert).toHaveBeenCalledWith(
      [{ surface_id: 'main', cell_key: '3,5', color: '#abc' }],
      { onConflict: 'surface_id,cell_key' },
    );
  });

  it('throws a descriptive error on failure', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: { message: 'nope' } });
    const client = { from: () => ({ upsert }) } as any;
    await expect(paintCell(client, 'main', '3,5', '#abc')).rejects.toThrow(
      /paintCell failed: nope/,
    );
  });
});

describe('paintCells (batch)', () => {
  it('upserts multiple rows in one call', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = { from: () => ({ upsert }) } as any;
    await paintCells(
      client,
      'main',
      new Map([
        ['0,0', '#fff'],
        ['0,1', '#000'],
      ]),
    );
    expect(upsert).toHaveBeenCalledTimes(1);
    const [rows, opts] = upsert.mock.calls[0]!;
    expect(rows).toEqual([
      { surface_id: 'main', cell_key: '0,0', color: '#fff' },
      { surface_id: 'main', cell_key: '0,1', color: '#000' },
    ]);
    expect(opts).toEqual({ onConflict: 'surface_id,cell_key' });
  });

  it('is a no-op for an empty map', async () => {
    const upsert = vi.fn();
    const client = { from: () => ({ upsert }) } as any;
    await paintCells(client, 'main', new Map());
    expect(upsert).not.toHaveBeenCalled();
  });

  it('throws a descriptive error on failure', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: { message: 'bad batch' } });
    const client = { from: () => ({ upsert }) } as any;
    await expect(
      paintCells(client, 'main', new Map([['0,0', '#fff']])),
    ).rejects.toThrow(/paintCells failed: bad batch/);
  });
});

describe('eraseCell', () => {
  it('deletes a painted_cells row via chained eq() calls', async () => {
    const eq2 = vi.fn().mockResolvedValue({ error: null });
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const del = vi.fn(() => ({ eq: eq1 }));
    const from = vi.fn(() => ({ delete: del }));
    const client = { from } as any;
    await eraseCell(client, 'main', '3,5');
    expect(from).toHaveBeenCalledWith('painted_cells');
    expect(del).toHaveBeenCalled();
    expect(eq1).toHaveBeenCalledWith('surface_id', 'main');
    expect(eq2).toHaveBeenCalledWith('cell_key', '3,5');
  });

  it('throws a descriptive error on failure', async () => {
    const eq2 = vi.fn().mockResolvedValue({ error: { message: 'del fail' } });
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const del = vi.fn(() => ({ eq: eq1 }));
    const client = { from: () => ({ delete: del }) } as any;
    await expect(eraseCell(client, 'main', '3,5')).rejects.toThrow(
      /eraseCell failed: del fail/,
    );
  });
});

describe('eraseSurfacePaint', () => {
  it('deletes all painted_cells rows for one surface', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const del = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ delete: del }));
    const client = { from } as any;
    await eraseSurfacePaint(client, 'main');
    expect(from).toHaveBeenCalledWith('painted_cells');
    expect(del).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith('surface_id', 'main');
  });

  it('throws a descriptive error on failure', async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: 'surface del fail' } });
    const del = vi.fn(() => ({ eq }));
    const client = { from: () => ({ delete: del }) } as any;
    await expect(eraseSurfacePaint(client, 'main')).rejects.toThrow(
      /eraseSurfacePaint failed: surface del fail/,
    );
  });
});

describe('createTile', () => {
  it('inserts a row and returns the created tile mapped to camelCase', async () => {
    const single = vi.fn().mockResolvedValue({
      data: { id: 'uuid-1', shape: 'square', size_in: 3, label: 'Square 3"' },
      error: null,
    });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));
    const client = { from } as any;

    const tile = await createTile(client, { shape: 'square', sizeIn: 3, label: 'Square 3"' });

    expect(from).toHaveBeenCalledWith('tiles');
    expect(insert).toHaveBeenCalledWith({ shape: 'square', size_in: 3, label: 'Square 3"' });
    expect(tile).toEqual({ id: 'uuid-1', shape: 'square', sizeIn: 3, label: 'Square 3"' });
  });

  it('throws a descriptive error on failure', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'insert fail' } });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const client = { from: () => ({ insert }) } as any;
    await expect(
      createTile(client, { shape: 'square', sizeIn: 3, label: 'Square 3"' }),
    ).rejects.toThrow(/createTile failed: insert fail/);
  });
});

describe('deleteTile', () => {
  it('deletes a tile by id', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const del = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ delete: del }));
    const client = { from } as any;
    await deleteTile(client, 'uuid-1');
    expect(from).toHaveBeenCalledWith('tiles');
    expect(eq).toHaveBeenCalledWith('id', 'uuid-1');
  });

  it('throws a descriptive error when FK restrict rejects the delete', async () => {
    const eq = vi.fn().mockResolvedValue({
      error: { message: 'violates foreign key constraint' },
    });
    const del = vi.fn(() => ({ eq }));
    const client = { from: () => ({ delete: del }) } as any;
    await expect(deleteTile(client, 'uuid-1')).rejects.toThrow(
      /deleteTile failed: violates foreign key constraint/,
    );
  });
});

describe('updateSurfaceDims', () => {
  it('updates a single surface row via one .update().eq() call', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    const client = { from } as any;
    await updateSurfaceDims(client, 'main', { widthIn: 120, heightIn: 80 });
    expect(from).toHaveBeenCalledWith('surfaces');
    expect(update).toHaveBeenCalledWith({ width_in: 120, height_in: 80 });
    expect(eq).toHaveBeenCalledWith('id', 'main');
  });

  it('throws a descriptive error on failure', async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: 'upd fail' } });
    const update = vi.fn(() => ({ eq }));
    const client = { from: () => ({ update }) } as any;
    await expect(
      updateSurfaceDims(client, 'main', { widthIn: 120, heightIn: 80 }),
    ).rejects.toThrow(/updateSurfaceDims failed: upd fail/);
  });
});

describe('setSurfaceTile', () => {
  it("updates a surface's tile_id", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    const client = { from } as any;
    await setSurfaceTile(client, 'main', 'tile-7');
    expect(from).toHaveBeenCalledWith('surfaces');
    expect(update).toHaveBeenCalledWith({ tile_id: 'tile-7' });
    expect(eq).toHaveBeenCalledWith('id', 'main');
  });

  it('throws a descriptive error on failure', async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: 'assign fail' } });
    const update = vi.fn(() => ({ eq }));
    const client = { from: () => ({ update }) } as any;
    await expect(setSurfaceTile(client, 'main', 'tile-7')).rejects.toThrow(
      /setSurfaceTile failed: assign fail/,
    );
  });
});

describe('updateSettings', () => {
  it('updates only the keys provided (camelCase to snake_case)', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));
    const client = { from } as any;
    await updateSettings(client, { ceilFt: 10, selectedColor: '#abc' });
    expect(from).toHaveBeenCalledWith('project_settings');
    expect(update).toHaveBeenCalledWith({ ceil_ft: 10, selected_color: '#abc' });
    expect(eq).toHaveBeenCalledWith('id', 1);
  });

  it('maps palette key', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({ eq }));
    const client = { from: () => ({ update }) } as any;
    await updateSettings(client, { palette: ['#fff', '#000'] });
    expect(update).toHaveBeenCalledWith({ palette: ['#fff', '#000'] });
  });

  it('is a no-op when partial is empty', async () => {
    const update = vi.fn();
    const client = { from: () => ({ update }) } as any;
    await updateSettings(client, {});
    expect(update).not.toHaveBeenCalled();
  });

  it('throws a descriptive error on failure', async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: 'settings fail' } });
    const update = vi.fn(() => ({ eq }));
    const client = { from: () => ({ update }) } as any;
    await expect(updateSettings(client, { ceilFt: 10 })).rejects.toThrow(
      /updateSettings failed: settings fail/,
    );
  });
});

describe('saveVersion', () => {
  it('inserts a versions row with snapshots and returns mapped VersionRow', async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: 'v1',
        label: 'snapshot A',
        created_at: '2026-04-23T00:00:00Z',
        surfaces_snapshot: [{ id: 'main' }],
        painted_cells_snapshot: { main: {} },
        settings_snapshot: { ceil_ft: 9 },
        schema_version: 1,
        created_by: 'user-uuid',
      },
      error: null,
    });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const from = vi.fn(() => ({ insert }));
    const client = { from } as any;
    const snapshots = {
      surfaces: [{ id: 'main' }] as unknown,
      paintedCells: { main: {} } as unknown,
      settings: { ceil_ft: 9 } as unknown,
    };
    const row = await saveVersion(client, 'snapshot A', snapshots);
    expect(from).toHaveBeenCalledWith('versions');
    expect(insert).toHaveBeenCalledWith({
      label: 'snapshot A',
      surfaces_snapshot: snapshots.surfaces,
      painted_cells_snapshot: snapshots.paintedCells,
      settings_snapshot: snapshots.settings,
    });
    expect(row).toEqual({
      id: 'v1',
      label: 'snapshot A',
      createdAt: '2026-04-23T00:00:00Z',
      surfacesSnapshot: [{ id: 'main' }],
      paintedCellsSnapshot: { main: {} },
      settingsSnapshot: { ceil_ft: 9 },
      schemaVersion: 1,
      createdBy: 'user-uuid',
    });
  });

  it('throws a descriptive error on failure', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { message: 'save fail' } });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    const client = { from: () => ({ insert }) } as any;
    await expect(
      saveVersion(client, 'x', { surfaces: [], paintedCells: {}, settings: {} }),
    ).rejects.toThrow(/saveVersion failed: save fail/);
  });
});

describe('deleteVersion', () => {
  it('deletes a versions row by id', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const del = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ delete: del }));
    const client = { from } as any;
    await deleteVersion(client, 'v1');
    expect(from).toHaveBeenCalledWith('versions');
    expect(eq).toHaveBeenCalledWith('id', 'v1');
  });

  it('throws a descriptive error on failure', async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: 'dv fail' } });
    const del = vi.fn(() => ({ eq }));
    const client = { from: () => ({ delete: del }) } as any;
    await expect(deleteVersion(client, 'v1')).rejects.toThrow(/deleteVersion failed: dv fail/);
  });
});

describe('restoreVersion', () => {
  it('upserts surfaces, upserts settings, deletes all painted_cells, then upserts painted_cells', async () => {
    const deleteNot = vi.fn().mockResolvedValue({ error: null });
    const del = vi.fn(() => ({ not: deleteNot }));
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const fromTable = vi.fn((_table: string) => ({ delete: del, upsert }));
    const client = { from: fromTable } as any;

    const snapshot = {
      surfaces: [
        {
          id: 'main',
          group: 'Floors',
          name: 'Main',
          width_in: 130,
          height_in: 78,
          note: null,
          height_locked: false,
          tile_id: 't1',
        },
      ],
      paintedCells: [{ surface_id: 'main', cell_key: '0,0', color: '#fff' }],
      settings: { id: 1, ceil_ft: 9, palette: ['#fff'], selected_color: '#fff' },
    };

    await restoreVersion(client, snapshot);

    // Step 1: surfaces upsert
    expect(fromTable).toHaveBeenNthCalledWith(1, 'surfaces');
    expect(upsert).toHaveBeenNthCalledWith(1, snapshot.surfaces);

    // Step 2: project_settings upsert (id=1)
    expect(fromTable).toHaveBeenNthCalledWith(2, 'project_settings');
    expect(upsert).toHaveBeenNthCalledWith(2, snapshot.settings);

    // Step 3: painted_cells delete
    expect(fromTable).toHaveBeenNthCalledWith(3, 'painted_cells');
    expect(del).toHaveBeenCalled();
    expect(deleteNot).toHaveBeenCalledWith('surface_id', 'is', null);

    // Step 4: painted_cells upsert
    expect(fromTable).toHaveBeenNthCalledWith(4, 'painted_cells');
    expect(upsert).toHaveBeenNthCalledWith(3, snapshot.paintedCells);
  });

  it('skips the final painted_cells upsert when the snapshot is empty', async () => {
    const deleteNot = vi.fn().mockResolvedValue({ error: null });
    const del = vi.fn(() => ({ not: deleteNot }));
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const fromTable = vi.fn((_table: string) => ({ delete: del, upsert }));
    const client = { from: fromTable } as any;
    await restoreVersion(client, {
      surfaces: [{ id: 'main' }],
      paintedCells: [],
      settings: { id: 1 },
    });
    // surfaces, settings -> 2 upserts. No 3rd for painted_cells.
    expect(upsert).toHaveBeenCalledTimes(2);
    // painted_cells delete still runs (we always clear before re-populating)
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('throws a descriptive error when any step fails', async () => {
    // Step 1 (surfaces upsert) now runs first; make it fail.
    const upsert = vi.fn().mockResolvedValue({ error: { message: 'surf fail' } });
    const deleteNot = vi.fn().mockResolvedValue({ error: null });
    const del = vi.fn(() => ({ not: deleteNot }));
    const client = { from: () => ({ delete: del, upsert }) } as any;
    await expect(
      restoreVersion(client, { surfaces: [{ id: 'main' }], paintedCells: [], settings: {} }),
    ).rejects.toThrow(/restoreVersion failed: surf fail/);
  });

  it('aborts subsequent steps when step 1 (surfaces upsert) fails', async () => {
    // Contract: a thrown error in one step stops the serialized sequence —
    // project_settings upsert, painted_cells delete, and painted_cells upsert
    // must not run if surfaces upsert rejects.
    const deleteNot = vi.fn().mockResolvedValue({ error: null });
    const del = vi.fn(() => ({ not: deleteNot }));
    const upsertSurfaces = vi
      .fn()
      .mockResolvedValueOnce({ error: { message: 'surf fail' } });
    const upsertOther = vi.fn().mockResolvedValue({ error: null });

    const fromTable = vi.fn((table: string) => {
      if (table === 'surfaces') return { upsert: upsertSurfaces };
      if (table === 'project_settings') return { upsert: upsertOther };
      if (table === 'painted_cells') return { delete: del, upsert: upsertOther };
      return {};
    });
    const client = { from: fromTable } as any;

    await expect(
      restoreVersion(client, {
        surfaces: [{ id: 'main' }],
        paintedCells: [{ surface_id: 'main', cell_key: '0,0', color: '#fff' }],
        settings: { id: 1 },
      }),
    ).rejects.toThrow(/restoreVersion failed: surf fail/);

    expect(upsertSurfaces).toHaveBeenCalledTimes(1);
    // project_settings upsert must NOT have been called
    // painted_cells delete and upsert must NOT have been called
    expect(upsertOther).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(deleteNot).not.toHaveBeenCalled();
  });
});

/**
 * Build a handlers object where every handler is a vi.fn() spy.
 * Returning them separately keeps each test's assertions readable.
 */
function makeHandlers() {
  const onTile = vi.fn();
  const onSurface = vi.fn();
  const onPaintedCell = vi.fn();
  const onSettings = vi.fn();
  const onVersion = vi.fn();
  const handlers: ChangeHandlers = {
    onTile,
    onSurface,
    onPaintedCell,
    onSettings,
    onVersion,
  };
  return { handlers, onTile, onSurface, onPaintedCell, onSettings, onVersion };
}

/** Build a well-formed RealtimePayload for a given table/event/new/old. */
function mkPayload(
  table: string,
  eventType: 'INSERT' | 'UPDATE' | 'DELETE',
  newRow: Record<string, unknown>,
  oldRow: Record<string, unknown>,
): RealtimePayload {
  return {
    schema: 'public',
    table,
    commit_timestamp: '2026-04-23T00:00:00Z',
    errors: [],
    eventType,
    new: newRow,
    old: oldRow,
  } as RealtimePayload;
}

describe('dispatchRealtimeEvent', () => {
  it('routes a tiles INSERT to onTile with kind=insert', () => {
    const { handlers, onTile } = makeHandlers();
    const payload = mkPayload(
      'tiles',
      'INSERT',
      { id: 't1', shape: 'square', size_in: 3, label: 'Square 3"' },
      {},
    );
    dispatchRealtimeEvent(payload, handlers, new Set());
    expect(onTile).toHaveBeenCalledTimes(1);
    expect(onTile).toHaveBeenCalledWith({
      kind: 'insert',
      row: { id: 't1', shape: 'square', size_in: 3, label: 'Square 3"' },
      oldRow: undefined,
    });
  });

  it('routes a surfaces UPDATE to onSurface with kind=update and oldRow populated', () => {
    const { handlers, onSurface } = makeHandlers();
    const newRow = { id: 'main', width_in: 130 };
    const oldRow = { id: 'main', width_in: 120 };
    dispatchRealtimeEvent(
      mkPayload('surfaces', 'UPDATE', newRow, oldRow),
      handlers,
      new Set(),
    );
    expect(onSurface).toHaveBeenCalledWith({
      kind: 'update',
      row: newRow,
      oldRow,
    });
  });

  it('routes a painted_cells DELETE to onPaintedCell with row=oldRow', () => {
    const { handlers, onPaintedCell } = makeHandlers();
    const oldRow = { surface_id: 'main', cell_key: '3,5', color: '#abc' };
    dispatchRealtimeEvent(
      mkPayload('painted_cells', 'DELETE', {}, oldRow),
      handlers,
      new Set(),
    );
    expect(onPaintedCell).toHaveBeenCalledWith({
      kind: 'delete',
      row: oldRow,
      oldRow,
    });
  });

  it('routes a project_settings UPDATE to onSettings as {row}', () => {
    const { handlers, onSettings, onTile } = makeHandlers();
    const newRow = { id: 1, ceil_ft: 9, palette: [], selected_color: '#fff' };
    dispatchRealtimeEvent(
      mkPayload('project_settings', 'UPDATE', newRow, { id: 1, ceil_ft: 8 }),
      handlers,
      new Set(),
    );
    expect(onSettings).toHaveBeenCalledWith({ row: newRow });
    expect(onTile).not.toHaveBeenCalled();
  });

  it('routes a versions INSERT to onVersion', () => {
    const { handlers, onVersion } = makeHandlers();
    const newRow = { id: 'v1', label: 'snap' };
    dispatchRealtimeEvent(
      mkPayload('versions', 'INSERT', newRow, {}),
      handlers,
      new Set(),
    );
    expect(onVersion).toHaveBeenCalledWith({
      kind: 'insert',
      row: newRow,
      oldRow: undefined,
    });
  });

  it('suppresses and removes a matching pending key for painted_cell insert', () => {
    const { handlers, onPaintedCell } = makeHandlers();
    const pendingKeys = new Set<string>(['painted_cell:main:3,5:#abc']);
    const newRow = { surface_id: 'main', cell_key: '3,5', color: '#abc' };
    dispatchRealtimeEvent(
      mkPayload('painted_cells', 'INSERT', newRow, {}),
      handlers,
      pendingKeys,
    );
    expect(onPaintedCell).not.toHaveBeenCalled();
    expect(pendingKeys.has('painted_cell:main:3,5:#abc')).toBe(false);
  });

  it('suppresses a matching pending key for painted_cell delete (color-less key)', () => {
    const { handlers, onPaintedCell } = makeHandlers();
    const pendingKeys = new Set<string>(['painted_cell:main:3,5']);
    const oldRow = { surface_id: 'main', cell_key: '3,5', color: '#abc' };
    dispatchRealtimeEvent(
      mkPayload('painted_cells', 'DELETE', {}, oldRow),
      handlers,
      pendingKeys,
    );
    expect(onPaintedCell).not.toHaveBeenCalled();
    expect(pendingKeys.has('painted_cell:main:3,5')).toBe(false);
  });

  it('still dispatches when pending key is for a different change', () => {
    const { handlers, onPaintedCell } = makeHandlers();
    const pendingKeys = new Set<string>(['painted_cell:main:0,0:#000']);
    const newRow = { surface_id: 'main', cell_key: '3,5', color: '#abc' };
    dispatchRealtimeEvent(
      mkPayload('painted_cells', 'INSERT', newRow, {}),
      handlers,
      pendingKeys,
    );
    expect(onPaintedCell).toHaveBeenCalledTimes(1);
    // Untouched pending key remains.
    expect(pendingKeys.has('painted_cell:main:0,0:#000')).toBe(true);
  });

  it('computes tile:<id> pending key for tile events', () => {
    const { handlers, onTile } = makeHandlers();
    const pendingKeys = new Set<string>(['tile:t1']);
    dispatchRealtimeEvent(
      mkPayload('tiles', 'UPDATE', { id: 't1', label: 'Renamed' }, { id: 't1', label: 'Old' }),
      handlers,
      pendingKeys,
    );
    expect(onTile).not.toHaveBeenCalled();
    expect(pendingKeys.has('tile:t1')).toBe(false);
  });

  it('computes tile:<id> pending key from oldRow on tile DELETE', () => {
    const { handlers, onTile } = makeHandlers();
    const pendingKeys = new Set<string>(['tile:t1']);
    dispatchRealtimeEvent(
      mkPayload('tiles', 'DELETE', {}, { id: 't1' }),
      handlers,
      pendingKeys,
    );
    expect(onTile).not.toHaveBeenCalled();
    expect(pendingKeys.has('tile:t1')).toBe(false);
  });

  it('computes surface:<id> pending key for surface events', () => {
    const { handlers, onSurface } = makeHandlers();
    const pendingKeys = new Set<string>(['surface:main']);
    dispatchRealtimeEvent(
      mkPayload('surfaces', 'UPDATE', { id: 'main', width_in: 150 }, { id: 'main', width_in: 130 }),
      handlers,
      pendingKeys,
    );
    expect(onSurface).not.toHaveBeenCalled();
    expect(pendingKeys.has('surface:main')).toBe(false);
  });

  it('computes settings:1 pending key for project_settings', () => {
    const { handlers, onSettings } = makeHandlers();
    const pendingKeys = new Set<string>(['settings:1']);
    dispatchRealtimeEvent(
      mkPayload('project_settings', 'UPDATE', { id: 1, ceil_ft: 9 }, { id: 1, ceil_ft: 8 }),
      handlers,
      pendingKeys,
    );
    expect(onSettings).not.toHaveBeenCalled();
    expect(pendingKeys.has('settings:1')).toBe(false);
  });

  it('computes version:<id> pending key for version events', () => {
    const { handlers, onVersion } = makeHandlers();
    const pendingKeys = new Set<string>(['version:v1']);
    dispatchRealtimeEvent(
      mkPayload('versions', 'DELETE', {}, { id: 'v1' }),
      handlers,
      pendingKeys,
    );
    expect(onVersion).not.toHaveBeenCalled();
    expect(pendingKeys.has('version:v1')).toBe(false);
  });

  it('is a no-op for an unknown table (never throws, never dispatches)', () => {
    const { handlers, onTile, onSurface, onPaintedCell, onSettings, onVersion } =
      makeHandlers();
    dispatchRealtimeEvent(
      mkPayload('unknown_table', 'INSERT', { id: 'x' }, {}),
      handlers,
      new Set(),
    );
    expect(onTile).not.toHaveBeenCalled();
    expect(onSurface).not.toHaveBeenCalled();
    expect(onPaintedCell).not.toHaveBeenCalled();
    expect(onSettings).not.toHaveBeenCalled();
    expect(onVersion).not.toHaveBeenCalled();
  });
});

describe('subscribeAll', () => {
  it('registers one .on() per table, calls .subscribe(), and returns an unsubscribe that removes the channel', () => {
    const onCalls: Array<{
      type: string;
      filter: { event: string; schema: string; table: string };
    }> = [];
    const subscribe = vi.fn();
    const chain: Record<string, unknown> = {};
    chain['on'] = vi.fn(
      (
        type: string,
        filter: { event: string; schema: string; table: string },
        _cb: unknown,
      ) => {
        onCalls.push({ type, filter });
        return chain;
      },
    );
    chain['subscribe'] = subscribe;
    const removeChannel = vi.fn();
    const client = {
      channel: vi.fn(() => chain),
      removeChannel,
    } as unknown as Parameters<typeof subscribeAll>[0];

    const handlers: ChangeHandlers = {
      onTile: vi.fn(),
      onSurface: vi.fn(),
      onPaintedCell: vi.fn(),
      onSettings: vi.fn(),
      onVersion: vi.fn(),
    };

    const unsubscribe = subscribeAll(client, handlers, new Set());

    // Channel opened with the agreed name.
    expect((client as unknown as { channel: ReturnType<typeof vi.fn> }).channel)
      .toHaveBeenCalledWith('bathroom-tiles');
    // One .on() per table.
    expect(onCalls.map((c) => c.filter.table).sort()).toEqual(
      ['painted_cells', 'project_settings', 'surfaces', 'tiles', 'versions'].sort(),
    );
    for (const c of onCalls) {
      expect(c.type).toBe('postgres_changes');
      expect(c.filter.event).toBe('*');
      expect(c.filter.schema).toBe('public');
    }
    // Exactly one .subscribe() at the end.
    expect(subscribe).toHaveBeenCalledTimes(1);
    // Unsubscribe calls removeChannel with the channel reference.
    unsubscribe();
    expect(removeChannel).toHaveBeenCalledTimes(1);
    expect(removeChannel).toHaveBeenCalledWith(chain);
  });

  it('wires per-table callbacks through dispatchRealtimeEvent (painted_cells callback triggers onPaintedCell)', () => {
    // Capture the callback registered for painted_cells and invoke it directly
    // to verify the subscribeAll wiring dispatches to handlers correctly.
    const registered: Record<
      string,
      (payload: RealtimePayload) => void
    > = {};
    const chain: Record<string, unknown> = {};
    chain['on'] = vi.fn(
      (
        _type: string,
        filter: { table: string },
        cb: (payload: RealtimePayload) => void,
      ) => {
        registered[filter.table] = cb;
        return chain;
      },
    );
    chain['subscribe'] = vi.fn();
    const client = {
      channel: vi.fn(() => chain),
      removeChannel: vi.fn(),
    } as unknown as Parameters<typeof subscribeAll>[0];

    const handlers = makeHandlers();
    subscribeAll(client, handlers.handlers, new Set());

    const cb = registered['painted_cells'];
    expect(cb).toBeDefined();
    cb!(
      mkPayload(
        'painted_cells',
        'INSERT',
        { surface_id: 'main', cell_key: '0,0', color: '#fff' },
        {},
      ),
    );
    expect(handlers.onPaintedCell).toHaveBeenCalledWith({
      kind: 'insert',
      row: { surface_id: 'main', cell_key: '0,0', color: '#fff' },
      oldRow: undefined,
    });
  });
});
