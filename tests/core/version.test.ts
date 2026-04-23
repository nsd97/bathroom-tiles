import { describe, expect, it } from 'vitest';
import { buildSnapshot, restoreIntoState } from '@/core/version';
import { initialState } from '@/core/state';
import type { State } from '@/core/state';

/**
 * Build a populated State fixture for snapshot/restore round-trip tests. The
 * tileLibrary entries match every tileId referenced by the surfaces below, so
 * restoreIntoState won't bail on the "missing tile" guard.
 */
function fixtureState(): State {
  const s = initialState();
  s.ceilFt = 10;
  s.palette = ['#111', '#222', '#333'];
  s.selectedColor = '#222';
  s.tileLibrary = [
    { id: 't-sq', shape: 'square', sizeIn: 3, label: 'Square 3"' },
    { id: 't-hex', shape: 'hex-pointy', sizeIn: 2, label: 'Hex (pointy) 2"' },
  ];
  s.surfaces = [
    {
      id: 'floor',
      group: 'Floors',
      name: 'Main',
      widthIn: 130,
      heightIn: 78,
      tileId: 't-sq',
    },
    {
      id: 'wall',
      group: 'Walls',
      name: 'North',
      widthIn: 100,
      heightIn: 108,
      note: 'behind shower',
      heightLocked: true,
      tileId: 't-hex',
    },
  ];
  s.tiles = {
    floor: new Map<string, string>([
      ['0,0', '#111'],
      ['1,0', '#222'],
    ]),
    wall: new Map<string, string>([['3,5', '#333']]),
  };
  return s;
}

describe('buildSnapshot', () => {
  it('captures every surface with its persisted fields', () => {
    const snap = buildSnapshot(fixtureState());
    expect(snap.surfaces).toHaveLength(2);
    const floor = snap.surfaces.find((s) => s.id === 'floor');
    expect(floor).toEqual({
      id: 'floor',
      group: 'Floors',
      name: 'Main',
      widthIn: 130,
      heightIn: 78,
      tileId: 't-sq',
    });
    const wall = snap.surfaces.find((s) => s.id === 'wall');
    expect(wall).toEqual({
      id: 'wall',
      group: 'Walls',
      name: 'North',
      widthIn: 100,
      heightIn: 108,
      note: 'behind shower',
      heightLocked: true,
      tileId: 't-hex',
    });
  });

  it('serializes paintedCells as plain {surfaceId: {cellKey: color}} objects', () => {
    const snap = buildSnapshot(fixtureState());
    expect(snap.paintedCells).toEqual({
      floor: { '0,0': '#111', '1,0': '#222' },
      wall: { '3,5': '#333' },
    });
    // Plain object, not a Map (JSONB round-trip friendliness).
    expect(snap.paintedCells['floor']).not.toBeInstanceOf(Map);
  });

  it('captures the three settings fields', () => {
    const snap = buildSnapshot(fixtureState());
    expect(snap.settings).toEqual({
      ceilFt: 10,
      palette: ['#111', '#222', '#333'],
      selectedColor: '#222',
    });
  });

  it('does NOT include tileLibrary in the snapshot', () => {
    const snap = buildSnapshot(fixtureState());
    // The Snapshot type doesn't have a tileLibrary field. Guard against a
    // future regression where an implementer tacks it on for "convenience".
    expect((snap as unknown as Record<string, unknown>)['tileLibrary']).toBeUndefined();
  });

  it('handles a surface with no painted cells (empty map → empty object)', () => {
    const s = fixtureState();
    s.tiles['floor'] = new Map();
    const snap = buildSnapshot(s);
    expect(snap.paintedCells['floor']).toEqual({});
  });
});

