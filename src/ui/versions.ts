import type { Version } from '@/core/state';

export interface VersionsHandlers {
  /** User clicked "+ Save as version…". Controller swaps the button for an inline form (see `renderSaveForm`). */
  onSaveRequested: () => void;
  /** User confirmed Load for a row. Controller triggers the restore flow. */
  onLoad: (version: Version) => void;
  /** User confirmed Delete for a row. */
  onDelete: (version: Version) => void;
  /** Current session user's id — used to label "you" vs a shortened uuid. May be null before session hydrates. */
  currentUserId: string | null;
}

/**
 * Pretty-print a createdAt ISO string as "just now", "3m ago", "2h ago", or
 * "4d ago". Falls back to the raw date if parsing fails. Pure so it's testable.
 *
 * Thresholds picked to match tile-library's terse aesthetic — we care about
 * quick scannability, not precision.
 */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const delta = Math.max(0, now - t);
  const sec = Math.floor(delta / 1000);
  if (sec < 45) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

/**
 * Pure author-label reducer. Shows "you" for the current session user, a
 * 6-char shortened uuid for other authors, and "—" when createdBy is null
 * (e.g., rows inserted before RLS put a default on the column).
 */
export function authorLabel(createdBy: string | null, currentUserId: string | null): string {
  if (!createdBy) return '\u2014'; // em-dash
  if (currentUserId && createdBy === currentUserId) return 'you';
  return createdBy.slice(0, 6) + '\u2026';
}

/**
 * Render the versions panel into `root`. Clears previous content. The bottom
 * "+ Save as version…" button is the default affordance. When the user clicks
 * it, the controller calls `renderSaveForm` to swap the button for an inline
 * form.
 *
 * Row interactions:
 * - Click anywhere on the row body (but not the × region) to open an inline
 *   Load confirm for that row.
 * - Hover the row to reveal ×; click × to open an inline Delete confirm.
 */
export function renderVersions(
  root: HTMLElement,
  versions: Version[],
  handlers: VersionsHandlers,
): void {
  root.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'version-library';
  for (const v of versions) {
    list.appendChild(buildVersionRow(v, handlers));
  }
  const addBtn = document.createElement('button');
  addBtn.className = 'version-add';
  addBtn.type = 'button';
  addBtn.textContent = '+ Save as version\u2026';
  addBtn.addEventListener('click', () => handlers.onSaveRequested());
  list.appendChild(addBtn);
  root.appendChild(list);
}

function buildVersionRow(version: Version, handlers: VersionsHandlers): HTMLElement {
  const row = document.createElement('div');
  row.className = 'version-row';
  row.dataset.versionId = version.id;

  const label = document.createElement('span');
  label.className = 'version-label';
  label.textContent = version.label;

  const meta = document.createElement('span');
  meta.className = 'version-meta';
  const when = timeAgo(version.createdAt);
  const who = authorLabel(version.createdBy, handlers.currentUserId);
  meta.textContent = `${when} \u00b7 ${who}`;

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'version-delete';
  del.textContent = '\u00D7'; // ×
  del.title = 'Delete version';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    showDeleteConfirm(row, version, handlers);
  });

  row.append(label, meta, del);
  row.addEventListener('click', (e) => {
    // Guard against re-opening while a confirm bar is already swapped in.
    if (row.classList.contains('confirming')) return;
    if (e.target instanceof Element && e.target.closest('.version-delete')) return;
    showLoadConfirm(row, version, handlers);
  });
  return row;
}

/**
 * Replace row contents with a Load confirm bar. On Cancel, restore the row by
 * re-rendering it in place. Keeping the swap local to the row avoids a full
 * panel rebuild and the focus flicker that comes with it.
 */
