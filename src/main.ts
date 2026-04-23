import './styles/base.css';
import './styles/sidebar.css';
import './styles/canvas.css';
import './styles/preview3d.css';
import './styles/auth.css';

import { supabase } from './auth/client';
import { gateStateFor } from './auth/gate';
import { mountLogin } from './auth/login';
import { initialState } from './core/state';
import type { State, Surface, Version } from './core/state';
import type { Tile } from './core/tile';
import { buildSnapshot, restoreIntoState } from './core/version';
import type { Snapshot } from './core/version';
import {
  fetchAll,
  subscribeAll,
  paintCells,
  eraseCell,
  eraseSurfacePaint,
  createTile,
  deleteTile,
  setSurfaceTile,
  updateSettings,
  updateSurfaceDims,
  saveVersion,
  deleteVersion,
  restoreVersion,
} from './storage/supabase';
import type {
  Change,
  PaintedCellDbRow,
  ProjectSettingsDbRow,
  SurfaceDbRow,
  TileDbRow,
  VersionDbRow,
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
import { renderTileLibrary, renderNewTileForm } from './ui/tile-library';
import { renderVersions, renderSaveForm } from './ui/versions';
import { mountConnectionIndicator } from './ui/connection-indicator';

async function boot(): Promise<void> {
  const root = document.getElementById('app');
  if (!root) throw new Error('missing #app');

  const { data: { session } } = await supabase.auth.getSession();
  let state = gateStateFor(session);
  let userId: string | null = session?.user?.id ?? null;

  function render(): void {
    if (state === 'signed-out') {
      mountLogin(root!, { onSent: () => {} });
    } else if (state === 'not-allowed') {
      root!.innerHTML = '<div class="denied">Access denied.</div>';
    } else if (state === 'ready') {
      void mountApp(root!, userId);
    }
  }

  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
    state = gateStateFor(newSession);
    userId = newSession?.user?.id ?? null;
    render();
  });

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      subscription.unsubscribe();
    });
  }

  render();
}

