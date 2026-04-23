import { getGrid, isCutCell, cellKey } from '@/core/grid';
import { computeSurfaceStats } from '@/core/stats';
import { parseDim, formatDim } from '@/core/dimensions';
import type { State, Surface } from '@/core/state';
import { effectiveTool } from './tools';
import { SHAPE_GLYPHS } from './tile-library';
import { renderHexSurface } from './hex-surface';

export interface SurfaceCallbacks {
  onRerenderCounts: () => void;
  onRenderSwatches: () => void;
  /**
   * Fallback "something changed, save it" hook. Called from dim-input /
   * stroke-end code paths when the newer per-action commit hooks below are
   * NOT supplied. The Supabase-wired app in main.ts passes the newer hooks
   * and leaves persist as a no-op; older/tests may still use it.
   */
  persist: () => void;
  /**
   * Commit the net result of a drag-paint stroke as a single batch per
   * surface. Called on mouseup. `paints` maps surfaceId → (cellKey → color);
   * `erases` maps surfaceId → Set<cellKey>. Wiring this lets the caller push
   * one round-trip per stroke rather than one per cell. When omitted,
   * `persist()` is invoked instead.
   */
  onStrokeCommit?: (
    paints: Map<string, Map<string, string>>,
    erases: Map<string, Set<string>>,
  ) => void;
  /**
   * Fired once per surface whose widthIn/heightIn just changed via the dim
   * inputs. The Surface object is already mutated in place; the callback
   * should push the new dims to persistence (and seed any echo key). When
   * omitted, `persist()` is invoked instead.
   */
  onSurfaceDimsCommit?: (surfaceId: string) => void;
  /**
   * Fired when a user interacts with a surface — either by clicking its head
   * or by pressing in its grid. The controller uses this to drive the library
   * highlight and to scope tile-assignment actions.
   */
  onFocusSurface?: (surfaceId: string) => void;
  /** The currently focused surface id (if any) — used to apply `.focused`. */
  focusedSurfaceId?: string | null;
}

export function renderCanvas(canvas: HTMLElement, state: State, cb: SurfaceCallbacks): void {
  canvas.innerHTML = '';
  const groupOrder = ['Floors', 'Ceiling', 'Walls'] as const;
  const groups = new Map<string, Surface[]>();
  for (const g of groupOrder) groups.set(g, []);
  for (const s of state.surfaces) {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group)!.push(s);
  }
  for (const [gname, gsurf] of groups) {
    if (!gsurf.length) continue;
    const gEl = document.createElement('div');
    gEl.className = 'group';
    const head = document.createElement('div');
    head.className = 'group-head';
    const suffix = gname === 'Walls' ? ` \u00b7 ${state.ceilFt}' ceiling` : '';
    head.innerHTML = `<span class="group-title">${gname}${suffix}</span><span class="group-rule"></span>`;
    gEl.appendChild(head);
    const surfs = document.createElement('div');
    surfs.className = 'surfaces';
    for (const s of gsurf) surfs.appendChild(renderSurface(s, state, canvas, cb));
    gEl.appendChild(surfs);
    canvas.appendChild(gEl);
  }
}

