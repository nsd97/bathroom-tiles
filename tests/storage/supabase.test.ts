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
      { id: 't1', shape: 'square', sizeIn: 3, label: 'Square 3"' },
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
  it('deletes all painted_cells, upserts surfaces, upserts settings, then upserts painted_cells', async () => {
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

    // Step 1: painted_cells delete
    expect(fromTable).toHaveBeenNthCalledWith(1, 'painted_cells');
    expect(del).toHaveBeenCalled();
    expect(deleteNot).toHaveBeenCalledWith('surface_id', 'is', null);

    // Step 2: surfaces upsert
    expect(fromTable).toHaveBeenNthCalledWith(2, 'surfaces');
    expect(upsert).toHaveBeenNthCalledWith(1, snapshot.surfaces);

    // Step 3: project_settings upsert (id=1)
    expect(fromTable).toHaveBeenNthCalledWith(3, 'project_settings');
    expect(upsert).toHaveBeenNthCalledWith(2, snapshot.settings);

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
  });

  it('throws a descriptive error when any step fails', async () => {
    const deleteNot = vi.fn().mockResolvedValue({ error: { message: 'clear fail' } });
    const del = vi.fn(() => ({ not: deleteNot }));
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = { from: () => ({ delete: del, upsert }) } as any;
    await expect(
      restoreVersion(client, { surfaces: [], paintedCells: [], settings: {} }),
    ).rejects.toThrow(/restoreVersion failed: clear fail/);
  });
});
