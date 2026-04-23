import './styles/base.css';
import './styles/sidebar.css';
import './styles/canvas.css';
import './styles/preview3d.css';

import { mountLayout } from './ui/layout';
import { initialState, initTiles, type ViewMode } from './core/state';
import { loadSaved, persist, applySaved, type SavedShape } from './storage/local';
import { renderSwatches } from './ui/swatches';
import { wireToolButtons } from './ui/tools';
import { renderCanvas, wireCanvasPainting } from './ui/surface';
import { renderCounts } from './ui/counts';
import { render3D } from './preview3d/preview';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app');
const refs = mountLayout(root);

const state = initialState();
const saved = loadSaved();
if (saved) applySaved(state, saved);
refs.ceilInput.value = String(state.ceilFt);

const countsRefs = {
  countsEl: refs.countsEl,
  totalEl: refs.totalEl,
  fullCutTotalEl: refs.fullCutTotalEl,
  orderTotalEl: refs.orderTotalEl,
};

const doRenderSwatches = () => renderSwatches(refs.swatchesEl, state, { onChange: () => persist(state) });
const doRenderCounts = () => renderCounts(countsRefs, state);
const doPersist = () => persist(state);

const surfaceCb = {
  onRerenderCounts: doRenderCounts,
  onRenderSwatches: doRenderSwatches,
  persist: doPersist,
};

doRenderSwatches();
wireToolButtons(refs.toolButtons, state);
renderCanvas(refs.canvas2d, state, surfaceCb);
wireCanvasPainting(refs.canvas2d, state, surfaceCb);
doRenderCounts();

refs.ceilInput.addEventListener('change', () => {
  const v = parseFloat(refs.ceilInput.value);
  if (!Number.isFinite(v) || v < 4 || v > 20) { refs.ceilInput.value = String(state.ceilFt); return; }
  state.ceilFt = v;
  const ceilIn = v * 12;
  for (const s of state.surfaces) if (s.heightLocked) s.heightIn = ceilIn;
  renderCanvas(refs.canvas2d, state, surfaceCb);
  doRenderCounts();
  if (state.viewMode === '3d') render3D(refs.canvas3d, state, () => persist(state));
  persist(state);
});

refs.saveBtn.addEventListener('click', () => {
  const tilesOut: Record<string, Record<string, string>> = {};
  for (const [k, m] of Object.entries(state.tiles)) tilesOut[k] = Object.fromEntries(m);
  const data = {
    version: 2,
    ceilFt: state.ceilFt,
    palette: state.palette,
    selectedColor: state.selectedColor,
    surfaces: state.surfaces.map(s => ({ id: s.id, widthIn: s.widthIn, heightIn: s.heightIn })),
    tiles: tilesOut,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bathroom-tiles.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

refs.loadBtn.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(r.result));
        if (!parsed || typeof parsed !== 'object') {
          throw new Error('file is not a JSON object');
        }
        applySaved(state, parsed as SavedShape);
        refs.ceilInput.value = String(state.ceilFt);
        doRenderSwatches();
        renderCanvas(refs.canvas2d, state, surfaceCb);
        doRenderCounts();
        persist(state);
      } catch (err) {
        console.error('[tile-planner] load failed', err);
        alert('Could not load: ' + (err as Error).message);
      }
    };
    r.readAsText(f);
  });
  input.click();
});

refs.resetBtn.addEventListener('click', () => {
  if (!confirm('Clear every painted tile?')) return;
  state.tiles = initTiles(state.surfaces);
  renderCanvas(refs.canvas2d, state, surfaceCb);
  doRenderCounts();
  persist(state);
});

function setViewMode(mode: ViewMode): void {
  state.viewMode = mode;
  refs.viewToggleButtons.forEach(b => b.classList.toggle('active', b.dataset.view === mode));
  if (mode === '3d') {
    refs.canvas2d.hidden = true;
    refs.canvas3d.hidden = false;
    render3D(refs.canvas3d, state, () => persist(state));
  } else {
    refs.canvas3d.hidden = true;
    refs.canvas2d.hidden = false;
  }
  persist(state);
}

const VALID_VIEW_MODES: readonly ViewMode[] = ['2d', '3d'];
function isViewMode(v: string | undefined): v is ViewMode {
  return v !== undefined && (VALID_VIEW_MODES as readonly string[]).includes(v);
}

refs.viewToggleButtons.forEach((b) => {
  b.addEventListener('click', () => {
    const v = b.dataset.view;
    if (isViewMode(v)) setViewMode(v);
  });
});

setViewMode(state.viewMode);