function renderSurface(s: Surface, state: State, canvas: HTMLElement, cb: SurfaceCallbacks): HTMLElement {
  const tile = state.tileLibrary.find((t) => t.id === s.tileId);

  const surf = document.createElement('div');
  surf.className = 'surface';
  if (cb.focusedSurfaceId === s.id) surf.classList.add('focused');
  surf.dataset.surfaceId = s.id;

  const head = document.createElement('div');
  head.className = 'surface-head';
  if (cb.onFocusSurface) {
    head.addEventListener('click', (e) => {
      // Let inputs receive their own events without stealing focus.
      if ((e.target as HTMLElement | null)?.closest('input,button')) return;
      cb.onFocusSurface?.(s.id);
    });
  }

  const nameLine = document.createElement('div');
  nameLine.className = 'surface-name';
  nameLine.textContent = s.name;
  head.appendChild(nameLine);

  // Tile chip: text-only "Tile: <glyph> <label>". Looks up from state.tileLibrary
  // so that a tile rename or swap is reflected here on next rerender.
  const chip = document.createElement('div');
  chip.className = 'tile-chip';
  if (tile) {
    chip.textContent = `Tile: ${SHAPE_GLYPHS[tile.shape]} ${tile.label}`;
  } else {
    chip.textContent = 'Tile: \u2014';
  }
  head.appendChild(chip);

  const meta = document.createElement('div');
  meta.className = 'surface-meta';
  // Meta defaults to the bare area if no tile is assigned.
  if (tile) {
    const stats = computeSurfaceStats(s, tile);
    const countStr = stats.cut
      ? `${stats.full} full + ${stats.cut} cut = ${stats.total}`
      : `${stats.full} tiles`;
    meta.textContent = `${countStr} \u00b7 ${stats.areaFt2.toFixed(1)} ft\u00b2 \u00b7 ${s.note ?? ''}`;
  } else {
    const areaFt2 = (s.widthIn * s.heightIn) / 144;
    meta.textContent = `\u2014 \u00b7 ${areaFt2.toFixed(1)} ft\u00b2 \u00b7 ${s.note ?? ''}`;
  }
  head.appendChild(meta);

  const dimRow = document.createElement('div');
  dimRow.className = 'dim-row';
  const wLbl = document.createElement('span'); wLbl.textContent = 'W';
  const wIn = document.createElement('input');
  wIn.type = 'text';
  wIn.className = 'dim-input';
  wIn.value = formatDim(s.widthIn);
  wIn.addEventListener('change', () => {
    const v = parseDim(wIn.value);
    if (!Number.isFinite(v) || v <= 0) { wIn.value = formatDim(s.widthIn); return; }
    s.widthIn = v;
    rerenderSurface(s.id, state, canvas, cb);
  });
  const sep = document.createElement('span'); sep.className = 'dim-sep'; sep.textContent = '\u00d7';
  const hLbl = document.createElement('span'); hLbl.textContent = 'H';
  const hIn = document.createElement('input');
  hIn.type = 'text';
  hIn.className = 'dim-input';
  hIn.value = formatDim(s.heightIn);
  if (s.heightLocked) { hIn.disabled = true; hIn.title = 'Linked to ceiling height'; }
  hIn.addEventListener('change', () => {
    const v = parseDim(hIn.value);
    if (!Number.isFinite(v) || v <= 0) { hIn.value = formatDim(s.heightIn); return; }
    s.heightIn = v;
    rerenderSurface(s.id, state, canvas, cb);
  });
  dimRow.append(wLbl, wIn, sep, hLbl, hIn);
  head.appendChild(dimRow);

  surf.appendChild(head);
  if (!tile || tile.shape === 'square') {
    // Square path (or surface with no tile assigned → render a default 7.87"
    // grid so the surface is still visible).
    const sizeIn = tile?.sizeIn ?? 7.87;
    surf.appendChild(buildSquareGridElement(s, state, sizeIn));
  } else {
    // Narrowed to hex-pointy | hex-flat by the branch above; passed through
    // the HexTile alias declared in hex-surface.ts.
    surf.appendChild(renderHexSurface(s, { ...tile, shape: tile.shape }, state));
  }
  return surf;
}

function buildSquareGridElement(s: Surface, state: State, tileSizeIn: number): HTMLElement {
  const grid = getGrid(s, tileSizeIn);
  const gridEl = document.createElement('div');
  gridEl.className = 'grid';
  gridEl.dataset.surfaceId = s.id;
  gridEl.style.gridTemplateColumns = grid.colSizes.map(v => v + 'px').join(' ');
  gridEl.style.gridTemplateRows = grid.rowSizes.map(v => v + 'px').join(' ');
  const tilesMap = state.tiles[s.id] ?? new Map<string, string>();
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const t = document.createElement('div');
      t.className = 'tile';
      if (isCutCell(grid, r, c)) t.classList.add('cut');
      t.dataset.surfaceId = s.id;
      t.dataset.cellKey = cellKey(r, c);
      t.dataset.r = String(r);
      t.dataset.c = String(c);
      const color = tilesMap.get(cellKey(r, c));
      if (color) t.style.background = color;
      gridEl.appendChild(t);
    }
  }
  return gridEl;
}

function rerenderSurface(surfaceId: string, state: State, canvas: HTMLElement, cb: SurfaceCallbacks): void {
  const s = state.surfaces.find(x => x.id === surfaceId);
  if (!s) return;
  const existing = canvas.querySelector<HTMLElement>(`.surface[data-surface-id="${surfaceId}"]`);
  const replacement = renderSurface(s, state, canvas, cb);
  if (existing?.parentNode) existing.parentNode.replaceChild(replacement, existing);
  cb.onRerenderCounts();
  if (cb.onSurfaceDimsCommit) cb.onSurfaceDimsCommit(surfaceId);
  else cb.persist();
}

// --- Painting -----------------------------------------------------------------

interface PaintTarget { surfaceId: string; key: string; }

/**
 * Resolve a mouse event to a paint target. Square tiles carry
 * `data-cell-key="r,c"`; hex polygons carry `data-cell-key="q,r"`. The
 * downstream apply() treats the key as opaque so both shapes share the code
 * path.
 */
