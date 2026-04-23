import { getGrid, isCutCell, cellKey, TILE_PX } from '@/core/grid';
import { computeSurfaceStats } from '@/core/stats';
import { parseDim, formatDim } from '@/core/dimensions';
import type { State, Surface } from '@/core/state';
import { effectiveTool } from './tools';

export interface SurfaceCallbacks {
  onRerenderCounts: () => void;
  onRenderSwatches: () => void;
  persist: () => void;
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
  const stats = computeSurfaceStats(s);
  const { grid } = stats;

  const surf = document.createElement('div');
  surf.className = 'surface';
  surf.dataset.surfaceId = s.id;

  const head = document.createElement('div');
  head.className = 'surface-head';

  const nameLine = document.createElement('div');
  nameLine.className = 'surface-name';
  nameLine.textContent = s.name;
  head.appendChild(nameLine);

  const meta = document.createElement('div');
  meta.className = 'surface-meta';
  const countStr = stats.cut
    ? `${stats.full} full + ${stats.cut} cut = ${stats.total}`
    : `${stats.full} tiles`;
  meta.textContent = `${countStr} \u00b7 ${stats.areaFt2.toFixed(1)} ft\u00b2 \u00b7 ${s.note ?? ''}`;
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
  surf.appendChild(buildGridElement(s, grid, state));
  return surf;
}

function buildGridElement(s: Surface, grid: ReturnType<typeof getGrid>, state: State): HTMLElement {
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
  cb.persist();
}

interface TileTarget { surfaceId: string; r: number; c: number; }

function tileFromEvent(e: Event): TileTarget | null {
  const target = e.target as HTMLElement | null;
  const el = target?.closest<HTMLElement>('.tile');
  if (!el) return null;
  const surfaceId = el.dataset.surfaceId;
  const rStr = el.dataset.r;
  const cStr = el.dataset.c;
  if (!surfaceId || !rStr || !cStr) return null;
  const r = Number(rStr);
  const c = Number(cStr);
  if (!Number.isFinite(r) || !Number.isFinite(c)) return null;
  return { surfaceId, r, c };
}

function setTile(state: State, canvas: HTMLElement, surfaceId: string, r: number, c: number, color: string | null): void {
  const map = state.tiles[surfaceId] ?? (state.tiles[surfaceId] = new Map());
  if (color == null) map.delete(cellKey(r, c));
  else map.set(cellKey(r, c), color);
  const el = canvas.querySelector<HTMLElement>(
    `.tile[data-surface-id="${surfaceId}"][data-r="${r}"][data-c="${c}"]`,
  );
  if (el) el.style.background = color ?? '';
}

function apply(state: State, canvas: HTMLElement, target: TileTarget | null, e: MouseEvent, cb: SurfaceCallbacks): void {
  if (!target) return;
  const tool = effectiveTool(state, e);
  if (tool === 'paint') setTile(state, canvas, target.surfaceId, target.r, target.c, state.selectedColor);
  else if (tool === 'erase') setTile(state, canvas, target.surfaceId, target.r, target.c, null);
  else {
    const map = state.tiles[target.surfaceId];
    const c = map?.get(cellKey(target.r, target.c));
    if (c) {
      state.selectedColor = c;
      if (!state.palette.includes(c)) state.palette.push(c);
      cb.onRenderSwatches();
    }
  }
}

export function wireCanvasPainting(canvas: HTMLElement, state: State, cb: SurfaceCallbacks): void {
  let painting = false;
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input')) return;
    e.preventDefault();
    const t = tileFromEvent(e);
    if (!t) return;
    painting = true;
    apply(state, canvas, t, e, cb);
    cb.onRerenderCounts();
  });
  canvas.addEventListener('mouseover', (e) => {
    if (!painting) return;
    const t = tileFromEvent(e);
    if (!t) return;
    apply(state, canvas, t, e, cb);
  });
  window.addEventListener('mouseup', () => {
    if (painting) {
      painting = false;
      cb.onRerenderCounts();
      cb.persist();
    }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}
