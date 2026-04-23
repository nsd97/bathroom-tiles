import type { State } from '@/core/state';

export interface SwatchHandlers {
  onChange: () => void;
}

export function renderSwatches(root: HTMLElement, state: State, handlers: SwatchHandlers): void {
  root.innerHTML = '';
  for (const color of state.palette) {
    const sw = document.createElement('button');
    sw.className = 'swatch' + (color === state.selectedColor ? ' active' : '');
    sw.style.background = color;
    sw.title = color;
    sw.addEventListener('click', () => {
      state.selectedColor = color;
      renderSwatches(root, state, handlers);
      handlers.onChange();
    });
    const rm = document.createElement('span');
    rm.className = 'remove';
    rm.textContent = '\u00d7';
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.palette.length <= 1) return;
      const next = state.palette.filter(c => c !== color);
      state.palette = next;
      if (state.selectedColor === color) state.selectedColor = next[0] ?? color;
      renderSwatches(root, state, handlers);
      handlers.onChange();
    });
    sw.appendChild(rm);
    root.appendChild(sw);
  }
  const add = document.createElement('button');
  add.className = 'add-color';
  add.textContent = '+';
  add.title = 'Add color';
  add.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = '#888888';
    input.addEventListener('change', () => {
      if (!state.palette.includes(input.value)) state.palette.push(input.value);
      state.selectedColor = input.value;
      renderSwatches(root, state, handlers);
      handlers.onChange();
    });
    input.click();
  });
  root.appendChild(add);
}
