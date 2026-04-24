import type { GateState } from './gate';

type Cleanup = () => void;
type MaybeCleanup = void | Cleanup;
type MaybePromiseCleanup = MaybeCleanup | Promise<MaybeCleanup>;

export interface GateViewMounts {
  mountSignedOut: () => MaybeCleanup;
  mountNotAllowed: () => MaybeCleanup;
  mountReady: (userId: string | null) => MaybePromiseCleanup;
}

export interface GateViewController {
  render: (state: GateState, userId: string | null) => Promise<void>;
  dispose: () => void;
}

export function createGateViewController(mounts: GateViewMounts): GateViewController {
  let mountedState: GateState | null = null;
  let mountedUserId: string | null = null;
  let cleanup: Cleanup | null = null;
  let renderToken = 0;

  const normalizeCleanup = (value: MaybeCleanup): Cleanup | null =>
    typeof value === 'function' ? value : null;

  return {
    async render(state: GateState, userId: string | null): Promise<void> {
      const nextUserId = state === 'ready' ? userId : null;
      if (mountedState === state && mountedUserId === nextUserId) return;

      renderToken += 1;
      const token = renderToken;

      cleanup?.();
      cleanup = null;
      mountedState = state;
      mountedUserId = nextUserId;

      let mounted: MaybeCleanup;
      if (state === 'signed-out') mounted = mounts.mountSignedOut();
      else if (state === 'not-allowed') mounted = mounts.mountNotAllowed();
      else mounted = await mounts.mountReady(userId);

      const normalized = normalizeCleanup(mounted);
      if (token !== renderToken) {
        normalized?.();
        return;
      }
      cleanup = normalized;
    },

    dispose(): void {
      renderToken += 1;
      cleanup?.();
      cleanup = null;
      mountedState = null;
      mountedUserId = null;
    },
  };
}
