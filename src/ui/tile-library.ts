import type { Tile, TileShape } from '@/core/tile';
import { defaultTileLabel } from '@/core/tile';

/**
 * Glyphs used throughout the tile-library UI to signal shape at a glance.
 * Kept exported so the surface-head "Tile: …" chip can use the same mapping.
 */
export const SHAPE_GLYPHS: Record<TileShape, string> = {
  square: '\u25A0',       // ■
  'hex-pointy': '\u2B22', // ⬢
  'hex-flat': '\u2B21',   // ⬡
};

export interface TileLibraryHandlers {
  /** Called when a tile row is clicked — controller assigns it to the focused surface. */
  onSelect: (tile: Tile) => void;
  /** Called when the hover-shown × is clicked. UI only surfaces × when `inUseCount === 0`. */
  onDelete: (tile: Tile, inUseCount: number) => void;
  /** Called when "+ New tile" is clicked. Controller swaps the button for an inline form. */
  onAddRequested: () => void;
  /** The id of the currently focused surface, or null when no surface has focus. */
  focusedSurfaceId: string | null;
  /** tileId of the focused surface — row that matches is shown as `.active`. */
  focusedSurfaceTileId: string | null;
  /** How many surfaces currently reference this tileId. Drives the delete-gate UI. */
  inUseCount: (tileId: string) => number;
}

/**
 * Render the tile-library panel into `root`. Clears previous content. This is
 * the default (non-editing) view — the "+ New tile" button is shown at the
 * bottom. When the user clicks it, the controller re-renders this component
 * with a live form via `renderNewTileForm`.
 */
export function renderTileLibrary(
  root: HTMLElement,
  tiles: Tile[],
  handlers: TileLibraryHandlers,
): void {
  root.innerHTML = '';
  const list = document.createElement('div');
  list.className = 'tile-library';
  for (const tile of tiles) {
    list.appendChild(buildTileRow(tile, handlers));
  }
  const addBtn = document.createElement('button');
  addBtn.className = 'tile-add';
  addBtn.type = 'button';
  addBtn.textContent = '+ New tile';
  addBtn.addEventListener('click', () => handlers.onAddRequested());
  list.appendChild(addBtn);
  root.appendChild(list);
}

function buildTileRow(tile: Tile, handlers: TileLibraryHandlers): HTMLElement {
  const row = document.createElement('div');
  row.className = 'tile-row';
  row.dataset.tileId = tile.id;
  if (tile.id === handlers.focusedSurfaceTileId) row.classList.add('active');

  const glyph = document.createElement('span');
  glyph.className = 'tile-glyph';
  glyph.textContent = SHAPE_GLYPHS[tile.shape];
  row.appendChild(glyph);

  const label = document.createElement('span');
  label.className = 'tile-label';
  label.textContent = tile.label;
  row.appendChild(label);

  const count = handlers.inUseCount(tile.id);
  if (count === 0) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'tile-delete';
    del.textContent = '\u00D7'; // ×
    del.title = 'Delete tile';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onDelete(tile, 0);
    });
    row.appendChild(del);
  } else {
    const note = document.createElement('span');
    note.className = 'tile-inuse';
    note.textContent = '\u00B7 in use';
    row.appendChild(note);
  }

  row.addEventListener('click', () => handlers.onSelect(tile));
  return row;
}

/**
 * Pure reducer for the inline new-tile form's label field. Returns the label
 * value that should be displayed for the current form state.
 *
 * - When the user has NOT typed in the label (`labelDirty === false`), the
 *   label tracks the shape+size defaults (`defaultTileLabel(shape, sizeIn)`).
 * - When the user HAS typed, their value wins and is returned verbatim.
 * - When `sizeIn` is not a positive finite number, the default is not
 *   derivable — we fall back to the user's typed value (which may be empty).
 *
 * This is extracted as a pure function to allow unit testing without a DOM.
 */
export function labelDraftState(input: {
  shape: TileShape;
  sizeIn: number;
  userTyped: string;
  labelDirty: boolean;
}): string {
  if (input.labelDirty) return input.userTyped;
  if (!Number.isFinite(input.sizeIn) || input.sizeIn <= 0) return input.userTyped;
  return defaultTileLabel(input.shape, input.sizeIn);
}

export interface NewTileFormHandlers {
  /** Called on Add tile click with a validated draft (size > 0, label trimmed non-empty). */
  onCreate: (draft: { shape: TileShape; sizeIn: number; label: string }) => void;
  /** Called on Cancel click — controller should re-render the default view. */
  onCancel: () => void;
}

