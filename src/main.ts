import './styles/base.css';
import './styles/sidebar.css';
import './styles/canvas.css';
import './styles/preview3d.css';
import './styles/auth.css';

import { supabase } from './auth/client';
import { gateStateFor } from './auth/gate';
import { mountLogin } from './auth/login';
import { initialState } from './core/state';
import type { State, Surface } from './core/state';
import type { Tile } from './core/tile';
import {
  fetchAll,
  subscribeAll,
  paintCells,
  eraseCell,
  updateSettings,
  updateSurfaceDims,
} from './storage/supabase';
import type {
  Change,
  PaintedCellDbRow,
  ProjectSettingsDbRow,
  SurfaceDbRow,
  TileDbRow,
} from './storage/supabase';
import { loadUIPrefs, persistUIPrefs, applyUIPrefs } from './storage/local';
import { mountLayout } from './ui/layout';
import type { LayoutRefs } from './ui/layout';
import { renderSwatches } from './ui/swatches';
import { wireToolButtons } from './ui/tools';
import { renderCounts } from './ui/counts';
import type { CountsRefs } from './ui/counts';
import { renderCanvas, wireCanvasPainting } from './ui/surface';
import type { SurfaceCallbacks } from './ui/surface';

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('missing #app');

  const { data: { session } } = await supabase.auth.getSession();
  let state = gateStateFor(session);

  function render(): void {
    if (state === 'signed-out') {
      mountLogin(root!, { onSent: () => {} });
    } else if (state === 'not-allowed') {
      root!.innerHTML = '<div class="denied">Access denied.</div>';
    } else if (state === 'ready') {
      void mountApp(root!);
    }
  }

  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
    state = gateStateFor(newSession);
    render();
  });

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      subscription.unsubscribe();
    });
  }

  render();
}

