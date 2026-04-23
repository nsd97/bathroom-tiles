import { describe, expect, it, vi } from 'vitest';
import { fetchAll } from '@/storage/supabase';

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