function showLoadConfirm(
  row: HTMLElement,
  version: Version,
  handlers: VersionsHandlers,
): void {
  row.classList.add('confirming');
  row.innerHTML = '';

  const msg = document.createElement('span');
  msg.className = 'version-confirm-msg';
  msg.textContent = `Load "${version.label}"? Unsaved changes will be lost.`;

  const actions = document.createElement('div');
  actions.className = 'version-confirm-actions';

  const loadBtn = document.createElement('button');
  loadBtn.type = 'button';
  loadBtn.className = 'version-confirm-primary';
  loadBtn.textContent = 'Load';
  loadBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.onLoad(version);
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'version-confirm-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    row.classList.remove('confirming');
    rehydrateRow(row, version, handlers);
  });

  actions.append(loadBtn, cancelBtn);
  row.append(msg, actions);
}

/**
 * Same pattern as `showLoadConfirm`, but for delete — the one-click inline
 * confirm replaces a browser `confirm()` dialog (matches the design doc's
 * minimal-chrome aesthetic).
 */
function showDeleteConfirm(
  row: HTMLElement,
  version: Version,
  handlers: VersionsHandlers,
): void {
  row.classList.add('confirming');
  row.innerHTML = '';

  const msg = document.createElement('span');
  msg.className = 'version-confirm-msg';
  msg.textContent = `Delete "${version.label}"?`;

  const actions = document.createElement('div');
  actions.className = 'version-confirm-actions';

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'version-confirm-danger';
  deleteBtn.textContent = 'Delete';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handlers.onDelete(version);
  });

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'version-confirm-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    row.classList.remove('confirming');
    rehydrateRow(row, version, handlers);
  });

  actions.append(deleteBtn, cancelBtn);
  row.append(msg, actions);
}

/**
 * Re-populate a row's children to match its pre-confirm state. We can't just
 * call buildVersionRow again because that would attach a second set of
 * root-level listeners — the row element itself is preserved.
 */
function rehydrateRow(
  row: HTMLElement,
  version: Version,
  handlers: VersionsHandlers,
): void {
  row.innerHTML = '';

  const label = document.createElement('span');
  label.className = 'version-label';
  label.textContent = version.label;

  const meta = document.createElement('span');
  meta.className = 'version-meta';
  meta.textContent = `${timeAgo(version.createdAt)} \u00b7 ${authorLabel(version.createdBy, handlers.currentUserId)}`;

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'version-delete';
  del.textContent = '\u00D7';
  del.title = 'Delete version';
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    showDeleteConfirm(row, version, handlers);
  });

  row.append(label, meta, del);
}

export interface SaveVersionFormHandlers {
  /** Called with a trimmed, non-empty label when the user clicks Save. */
  onSave: (label: string) => void;
  /** Called on Cancel — controller re-renders the default panel view. */
  onCancel: () => void;
}

/**
 * Replace the "+ Save as version…" button inside an already-rendered versions
 * panel with an inline form. `root` is the panel root (the element
 * `renderVersions` wrote into). The form manages its own state internally;
 * only `onSave` and `onCancel` are exposed.
 */
export function renderSaveForm(root: HTMLElement, handlers: SaveVersionFormHandlers): void {
  const list = root.querySelector<HTMLElement>('.version-library');
  if (!list) return;
  const addBtn = list.querySelector<HTMLButtonElement>('.version-add');
  if (!addBtn) return;

  const form = document.createElement('div');
  form.className = 'version-form';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'version-form-label';
  input.placeholder = 'Label for this version';

  const actionRow = document.createElement('div');
  actionRow.className = 'version-form-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'version-form-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => handlers.onCancel());

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'version-form-submit';
  saveBtn.textContent = 'Save';
  saveBtn.disabled = true;

  const submit = (): void => {
    const trimmed = input.value.trim();
    if (!trimmed) return;
    handlers.onSave(trimmed);
  };

  saveBtn.addEventListener('click', submit);
  input.addEventListener('input', () => {
    saveBtn.disabled = input.value.trim().length === 0;
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !saveBtn.disabled) submit();
    if (e.key === 'Escape') handlers.onCancel();
  });

  actionRow.append(cancelBtn, saveBtn);
  form.append(input, actionRow);

  addBtn.replaceWith(form);
  input.focus();
}
