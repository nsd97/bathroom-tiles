/**
 * A small fixed-position pill in the top-right corner that surfaces two
 * transport-layer conditions: realtime channel health and browser network
 * online/offline. Nothing shows when both are good.
 *
 * The visible text is decided by `pillStateFor`, which is a pure function so
 * it can be exercised by a focused unit test without touching the DOM.
 */

export type RealtimeStatus =
  | 'SUBSCRIBED'
  | 'CHANNEL_ERROR'
  | 'TIMED_OUT'
  | 'CLOSED';

export interface PillState {
  /** The string to render inside the pill, or `null` to hide it. */
  text: string | null;
  /** Styling variant — maps to a CSS class suffix. */
  variant: 'neutral' | 'danger' | null;
}

/**
 * Pure decision table for the pill's visible state. Offline beats
 * reconnecting because network failure is the root cause the user needs to
 * fix; showing "Reconnecting…" while the tab is offline is noise.
 */
export function pillStateFor(status: RealtimeStatus, online: boolean): PillState {
  if (!online) return { text: 'Offline', variant: 'danger' };
  if (status === 'SUBSCRIBED') return { text: null, variant: null };
  return { text: 'Reconnecting\u2026', variant: 'neutral' };
}

export interface ConnectionIndicator {
  setRealtimeStatus: (s: RealtimeStatus) => void;
  setOnline: (online: boolean) => void;
  destroy: () => void;
}

/**
 * Append a connection-status pill to `root` (typically `document.body`) and
 * return imperative setters for the two input signals. Initial state is
 * `SUBSCRIBED` + `navigator.onLine` so callers don't have to prime it
 * unless the values differ.
 */
export function mountConnectionIndicator(root: HTMLElement): ConnectionIndicator {
  const el = document.createElement('div');
  el.className = 'connection-pill';
  el.hidden = true;
  root.appendChild(el);

  let status: RealtimeStatus = 'SUBSCRIBED';
  let online: boolean =
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true;

  const apply = (): void => {
    const state = pillStateFor(status, online);
    if (state.text === null) {
      el.hidden = true;
      el.textContent = '';
      el.classList.remove('connection-pill-neutral', 'connection-pill-danger');
      return;
    }
    el.hidden = false;
    el.textContent = state.text;
    el.classList.toggle('connection-pill-neutral', state.variant === 'neutral');
    el.classList.toggle('connection-pill-danger', state.variant === 'danger');
  };

  apply();

  return {
    setRealtimeStatus: (s) => {
      status = s;
      apply();
    },
    setOnline: (v) => {
      online = v;
      apply();
    },
    destroy: () => {
      el.remove();
    },
  };
}
