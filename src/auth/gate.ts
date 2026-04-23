import type { Session } from '@supabase/supabase-js';

export const ALLOWLIST = [
  'deskinnoah@gmail.com',
  'brenda@deskin.ca',
  'mackenzieagretto1@gmail.com',
] as const;

export type GateState = 'loading' | 'signed-out' | 'not-allowed' | 'ready';

export function gateStateFor(session: Session | null): GateState {
  if (!session) return 'signed-out';
  const email = session.user?.email;
  if (!email) return 'not-allowed';
  return (ALLOWLIST as readonly string[]).includes(email) ? 'ready' : 'not-allowed';
}
