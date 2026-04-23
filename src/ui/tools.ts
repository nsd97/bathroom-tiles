import type { State, Tool } from '@/core/state';

const VALID_TOOLS: readonly Tool[] = ['paint', 'eyedrop', 'erase'];

function isTool(v: string | undefined): v is Tool {
  return v !== undefined && (VALID_TOOLS as readonly string[]).includes(v);
}

export function wireToolButtons(buttons: HTMLButtonElement[], state: State): void {
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.tool;
      if (!isTool(t)) return;
      state.tool = t;
      buttons.forEach(b => b.classList.toggle('active', b === btn));
    });
  });
}

export function effectiveTool(state: State, e: { altKey: boolean; shiftKey: boolean }): Tool {
  if (e.altKey) return 'erase';
  if (e.shiftKey) return 'eyedrop';
  return state.tool;
}