async function mountApp(root: HTMLElement, currentUserId: string | null): Promise<void> {
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
  // `VersionRow` and `Version` have identical shapes; the projection is a
  // structural identity and avoids a hard layering dep from core → storage.
  state.versions = loaded.versions.map((v) => ({ ...v }));

  // UI-local prefs (view mode, orbit) stay in localStorage; the rest is server-sourced.
  const ui = loadUIPrefs();
  if (ui) applyUIPrefs(state, ui);
  refs.ceilInput.value = String(state.ceilFt);

  // Shared pending-key set for realtime echo suppression. Every mutation
  // seeds its expected key BEFORE awaiting the write; the dispatcher consumes
  // it when the echo comes back around.
  const pendingKeys = new Set<string>();

  // Closure state for Phase 5: the currently focused surface drives the
  // library's active-row highlight, and tile-assignment gates. Null means
  // "no surface has ever been interacted with this session".
  let focusedSurfaceId: string | null = null;

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
    focusedSurfaceId: null,
    onFocusSurface: (surfaceId) => focusSurface(surfaceId),
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

  // --- Tile library panel -----------------------------------------------
  // `doRenderTileLibrary` is the single entry point for refreshing the
  // panel: after mutations, after a realtime echo, or after focus changes.
  const doRenderTileLibrary = (): void => {
    const focusedSurface = focusedSurfaceId
      ? state.surfaces.find((s) => s.id === focusedSurfaceId)
      : null;
    renderTileLibrary(refs.tileLibraryEl, state.tileLibrary, {
      focusedSurfaceId,
      focusedSurfaceTileId: focusedSurface?.tileId ?? null,
      inUseCount: (tileId) => state.surfaces.filter((s) => s.tileId === tileId).length,
      onSelect: (tile) => onSelectTile(tile),
      onDelete: (tile, inUseCount) => onDeleteTile(tile, inUseCount),
      onAddRequested: () => {
        renderNewTileForm(refs.tileLibraryEl, {
          onCancel: () => doRenderTileLibrary(),
          onCreate: (draft) => {
            // Client-generated UUID so we can seed the echo-suppression key
            // BEFORE awaiting the network round-trip.
            const id = crypto.randomUUID();
            const key = `tile:${id}`;
            pendingKeys.add(key);
            // Optimistic append — the realtime echo will be suppressed, but
            // if the insert fails we roll back below.
            const optimistic = { id, shape: draft.shape, sizeIn: draft.sizeIn, label: draft.label };
            state.tileLibrary.push(optimistic);
            doRenderTileLibrary();
            createTile(supabase, {
              id,
              shape: draft.shape,
              sizeIn: draft.sizeIn,
              label: draft.label,
            }).catch((e: unknown) => {
              console.warn('[createTile]', e);
              pendingKeys.delete(key);
              state.tileLibrary = state.tileLibrary.filter((t) => t.id !== id);
              doRenderTileLibrary();
            });
          },
        });
      },
    });
  };

  // --- Versions panel ---------------------------------------------------
  // Single entry point for refreshing the panel (after hydration, after
  // mutation, after realtime echo). Ordering is already newest-first because
  // fetchAll runs `.order('created_at', { ascending: false })`.
  const doRenderVersions = (): void => {
    renderVersions(refs.versionsEl, state.versions, {
      currentUserId,
      onSaveRequested: () => {
        renderSaveForm(refs.versionsEl, {
          onCancel: () => doRenderVersions(),
          onSave: (label) => onSaveVersion(label),
        });
      },
      onLoad: (version) => onLoadVersion(version),
      onDelete: (version) => onDeleteVersion(version),
    });
  };

  /**
   * Insert a new versions row. Seeds a pending key for echo suppression BEFORE
   * awaiting the insert, and optimistically prepends the row locally so the
   * panel updates without waiting for the realtime echo. On failure, the
   * optimistic row is rolled back and the key cleared.
   */
  function onSaveVersion(label: string): void {
    const id = crypto.randomUUID();
    const key = `version:${id}`;
    pendingKeys.add(key);
    const snapshot: Snapshot = buildSnapshot(state);
    // Optimistic row — createdAt is an approximation until the DB returns the
    // real timestamp, but the echo is suppressed so this value persists.
    // Using the local ISO string keeps timeAgo() displaying "just now".
    const optimistic: Version = {
      id,
      label,
      createdAt: new Date().toISOString(),
      createdBy: currentUserId,
      schemaVersion: 1,
      surfacesSnapshot: snapshot.surfaces,
      paintedCellsSnapshot: snapshot.paintedCells,
      settingsSnapshot: snapshot.settings,
    };
    state.versions = [optimistic, ...state.versions];
    doRenderVersions();
    saveVersion(
      supabase,
      label,
      {
        surfaces: snapshot.surfaces,
        paintedCells: snapshot.paintedCells,
        settings: snapshot.settings,
      },
      id,
    ).catch((e: unknown) => {
      console.warn('[saveVersion]', e);
      pendingKeys.delete(key);
      state.versions = state.versions.filter((v) => v.id !== id);
      doRenderVersions();
    });
  }

  /**
   * Restore the selected version. Strategy:
   *   1. Dry-run `restoreIntoState` on a shallow-cloned state to validate that
   *      every snapshot surface's tileId still exists in the library. If it
   *      throws, surface the error inline on the row and bail.
   *   2. Push the snapshot into the DB via `restoreVersion` (surfaces upsert →
   *      settings upsert → painted_cells wipe → painted_cells upsert).
   *   3. Re-hydrate via `fetchAll` and blow away local state in one shot, then
   *      full re-render. Rather than seed N echo-suppression keys for every
   *      painted cell (idempotent anyway — applyPaintedCellChange sets the
   *      same value), we rely on the realtime dedupe: when echoes arrive,
   *      handlers update state idempotently and the DOM just stays put.
   */
  function onLoadVersion(version: Version): void {
    const snapshot = snapshotFromVersion(version);
    if (!snapshot) {
      showVersionError(version.id, 'Version snapshot is malformed.');
      return;
    }
    // Dry-run validation against the live tile library.
    try {
      const probe = cloneStateForProbe(state);
      restoreIntoState(probe, snapshot);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      showVersionError(version.id, msg);
      return;
    }
    // Apply: push the snapshot to Supabase, then re-fetch and render.
    restoreVersion(supabase, {
      surfaces: snapshot.surfaces.map((s) => ({
        id: s.id,
        group: s.group,
        name: s.name,
        width_in: s.widthIn,
        height_in: s.heightIn,
        note: s.note ?? null,
        height_locked: !!s.heightLocked,
        tile_id: s.tileId,
      })),
      paintedCells: Object.entries(snapshot.paintedCells).flatMap(
        ([surfaceId, cells]) =>
          Object.entries(cells).map(([cellKey, color]) => ({
            surface_id: surfaceId,
            cell_key: cellKey,
            color,
          })),
      ),
      settings: {
        id: 1,
        ceil_ft: snapshot.settings.ceilFt,
        palette: snapshot.settings.palette,
        selected_color: snapshot.settings.selectedColor,
      },
    })
      .then(() => fetchAll(supabase))
      .then((reloaded) => {
        state.tileLibrary = reloaded.tileLibrary;
        state.surfaces = reloaded.surfaces;
        state.tiles = reloaded.paintedCells;
        state.ceilFt = reloaded.settings.ceilFt;
        state.palette = reloaded.settings.palette;
        state.selectedColor = reloaded.settings.selectedColor;
        state.versions = reloaded.versions.map((v) => ({ ...v }));
        refs.ceilInput.value = String(state.ceilFt);
        // focusedSurfaceId may now point at a deleted surface — clear it.
        focusedSurfaceId = null;
        surfaceCb.focusedSurfaceId = null;
        rerenderAll();
      })
      .catch((e: unknown) => {
        console.warn('[restoreVersion]', e);
        const msg = e instanceof Error ? e.message : String(e);
        showVersionError(version.id, msg);
      });
  }

  /** Delete a version row (optimistic local remove with rollback on failure). */
  function onDeleteVersion(version: Version): void {
    const key = `version:${version.id}`;
    pendingKeys.add(key);
    const prev = state.versions;
    state.versions = state.versions.filter((v) => v.id !== version.id);
    doRenderVersions();
    deleteVersion(supabase, version.id).catch((e: unknown) => {
      console.warn('[deleteVersion]', e);
      pendingKeys.delete(key);
      state.versions = prev;
      doRenderVersions();
    });
  }

  /**
   * Narrow the raw JSONB snapshot blobs back into a `Snapshot`. We trust
   * schema_version=1 rows and validate only the structural presence of the
   * three expected fields. Returns null if something looks off.
   */
  function snapshotFromVersion(v: Version): Snapshot | null {
    const surfaces = v.surfacesSnapshot;
    const cells = v.paintedCellsSnapshot;
    const settings = v.settingsSnapshot;
    if (!Array.isArray(surfaces)) return null;
    if (typeof cells !== 'object' || cells === null) return null;
    if (typeof settings !== 'object' || settings === null) return null;
    return {
      surfaces: surfaces as Snapshot['surfaces'],
      paintedCells: cells as Snapshot['paintedCells'],
      settings: settings as Snapshot['settings'],
    };
  }

  /** Shallow clone sufficient for a `restoreIntoState` dry-run. */
  function cloneStateForProbe(src: State): State {
    return {
      ...src,
      surfaces: [...src.surfaces],
      tiles: { ...src.tiles },
      palette: [...src.palette],
      tileLibrary: [...src.tileLibrary],
      versions: [...src.versions],
    };
  }

  /** Surface a short inline error under a version row (replaces any prior). */
  function showVersionError(versionId: string, message: string): void {
    const row = refs.versionsEl.querySelector<HTMLElement>(
      `.version-row[data-version-id="${versionId}"]`,
    );
    if (!row) return;
    row.querySelector('.version-error')?.remove();
    const err = document.createElement('div');
    err.className = 'version-error';
    err.textContent = message.startsWith('Version references missing tile')
      ? 'Version references a deleted tile — cannot load.'
      : message;
    row.appendChild(err);
  }

  /** Update the focused surface, rerender the library, and toggle `.focused`. */
  function focusSurface(surfaceId: string): void {
    if (focusedSurfaceId === surfaceId) return;
    focusedSurfaceId = surfaceId;
    surfaceCb.focusedSurfaceId = surfaceId;
    // Targeted DOM toggle — no need to rebuild the whole canvas for a class.
    refs.canvas2d.querySelectorAll<HTMLElement>('.surface.focused').forEach((el) => {
      el.classList.remove('focused');
    });
    const el = refs.canvas2d.querySelector<HTMLElement>(
      `.surface[data-surface-id="${surfaceId}"]`,
    );
    el?.classList.add('focused');
    doRenderTileLibrary();
  }

  /**
   * Library row click → assign tile to focused surface. If the shape changes
   * AND cells are painted, show an inline confirm above the focused surface.
   */
  function onSelectTile(tile: Tile): void {
    if (!focusedSurfaceId) {
      console.info('[tile-library] no focused surface; ignoring select');
      return;
    }
    const surface = state.surfaces.find((s) => s.id === focusedSurfaceId);
    if (!surface) return;
    if (surface.tileId === tile.id) return;
    const currentTile = state.tileLibrary.find((t) => t.id === surface.tileId);
    const paintedCount = state.tiles[surface.id]?.size ?? 0;
    const shapeDiffers = !currentTile || currentTile.shape !== tile.shape;
    if (!shapeDiffers || paintedCount === 0) {
      applyTileAssignment(surface.id, tile.id, false);
      return;
    }
    showSwitchConfirm(surface.id, tile, paintedCount);
  }

  function applyTileAssignment(surfaceId: string, tileId: string, clearPaint: boolean): void {
    const surface = state.surfaces.find((s) => s.id === surfaceId);
    if (!surface) return;
    const surfKey = `surface:${surfaceId}`;
    pendingKeys.add(surfKey);
    // Optimistic local mutation — the realtime echo will be suppressed by
    // the pending key, so without this the tile chip and library active-row
    // wouldn't update until another browser mutated the same surface.
    surface.tileId = tileId;
    const doSet = (): Promise<void> =>
      setSurfaceTile(supabase, surfaceId, tileId).catch((e: unknown) => {
        console.warn('[setSurfaceTile]', e);
        pendingKeys.delete(surfKey);
      });
    if (!clearPaint) {
      renderCanvas(refs.canvas2d, state, surfaceCb);
      doRenderTileLibrary();
      rerenderCounts();
      void doSet();
      // renderCanvas rebuilds .surface elements; surfaceCb.focusedSurfaceId
      // is baked into renderSurface so the .focused class is reapplied
      // automatically — no further work needed.
      return;
    }
    // Seed per-cell delete keys so the realtime echoes are suppressed, then
    // wipe painted_cells, then assign the new tile. Also clear the local
    // paint map so counts + grid clear immediately.
    const cells = state.tiles[surfaceId];
    const cellKeysSnapshot = cells ? Array.from(cells.keys()) : [];
    for (const key of cellKeysSnapshot) {
      pendingKeys.add(`painted_cell:${surfaceId}:${key}`);
    }
    state.tiles[surfaceId] = new Map();
    renderCanvas(refs.canvas2d, state, surfaceCb);
    doRenderTileLibrary();
    rerenderCounts();
    eraseSurfacePaint(supabase, surfaceId)
      .catch((e: unknown) => {
        console.warn('[eraseSurfacePaint]', e);
        for (const key of cellKeysSnapshot) {
          pendingKeys.delete(`painted_cell:${surfaceId}:${key}`);
        }
      })
      .then(() => doSet());
  }

  /** Render an inline confirm bar inside the focused surface's head. */
  function showSwitchConfirm(surfaceId: string, tile: Tile, paintedCount: number): void {
    const surfEl = refs.canvas2d.querySelector<HTMLElement>(
      `.surface[data-surface-id="${surfaceId}"]`,
    );
    if (!surfEl) return;
    // Dismiss any prior bar for this surface.
    surfEl.querySelector('.switch-confirm')?.remove();
    const bar = document.createElement('div');
    bar.className = 'switch-confirm';
    const msg = document.createElement('span');
    const cellsWord = paintedCount === 1 ? 'painted cell' : 'painted cells';
    msg.textContent = `Switching tiles clears ${paintedCount} ${cellsWord}.`;
    const actions = document.createElement('div');
    actions.className = 'switch-confirm-actions';
    const switchBtn = document.createElement('button');
    switchBtn.type = 'button';
    switchBtn.className = 'switch-btn';
    switchBtn.textContent = 'Switch';
    switchBtn.addEventListener('click', () => {
      bar.remove();
      applyTileAssignment(surfaceId, tile.id, true);
    });
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'switch-cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => bar.remove());
    actions.append(switchBtn, cancelBtn);
    bar.append(msg, actions);
    surfEl.insertBefore(bar, surfEl.firstChild);
  }

  /**
   * Delete handler for library rows. The UI only surfaces the × when
   * `inUseCount === 0`, so reaching this with a non-zero count means a race
   * between hover and click — we still belt-and-suspenders guard here.
   */
  function onDeleteTile(tile: Tile, inUseCount: number): void {
    if (inUseCount > 0) return;
    // eslint-disable-next-line no-alert
    const ok = window.confirm(`Delete tile "${tile.label}"?`);
    if (!ok) return;
    const key = `tile:${tile.id}`;
    pendingKeys.add(key);
    // Optimistic remove; roll back if the DB rejects (e.g., stale FK).
    const prev = state.tileLibrary;
    state.tileLibrary = state.tileLibrary.filter((t) => t.id !== tile.id);
    doRenderTileLibrary();
    deleteTile(supabase, tile.id).catch((e: unknown) => {
      console.warn('[deleteTile]', e);
      pendingKeys.delete(key);
      state.tileLibrary = prev;
      doRenderTileLibrary();
    });
  }

  const rerenderAll = (): void => {
    doRenderSwatches();
    doRenderTileLibrary();
    doRenderVersions();
    rerenderCanvas();
    rerenderCounts();
  };

  // Connection indicator (fixed-position pill) — mounted on document.body so
  // it survives auth rerenders. Seeded with the current online state before
  // realtime subscribes so initial offline is reflected immediately.
  const indicator = mountConnectionIndicator(document.body);
  indicator.setOnline(navigator.onLine);
  const onOnline = (): void => indicator.setOnline(true);
  const onOffline = (): void => indicator.setOnline(false);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  // Realtime subscription. Echo-suppression handled inside the dispatcher
  // using `pendingKeys`; the handlers below only see non-echo events.
  const unsubscribeRealtime = subscribeAll(
    supabase,
    {
      onTile: (c) => {
        applyTileChange(state, c);
        doRenderTileLibrary();
        // A tile rename/shape change is reflected on each surface-head chip,
        // so nudge the canvas too — cheap for a library-scale rename.
        rerenderCanvas();
      },
      onSurface: (c) => {
        applySurfaceChange(state, c, refs.canvas2d, surfaceCb, rerenderCounts);
        // Surface row changes can shift the focused tileId → library active row.
        doRenderTileLibrary();
      },
      onPaintedCell: (c) => applyPaintedCellChange(state, c, refs.canvas2d, rerenderCounts),
      onSettings: (c) => applySettingsChange(state, c, refs, doRenderSwatches, () => rerenderCanvas()),
      onVersion: (c) => {
        applyVersionChange(state, c);
        doRenderVersions();
      },
      onStatus: (status, err) => {
        console.info('[realtime]', status, err ?? '');
        indicator.setRealtimeStatus(status);
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

  // Sign-out — `onAuthStateChange` (set up in boot) handles the rerender, so
  // we only need to kick off the API call. Error path: log and keep the app
  // mounted so the user can retry.
  refs.signOutBtn.addEventListener('click', () => {
    void supabase.auth.signOut().then(({ error }) => {
      if (error) console.warn('[signOut]', error);
    });
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
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      indicator.destroy();
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
  // Matches both square `.tile` divs and hex <polygon> elements, which both
  // carry `data-surface-id` + `data-cell-key`.
  const esc = (s: string): string =>
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(s) : s;
  const el = canvas.querySelector<HTMLElement | SVGElement>(
    `[data-surface-id="${esc(surfaceId)}"][data-cell-key="${esc(key)}"]`,
  );
  if (el) {
    if (el instanceof SVGElement) {
      el.setAttribute('fill', change.kind === 'delete' ? 'white' : row.color);
    } else {
      el.style.background = change.kind === 'delete' ? '' : row.color;
    }
  }
  rerenderCounts();
}

function applyVersionChange(state: State, change: Change<VersionDbRow>): void {
  const mapRow = (r: VersionDbRow): Version => ({
    id: r.id,
    label: r.label,
    createdAt: r.created_at,
    createdBy: r.created_by ?? null,
    schemaVersion: r.schema_version,
    surfacesSnapshot: r.surfaces_snapshot,
    paintedCellsSnapshot: r.painted_cells_snapshot,
    settingsSnapshot: r.settings_snapshot,
  });
  if (change.kind === 'delete') {
    const id = change.row.id ?? change.oldRow?.id;
    if (!id) return;
    state.versions = state.versions.filter((v) => v.id !== id);
    return;
  }
  const incoming = mapRow(change.row);
  const idx = state.versions.findIndex((v) => v.id === incoming.id);
  if (idx === -1) {
    // Newest-first ordering matches fetchAll's .order('created_at', desc).
    state.versions = [incoming, ...state.versions];
  } else {
    const copy = [...state.versions];
    copy[idx] = incoming;
    state.versions = copy;
  }
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