/**
 * Replace the "+ New tile" button inside an already-rendered library panel
 * with an inline form. `root` is the panel root (the element `renderTileLibrary`
 * wrote into). The form manages its own state internally; only `onCreate` and
 * `onCancel` are exposed.
 */
export function renderNewTileForm(root: HTMLElement, handlers: NewTileFormHandlers): void {
  const list = root.querySelector<HTMLElement>('.tile-library');
  if (!list) return;
  const addBtn = list.querySelector<HTMLButtonElement>('.tile-add');
  if (!addBtn) return;

  let shape: TileShape = 'square';
  let sizeRaw = '';
  let labelDirty = false;
  let labelUserValue = '';

  const form = document.createElement('div');
  form.className = 'tile-form';

  // Shape pills.
  const pills = document.createElement('div');
  pills.className = 'tile-form-pills';
  const shapes: Array<{ value: TileShape; label: string }> = [
    { value: 'square', label: `${SHAPE_GLYPHS.square} Square` },
    { value: 'hex-pointy', label: `${SHAPE_GLYPHS['hex-pointy']} Pointy hex` },
    { value: 'hex-flat', label: `${SHAPE_GLYPHS['hex-flat']} Flat hex` },
  ];
  const pillButtons = shapes.map((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tile-form-pill' + (s.value === shape ? ' active' : '');
    b.dataset.shape = s.value;
    b.textContent = s.label;
    b.addEventListener('click', () => {
      shape = s.value;
      pillButtons.forEach((x) => x.classList.toggle('active', x.dataset.shape === shape));
      syncLabel();
      syncAddEnabled();
    });
    pills.appendChild(b);
    return b;
  });
  form.appendChild(pills);

  // Size input row.
  const sizeRow = document.createElement('div');
  sizeRow.className = 'tile-form-row';
  const sizeLbl = document.createElement('label');
  sizeLbl.textContent = 'Size';
  const sizeInput = document.createElement('input');
  sizeInput.type = 'number';
  sizeInput.step = '0.01';
  sizeInput.min = '0.01';
  sizeInput.className = 'tile-form-size';
  sizeInput.placeholder = '0.00';
  const sizeSuffix = document.createElement('span');
  sizeSuffix.className = 'tile-form-suffix';
  sizeSuffix.textContent = 'in';
  sizeInput.addEventListener('input', () => {
    sizeRaw = sizeInput.value;
    syncLabel();
    syncAddEnabled();
  });
  sizeRow.append(sizeLbl, sizeInput, sizeSuffix);
  form.appendChild(sizeRow);

  // Label input row.
  const labelRow = document.createElement('div');
  labelRow.className = 'tile-form-row';
  const labelLbl = document.createElement('label');
  labelLbl.textContent = 'Label';
  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.className = 'tile-form-label';
  labelInput.addEventListener('input', () => {
    labelDirty = true;
    labelUserValue = labelInput.value;
  });
  labelRow.append(labelLbl, labelInput);
  form.appendChild(labelRow);

  // Action row.
  const actionRow = document.createElement('div');
  actionRow.className = 'tile-form-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'tile-form-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => handlers.onCancel());
  const addBtn2 = document.createElement('button');
  addBtn2.type = 'button';
  addBtn2.className = 'tile-form-submit';
  addBtn2.textContent = 'Add tile';
  addBtn2.addEventListener('click', () => {
    const sizeIn = parseFloat(sizeRaw);
    if (!Number.isFinite(sizeIn) || sizeIn <= 0) return;
    const resolvedLabel = labelDraftState({ shape, sizeIn, userTyped: labelUserValue, labelDirty });
    const trimmed = resolvedLabel.trim();
    if (!trimmed) return;
    handlers.onCreate({ shape, sizeIn, label: trimmed });
  });
  actionRow.append(cancelBtn, addBtn2);
  form.appendChild(actionRow);

  function syncLabel(): void {
    const sizeIn = parseFloat(sizeRaw);
    const next = labelDraftState({ shape, sizeIn, userTyped: labelUserValue, labelDirty });
    // Keep the placeholder up to date as a preview of the default.
    if (Number.isFinite(sizeIn) && sizeIn > 0) {
      labelInput.placeholder = defaultTileLabel(shape, sizeIn);
    } else {
      labelInput.placeholder = '';
    }
    // Only mutate the visible value when we're driving it — don't stomp on the user.
    if (!labelDirty) labelInput.value = next;
  }

  function syncAddEnabled(): void {
    const sizeIn = parseFloat(sizeRaw);
    addBtn2.disabled = !Number.isFinite(sizeIn) || sizeIn <= 0;
  }

  syncLabel();
  syncAddEnabled();

  addBtn.replaceWith(form);
  sizeInput.focus();
}