describe('restoreIntoState', () => {
  it('overwrites surfaces, tiles (as Maps), ceilFt, palette, and selectedColor', () => {
    const src = fixtureState();
    const snap = buildSnapshot(src);

    // Fresh target with a different tileLibrary that covers the snapshot's refs.
    const target = initialState();
    target.tileLibrary = [
      { id: 't-sq', shape: 'square', sizeIn: 3, label: 'Square 3"' },
      { id: 't-hex', shape: 'hex-pointy', sizeIn: 2, label: 'Hex (pointy) 2"' },
    ];
    // Perturb the target so we can verify overwrite.
    target.ceilFt = 7;
    target.palette = ['#fff'];
    target.selectedColor = '#fff';
    target.surfaces = [];
    target.tiles = {};

    restoreIntoState(target, snap);

    expect(target.ceilFt).toBe(10);
    expect(target.palette).toEqual(['#111', '#222', '#333']);
    expect(target.selectedColor).toBe('#222');
    expect(target.surfaces).toHaveLength(2);
    expect(target.tiles['floor']).toBeInstanceOf(Map);
    expect(target.tiles['floor']!.get('0,0')).toBe('#111');
    expect(target.tiles['floor']!.get('1,0')).toBe('#222');
    expect(target.tiles['wall']!.get('3,5')).toBe('#333');
  });

  it('does NOT touch state.tileLibrary', () => {
    const snap = buildSnapshot(fixtureState());
    const target = initialState();
    const library = [
      { id: 't-sq', shape: 'square' as const, sizeIn: 3, label: 'Square 3"' },
      { id: 't-hex', shape: 'hex-pointy' as const, sizeIn: 2, label: 'Hex (pointy) 2"' },
      { id: 't-extra', shape: 'square' as const, sizeIn: 5, label: 'Square 5"' },
    ];
    target.tileLibrary = library;
    restoreIntoState(target, snap);
    // Library reference preserved; snapshot does not clobber it.
    expect(target.tileLibrary).toBe(library);
    expect(target.tileLibrary).toHaveLength(3);
  });

  it('throws /missing tile/i when a snapshot surface references an unknown tileId', () => {
    const snap = buildSnapshot(fixtureState());
    const target = initialState();
    // Library is missing "t-hex" — restore must refuse.
    target.tileLibrary = [
      { id: 't-sq', shape: 'square', sizeIn: 3, label: 'Square 3"' },
    ];
    expect(() => restoreIntoState(target, snap)).toThrow(/missing tile/i);
  });

  it('produces empty cell maps for surfaces with no painted cells in the snapshot', () => {
    const src = fixtureState();
    src.tiles['wall'] = new Map();
    const snap = buildSnapshot(src);
    const target = initialState();
    target.tileLibrary = src.tileLibrary;
    restoreIntoState(target, snap);
    expect(target.tiles['wall']).toBeInstanceOf(Map);
    expect(target.tiles['wall']!.size).toBe(0);
  });

  it('round-trips: buildSnapshot → restoreIntoState preserves surfaces/cells/settings', () => {
    const src = fixtureState();
    const snap = buildSnapshot(src);

    // Clone the snapshot via JSON so we prove it survives JSONB serialization
    // (saveVersion pushes the snapshot through Postgres JSON columns).
    const cloned = JSON.parse(JSON.stringify(snap));

    const target = initialState();
    target.tileLibrary = src.tileLibrary;
    restoreIntoState(target, cloned);

    expect(target.ceilFt).toBe(src.ceilFt);
    expect(target.palette).toEqual(src.palette);
    expect(target.selectedColor).toBe(src.selectedColor);
    expect(target.surfaces).toEqual(src.surfaces);

    // Compare tiles by materializing both sides to plain objects — Map deep
    // equality via toEqual works but this is more explicit.
    const normalize = (t: Record<string, Map<string, string>>) =>
      Object.fromEntries(
        Object.entries(t).map(([k, m]) => [k, Object.fromEntries(m)]),
      );
    expect(normalize(target.tiles)).toEqual(normalize(src.tiles));
  });
});
