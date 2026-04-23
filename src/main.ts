import './styles/base.css';
import './styles/sidebar.css';
import './styles/canvas.css';
import './styles/preview3d.css';
import './styles/auth.css';

import { supabase } from './auth/client';
import { gateStateFor } from './auth/gate';
import { mountLogin } from './auth/login';

async function boot() {
  const root = document.getElementById('app');
  if (!root) throw new Error('missing #app');

  const { data: { session } } = await supabase.auth.getSession();
  let state = gateStateFor(session);

  function render() {
    if (state === 'signed-out') {
      mountLogin(root!, { onSent: () => {} });
    } else if (state === 'not-allowed') {
      root!.innerHTML = '<div class="denied">Access denied.</div>';
    } else if (state === 'ready') {
      mountApp(root!);
    }
  }

  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
    state = gateStateFor(newSession);
    render();
  });

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      subscription.unsubscribe();
    });
  }

  render();
}

function mountApp(root: HTMLElement): void {
  root.innerHTML = '<div>App hydration pending (Phase 4).</div>';
}

boot();
