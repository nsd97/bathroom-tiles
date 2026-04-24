import { describe, expect, it } from 'vitest';
import { gateStateFor, ALLOWLIST } from '@/auth/gate';

describe('gateStateFor', () => {
  it('returns signed-out when no session', () => {
    expect(gateStateFor(null)).toBe('signed-out');
  });

  it('returns not-allowed for a session with a non-allowlisted email', () => {
    const session = { user: { email: 'hacker@example.com' } } as any;
    expect(gateStateFor(session)).toBe('not-allowed');
  });

  it('returns ready for each allowlisted email', () => {
    for (const email of ALLOWLIST) {
      const session = { user: { email } } as any;
      expect(gateStateFor(session)).toBe('ready');
    }
  });

  it('returns not-allowed for a session with no email', () => {
    const session = { user: {} } as any;
    expect(gateStateFor(session)).toBe('not-allowed');
  });
});
