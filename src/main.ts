import './styles/base.css';
import './styles/sidebar.css';
import './styles/canvas.css';
import './styles/preview3d.css';

import { mountLayout } from './ui/layout';
import { initialState } from './core/state';
import { loadSaved, applySaved, persist } from './storage/local';
import { renderSwatches } from './ui/swatches';
import { wireToolButtons } from './ui/tools';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app');
const refs = mountLayout(root);

const state = initialState();
const saved = loadSaved();
if (saved) applySaved(state, saved);
refs.ceilInput.value = String(state.ceilFt);

renderSwatches(refs.swatchesEl, state, { onChange: () => persist(state) });
wireToolButtons(refs.toolButtons, state);