async function mountApp(root: HTMLElement): Promise<void> {
  // Clear any residual login/denied screen before mounting layout.
  root.innerHTML = '';
  const refs = mountLayout(root);
  const state = initialState();

  // Hydrate from Supabase. On failure show an inline error — user can refresh.
  let loaded;
  try {
    loaded = await fetchAll(supabase);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    root.innerHTML = `<div class="denied">Failed to load data: ${msg}<br/>Try refreshing.</div>`;
    return;
  }
  state.tileLibrary = loaded.tileLibrary;
  state.surfaces = loaded.surfaces;
  state.tiles = loaded.paintedCells;
  state.ceilFt = loaded.settings.ceilFt;
  state.palette = loaded.settings.palette;
  state.selectedColor = loaded.settings.selectedColor;
  // loaded.versions is ignored here — Phase 8 surfaces the list UI.

  // UI-local prefs (view mode, orbit) stay in localStorage; the rest is server-sourced.
  const ui = loadUIPrefs();
  if (ui) applyUIPrefs(state, ui);
  refs.ceilInput.value = String(state.ceilFt);

  // Shared pending-key set for realtime echo suppression. Every mutation
  // seeds its expected key BEFORE awaiting the write; the dispatcher consumes
  // it when the echo comes back around.
  const pendingKeys = new Set<string>();

  const countsRefs: CountsRefs = {
    countsEl: refs.countsEl,
    totalEl: refs.totalEl,
    fullCutTotalEl: refs.fullCutTotalEl,
    orderTotalEl: refs.orderTotalEl,
  };

  const rerenderCounts = (): void => renderCounts(countsRefs, state);

  // Canvas callbacks — defined before renderCanvas because it wires them into
  // the per-surface dim inputs. Stroke commit pushes one batch per surface.
  const surfaceCb: SurfaceCallbacks = {
    onRerenderCounts: rerenderCounts,
    onRenderSwatches: () => doRenderSwatches(),
    persist: () => {
      // No-op: Supabase is the source of truth; per-action commits handle it.
    },
    onStrokeCommit: (paints, erases) => {
      for (const [surfaceId, cells] of paints) {
        for (const [key, color] of cells) {
          pendingKeys.add(`painted_cell:${surfaceId}:${key}:${color}`);
        }
        paintCells(supabase, surfaceId, cells).catch((e: unknown) => {
          console.warn('[paintCells]', e);
          for (const [key, color] of cells) {
            pendingKeys.delete(`painted_cell:${surfaceId}:${key}:${color}`);
          }
        });
      }
      for (const [surfaceId, keys] of erases) {
        for (const key of keys) {
          pendingKeys.add(`painted_cell:${surfaceId}:${key}`);
          eraseCell(supabase, surfaceId, key).catch((e: unknown) => {
            console.warn('[eraseCell]', e);
            pendingKeys.delete(`painted_cell:${surfaceId}:${key}`);
          });
        }
      }
    },
    onSurfaceDimsCommit: (surfaceId) => {
      const s = state.surfaces.find((x) => x.id === surfaceId);
      if (!s) return;
      const key = `surface:${surfaceId}`;
      pendingKeys.add(key);
      updateSurfaceDims(supabase, surfaceId, { widthIn: s.widthIn, heightIn: s.heightIn }).catch(
        (e: unknown) => {
          console.warn('[updateSurfaceDims]', e);
          pendingKeys.delete(key);
        },
      );
    },
  };

  const rerenderCanvas = (): void => {
    if (state.viewMode === '2d') {
      refs.canvas3d.hidden = true;
      refs.canvas2d.hidden = false;
      renderCanvas(refs.canvas2d, state, surfaceCb);
    } else {
      refs.canvas2d.hidden = true;
      refs.canvas3d.hidden = false;
      // 3D preview temporarily disabled — keep toggle wired but show placeholder.
      refs.canvas3d.innerHTML = '<div class="preview-3d-disabled">3D preview temporarily disabled</div>';
    }
  };

  const doRenderSwatches = (): void => {
    renderSwatches(refs.swatchesEl, state, {
      onChange: () => {
        const key = 'settings:1';
        pendingKeys.add(key);
        updateSettings(supabase, {
          palette: state.palette,
          selectedColor: state.selectedColor,
        }).catch((e: unknown) => {
          console.warn('[updateSettings palette/selectedColor]', e);
          pendingKeys.delete(key);
        });
      },
    });
  };

  const rerenderAll = (): void => {
    doRenderSwatches();
    rerenderCanvas();
    rerenderCounts();
  };

  // Realtime subscription. Echo-suppression handled inside the dispatcher
  // using `pendingKeys`; the handlers below only see non-echo events.
  const unsubscribeRealtime = subscribeAll(
    supabase,
    {
      onTile: (c) => applyTileChange(state, c),
      onSurface: (c) => applySurfaceChange(state, c, refs.canvas2d, surfaceCb, rerenderCounts),
      onPaintedCell: (c) => applyPaintedCellChange(state, c, refs.canvas2d, rerenderCounts),
      onSettings: (c) => applySettingsChange(state, c, refs, doRenderSwatches, () => rerenderCanvas()),
      onVersion: () => {
        // Phase 8 will surface the versions list. Ignore for now.
      },
      onStatus: (status, err) => {
        console.info('[realtime]', status, err ?? '');
      },
    },
    pendingKeys,
  );

  // Ceiling input: push to project_settings + update height-locked walls.
  refs.ceilInput.addEventListener('change', () => {
    const raw = parseFloat(refs.ceilInput.value);
    if (!Number.isFinite(raw) || raw <= 0) {
      refs.ceilInput.value = String(state.ceilFt);
      return;
    }
    state.ceilFt = raw;
    const settingsKey = 'settings:1';
    pendingKeys.add(settingsKey);
    updateSettings(supabase, { ceilFt: raw }).catch((e: unknown) => {
      console.warn('[updateSettings ceilFt]', e);
      pendingKeys.delete(settingsKey);
    });
    const newHeightIn = raw * 12;
    for (const s of state.surfaces) {
      if (s.heightLocked) {
        s.heightIn = newHeightIn;
        const surfKey = `surface:${s.id}`;
        pendingKeys.add(surfKey);
        updateSurfaceDims(supabase, s.id, { widthIn: s.widthIn, heightIn: s.heightIn }).catch(
          (e: unknown) => {
            console.warn('[updateSurfaceDims ceiling-locked]', e);
            pendingKeys.delete(surfKey);
          },
        );
      }
    }
    rerenderCanvas();
    rerenderCounts();
  });

  wireToolButtons(refs.toolButtons, state);

  // View toggle — UI-local pref, no server sync.
  const setViewMode = (mode: '2d' | '3d'): void => {
    state.viewMode = mode;
    refs.viewToggleButtons.forEach((b) => b.classList.toggle('active', b.dataset.view === mode));
    persistUIPrefs(state);
    rerenderCanvas();
  };
  refs.viewToggleButtons.forEach((b) => {
    b.addEventListener('click', () => {
      const m = b.dataset.view;
      if (m === '2d' || m === '3d') setViewMode(m);
    });
    b.classList.toggle('active', b.dataset.view === state.viewMode);
  });

  // Paint handlers on the canvas (idempotent — calls wire once; renderCanvas
  // rebuilds children but the listeners on the canvas root are preserved).
  wireCanvasPainting(refs.canvas2d, state, surfaceCb);

  rerenderAll();

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      unsubscribeRealtime();
    });
  }
}