function targetFromEvent(e: Event): PaintTarget | null {
  const target = e.target as HTMLElement | null;
  if (!target) return null;
  const el = target.closest<Element>('[data-surface-id][data-cell-key]');
  if (!el) return null;
  const surfaceId = (el as HTMLElement | SVGElement).dataset?.surfaceId
    ?? el.getAttribute('data-surface-id');
  const key = (el as HTMLElement | SVGElement).dataset?.cellKey
    ?? el.getAttribute('data-cell-key');
  if (!surfaceId || !key) return null;
  return { surfaceId, key };
}

function paintCellInDOM(
  canvas: HTMLElement,
  surfaceId: string,
  key: string,
  color: string | null,
): void {
  // Matches the .tile div (square) or the <polygon> (hex). Both carry
  // data-surface-id + data-cell-key.
  const esc = (s: string): string =>
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(s) : s;
  const el = canvas.querySelector<HTMLElement | SVGElement>(
    `[data-surface-id="${esc(surfaceId)}"][data-cell-key="${esc(key)}"]`,
  );
  if (!el) return;
  if (el instanceof SVGElement) {
    // Hex polygons: toggle the fill attribute.
    el.setAttribute('fill', color ?? 'white');
  } else {
    el.style.background = color ?? '';
  }
}

function setCell(
  state: State,
  canvas: HTMLElement,
  surfaceId: string,
  key: string,
  color: string | null,
): void {
  const map = state.tiles[surfaceId] ?? (state.tiles[surfaceId] = new Map());
  if (color == null) map.delete(key);
  else map.set(key, color);
  paintCellInDOM(canvas, surfaceId, key, color);
}

interface Stroke {
  paints: Map<string, Map<string, string>>; // surfaceId -> cellKey -> color
  erases: Map<string, Set<string>>;         // surfaceId -> Set<cellKey>
}

function emptyStroke(): Stroke {
  return { paints: new Map(), erases: new Map() };
}

/**
 * Record a net cell change from the active stroke. Later writes within the
 * same stroke overwrite earlier ones for the same (surface, cell), so the
 * map reflects the final intent on mouseup.
 */
function recordStroke(stroke: Stroke, surfaceId: string, key: string, color: string | null): void {
  if (color == null) {
    stroke.paints.get(surfaceId)?.delete(key);
    let set = stroke.erases.get(surfaceId);
    if (!set) { set = new Set(); stroke.erases.set(surfaceId, set); }
    set.add(key);
  } else {
    stroke.erases.get(surfaceId)?.delete(key);
    let m = stroke.paints.get(surfaceId);
    if (!m) { m = new Map(); stroke.paints.set(surfaceId, m); }
    m.set(key, color);
  }
}

function apply(
  state: State,
  canvas: HTMLElement,
  target: PaintTarget | null,
  e: MouseEvent,
  cb: SurfaceCallbacks,
  stroke: Stroke,
): void {
  if (!target) return;
  const tool = effectiveTool(state, e);
  if (tool === 'paint') {
    setCell(state, canvas, target.surfaceId, target.key, state.selectedColor);
    recordStroke(stroke, target.surfaceId, target.key, state.selectedColor);
  } else if (tool === 'erase') {
    setCell(state, canvas, target.surfaceId, target.key, null);
    recordStroke(stroke, target.surfaceId, target.key, null);
  } else {
    const map = state.tiles[target.surfaceId];
    const c = map?.get(target.key);
    if (c) {
      state.selectedColor = c;
      if (!state.palette.includes(c)) state.palette.push(c);
      cb.onRenderSwatches();
    }
  }
}

export function wireCanvasPainting(canvas: HTMLElement, state: State, cb: SurfaceCallbacks): void {
  let painting = false;
  let stroke: Stroke = emptyStroke();
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input')) return;
    e.preventDefault();
    const t = targetFromEvent(e);
    if (!t) return;
    if (cb.onFocusSurface) cb.onFocusSurface(t.surfaceId);
    painting = true;
    stroke = emptyStroke();
    apply(state, canvas, t, e, cb, stroke);
    cb.onRerenderCounts();
  });
  canvas.addEventListener('mouseover', (e) => {
    if (!painting) return;
    const t = targetFromEvent(e);
    if (!t) return;
    apply(state, canvas, t, e, cb, stroke);
  });
  window.addEventListener('mouseup', () => {
    if (!painting) return;
    painting = false;
    cb.onRerenderCounts();
    if (cb.onStrokeCommit) {
      if (stroke.paints.size > 0 || stroke.erases.size > 0) {
        cb.onStrokeCommit(stroke.paints, stroke.erases);
      }
    } else {
      cb.persist();
    }
    stroke = emptyStroke();
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

