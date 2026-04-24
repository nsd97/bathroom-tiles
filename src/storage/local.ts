import type { State } from '@/core/state';

const STORAGE_KEY = 'tilePlanner.ui.v1';

export interface UIPrefs {
  viewMode?: '2d' | '3d';
  orbit?: { rotX: number; rotY: number };
}

export function loadUIPrefs(): UIPrefs | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as UIPrefs;
  } catch {
    // ignore
  }
  return null;
}

export function persistUIPrefs(state: State): void {
  try {
    const prefs: UIPrefs = {
      viewMode: state.viewMode,
      orbit: state.orbit,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function applyUIPrefs(state: State, prefs: UIPrefs): void {
  if (prefs.viewMode === '2d' || prefs.viewMode === '3d') state.viewMode = prefs.viewMode;
  if (prefs.orbit && typeof prefs.orbit.rotX === 'number' && typeof prefs.orbit.rotY === 'number') {
    state.orbit = prefs.orbit;
  }
}