// --- Realtime apply-change helpers ------------------------------------------

function applyTileChange(state: State, change: Change<TileDbRow>): void {
  // No UI panel renders tiles yet (Phase 5). Keep state in sync.
  const mapRow = (r: TileDbRow): Tile => ({
    id: r.id,
    shape: r.shape as Tile['shape'],
    sizeIn: Number(r.size_in),
    label: r.label,
  });
  if (change.kind === 'delete') {
    const id = change.row.id ?? change.oldRow?.id;
    if (!id) return;
    state.tileLibrary = state.tileLibrary.filter((t) => t.id !== id);
    return;
  }
  const incoming = mapRow(change.row);
  const idx = state.tileLibrary.findIndex((t) => t.id === incoming.id);
  if (idx === -1) state.tileLibrary.push(incoming);
  else state.tileLibrary[idx] = incoming;
}

function applySurfaceChange(
  state: State,
  change: Change<SurfaceDbRow>,
  canvas: HTMLElement,
  cb: SurfaceCallbacks,
  rerenderCounts: () => void,
): void {
  const mapRow = (r: SurfaceDbRow): Surface => ({
    id: r.id,
    group: r.group,
    name: r.name,
    widthIn: Number(r.width_in),
    heightIn: Number(r.height_in),
    note: r.note ?? undefined,
    heightLocked: !!r.height_locked,
    tileId: r.tile_id,
  });
  if (change.kind === 'delete') {
    const id = change.row.id ?? change.oldRow?.id;
    if (!id) return;
    state.surfaces = state.surfaces.filter((s) => s.id !== id);
    delete state.tiles[id];
  } else {
    const incoming = mapRow(change.row);
    const idx = state.surfaces.findIndex((s) => s.id === incoming.id);
    if (idx === -1) {
      state.surfaces.push(incoming);
      state.tiles[incoming.id] = new Map();
    } else {
      state.surfaces[idx] = incoming;
    }
  }
  // Coarse rerender: surface dim/tile changes are rare and touch the grid shape.
  renderCanvas(canvas, state, cb);
  rerenderCounts();
}

function applyPaintedCellChange(
  state: State,
  change: Change<PaintedCellDbRow>,
  canvas: HTMLElement,
  rerenderCounts: () => void,
): void {
  const row = change.row;
  const surfaceId = row.surface_id;
  const key = row.cell_key;
  if (!surfaceId || !key) return;
  const mapBySurface = state.tiles[surfaceId] ?? (state.tiles[surfaceId] = new Map());
  if (change.kind === 'delete') {
    mapBySurface.delete(key);
  } else {
    mapBySurface.set(key, row.color);
  }
  // Targeted DOM update — avoid a full canvas rerender for a single-cell change.
  const [rStr, cStr] = key.split(',');
  const el = canvas.querySelector<HTMLElement>(
    `.tile[data-surface-id="${surfaceId}"][data-r="${rStr}"][data-c="${cStr}"]`,
  );
  if (el) el.style.background = change.kind === 'delete' ? '' : row.color;
  rerenderCounts();
}

function applySettingsChange(
  state: State,
  change: { row: ProjectSettingsDbRow },
  refs: LayoutRefs,
  rerenderSwatches: () => void,
  rerenderCanvas: () => void,
): void {
  const row = change.row;
  if (row.ceil_ft !== undefined) state.ceilFt = Number(row.ceil_ft);
  if (row.palette !== undefined && row.palette !== null) state.palette = row.palette;
  if (row.selected_color !== undefined) state.selectedColor = row.selected_color;
  refs.ceilInput.value = String(state.ceilFt);
  rerenderSwatches();
  rerenderCanvas();
}

void boot();
