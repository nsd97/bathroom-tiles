import type { State, Tool } from '@/core/state';

export function wireToolButtons(buttons: HTMLButtonElement[], state: State): void {
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tool = btn.dataset.tool as Tool;
      buttons.forEach(b => b.classList.toggle('active', b === btn));
    });
  });
}

export function effectiveTool(state: State, e: { altKey: boolean; shiftKey: boolean }): Tool {
  if (e.altKey) return 'erase';
  if (e.shiftKey) return 'eyedrop';
  return state.tool;
}
