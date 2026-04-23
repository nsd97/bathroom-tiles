export interface LayoutRefs {
  ceilInput: HTMLInputElement;
  swatchesEl: HTMLElement;
  toolButtons: HTMLButtonElement[];
  countsEl: HTMLElement;
  totalEl: HTMLElement;
  fullCutTotalEl: HTMLElement;
  orderTotalEl: HTMLElement;
  saveBtn: HTMLButtonElement;
  loadBtn: HTMLButtonElement;
  resetBtn: HTMLButtonElement;
  viewToggleButtons: HTMLButtonElement[];
  canvas2d: HTMLElement;
  canvas3d: HTMLElement;
}

export function mountLayout(root: HTMLElement): LayoutRefs {
  root.innerHTML = `
    <aside>
      <div>
        <h1>Tile Planner</h1>
        <div class="sub">7.87\u2033 \u00d7 7.87\u2033 tiles \u00b7 bathroom</div>
      </div>
      <section>
        <h2>Room</h2>
        <div class="field">
          <label for="ceil">Ceiling height</label>
          <div><input type="number" id="ceil" value="9" step="0.5" min="7" max="14"> <span class="sub">ft</span></div>
        </div>
      </section>
      <section>
        <h2>Palette</h2>
        <div class="swatches" id="swatches"></div>
      </section>
      <section>
        <h2>Tool</h2>
        <div class="tools">
          <button class="tool-btn active" data-tool="paint"><span>Paint</span><span class="kbd">click</span></button>
          <button class="tool-btn" data-tool="eyedrop"><span>Eyedrop</span><span class="kbd">\u21e7</span></button>
          <button class="tool-btn" data-tool="erase"><span>Erase</span><span class="kbd">\u2325</span></button>
        </div>
      </section>
      <section>
        <h2>Tile counts</h2>
        <div id="counts"></div>
        <div class="count-total"><span>Total</span><span id="total">\u2014</span></div>
        <div class="count-sub"><span>Full \u00b7 cut</span><span id="full-cut-total">\u2014</span></div>
        <div class="count-sub"><span>Order (+10% waste)</span><span id="order-total">\u2014</span></div>
      </section>
      <section>
        <h2>File</h2>
        <div class="io-row">
          <button class="io-btn" id="save">Save</button>
          <button class="io-btn" id="load">Load</button>
          <button class="io-btn" id="reset">Reset</button>
        </div>
      </section>
    </aside>
    <main>
      <div class="canvas-header">
        <h2>Every surface.</h2>
        <p>Drawn at real dimensions. Edge tiles render at their true cut width with a diagonal mark \u2014 every cut still comes from a whole tile of stock, so it counts as one for the order. Click or drag to paint. Hold <code>shift</code> to eyedrop, <code>option</code> to erase.</p>
      </div>
      <div class="view-toggle" id="view-toggle">
        <button data-view="2d" class="active">2D paint</button>
        <button data-view="3d">3D preview</button>
      </div>
      <div id="canvas"></div>
      <div id="canvas-3d" hidden></div>
    </main>
  `;

  const q = <T extends HTMLElement>(sel: string): T => {
    const el = root.querySelector<T>(sel);
    if (!el) throw new Error(`missing element: ${sel}`);
    return el;
  };

  return {
    ceilInput: q<HTMLInputElement>('#ceil'),
    swatchesEl: q('#swatches'),
    toolButtons: Array.from(root.querySelectorAll<HTMLButtonElement>('.tool-btn')),
    countsEl: q('#counts'),
    totalEl: q('#total'),
    fullCutTotalEl: q('#full-cut-total'),
    orderTotalEl: q('#order-total'),
    saveBtn: q<HTMLButtonElement>('#save'),
    loadBtn: q<HTMLButtonElement>('#load'),
    resetBtn: q<HTMLButtonElement>('#reset'),
    viewToggleButtons: Array.from(root.querySelectorAll<HTMLButtonElement>('#view-toggle button')),
    canvas2d: q('#canvas'),
    canvas3d: q('#canvas-3d'),
  };
}
