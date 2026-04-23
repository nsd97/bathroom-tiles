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

      const chip = document.createElement('span');
      chip.className = 'count-chip';
      chip.style.backgroundColor = color;
      row.appendChild(chip);

      const label = document.createElement('span');
      label.className = 'count-label';
      label.textContent = color;
      if (cutN) {
        const parenthetical = document.createElement('span');
        parenthetical.style.opacity = '.6';
        parenthetical.textContent = ` (${fullN}+${cutN}c)`;
        label.appendChild(document.createTextNode(' '));
        label.appendChild(parenthetical);
      }
      row.appendChild(label);

      const num = document.createElement('span');
      num.className = 'count-num';
      num.textContent = n.toLocaleString();
      row.appendChild(num);

      refs.countsEl.appendChild(row);
    }
  }
  refs.totalEl.textContent = totals.totalPainted.toLocaleString();
  refs.fullCutTotalEl.textContent = `${totals.totalPaintedFull.toLocaleString()} \u00b7 ${totals.totalPaintedCut.toLocaleString()}`;
  refs.orderTotalEl.textContent = totals.totalPainted ? totals.order.toLocaleString() : '\u2014';
}
