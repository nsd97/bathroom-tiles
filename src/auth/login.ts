import { supabase } from './client';

export function mountLogin(root: HTMLElement, opts: { onSent: () => void }): void {
  root.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.className = 'auth-screen';

  const card = document.createElement('form');
  card.className = 'auth-card';
  card.noValidate = true;

  const heading = document.createElement('h1');
  heading.className = 'auth-title';
  heading.textContent = 'Sign in to the tile planner.';

  const label = document.createElement('label');
  label.className = 'auth-label';
  label.htmlFor = 'auth-email';
  label.textContent = 'Email';

  const input = document.createElement('input');
  input.id = 'auth-email';
  input.className = 'auth-input';
  input.type = 'email';
  input.required = true;
  input.autocomplete = 'email';
  input.placeholder = 'your email';

  const button = document.createElement('button');
  button.className = 'auth-button';
  button.type = 'submit';
  button.textContent = 'Send magic link';

  const status = document.createElement('p');
  status.className = 'auth-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  card.append(heading, label, input, button, status);
  wrap.append(card);
  root.append(wrap);

  input.focus();

  card.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = input.value.trim();
    if (!email) {
      setStatus(status, 'Enter an email address.', 'error');
      return;
    }
    setStatus(status, 'Sending magic link…', 'info');
    button.disabled = true;
    input.disabled = true;
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) {
        setStatus(status, error.message, 'error');
        button.disabled = false;
        input.disabled = false;
        return;
      }
      setStatus(status, `Check ${email}. Click the link to sign in.`, 'success');
      opts.onSent();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Something went wrong.';
      setStatus(status, msg, 'error');
      button.disabled = false;
      input.disabled = false;
    }
  });
}

function setStatus(el: HTMLElement, message: string, kind: 'info' | 'error' | 'success'): void {
  el.textContent = message;
  el.dataset.kind = kind;
}
