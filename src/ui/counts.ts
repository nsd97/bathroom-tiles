import { computeTotals } from '@/core/stats';
import type { State } from '@/core/state';

export interface CountsRefs {
  countsEl: HTMLElement;
  totalEl: HTMLElement;
  fullCutTotalEl: HTMLElement;
  orderTotalEl: HTMLElement;
}

export function renderCounts(refs: CountsRefs, state: State): void {
  const totals = computeTotals(state.surfaces, state.tiles);
  refs.countsEl.innerHTML = '';
  if (totals.byColor.size === 0) {
    const d = document.createElement('div');
    d.className = 'count-empty';
    d.textContent = 'No tiles painted yet.';
    refs.countsEl.appendChild(d);
  } else {
    const sorted = [...totals.byColor.entries()].sort((a, b) => b[1] - a[1]);
    for (const [color, n] of sorted) {
      const cutN = totals.byColorCut.get(color) ?? 0;
      const fullN = n - cutN;
      const row = document.createElement('div');
      row.className = 'count-row';
      row.innerHTML = `
        <span class="count-chip" style="background:${color}"></span>
        <span class="count-label">${color}${cutN ? ` <span style="opacity:.6">(${fullN}+${cutN}c)</span>` : ''}</span>
        <span class="count-num">${n.toLocaleString()}</span>
      `;
      refs.countsEl.appendChild(row);
    }
  }
  refs.totalEl.textContent = totals.totalPainted.toLocaleString();
  refs.fullCutTotalEl.textContent = `${totals.totalPaintedFull.toLocaleString()} \u00b7 ${totals.totalPaintedCut.toLocaleString()}`;
  refs.orderTotalEl.textContent = totals.totalPainted ? totals.order.toLocaleString() : '\u2014';
}
