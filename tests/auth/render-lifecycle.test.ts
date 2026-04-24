import { describe, expect, it, vi } from 'vitest';
import { createGateViewController } from '@/auth/render-lifecycle';

describe('createGateViewController', () => {
  it('does not remount the ready view for the same signed-in user', async () => {
    const readyCleanup = vi.fn();
    const mountSignedOut = vi.fn();
    const mountNotAllowed = vi.fn();
    const mountReady = vi.fn(async () => readyCleanup);

    const controller = createGateViewController({
      mountSignedOut,
      mountNotAllowed,
      mountReady,
    });

    await controller.render('ready', 'user-1');
    await controller.render('ready', 'user-1');

    expect(mountReady).toHaveBeenCalledTimes(1);
    expect(readyCleanup).not.toHaveBeenCalled();
    expect(mountSignedOut).not.toHaveBeenCalled();
    expect(mountNotAllowed).not.toHaveBeenCalled();
  });

  it('cleans up the previous mounted view before switching states', async () => {
    const readyCleanup = vi.fn();
    const signedOutCleanup = vi.fn();
    const mountReady = vi.fn(async () => readyCleanup);
    const mountSignedOut = vi.fn(() => signedOutCleanup);

    const controller = createGateViewController({
      mountSignedOut,
      mountNotAllowed: vi.fn(),
      mountReady,
    });

    await controller.render('ready', 'user-1');
    await controller.render('signed-out', null);

    expect(readyCleanup).toHaveBeenCalledTimes(1);
    expect(mountSignedOut).toHaveBeenCalledTimes(1);
    expect(signedOutCleanup).not.toHaveBeenCalled();
  });
});
