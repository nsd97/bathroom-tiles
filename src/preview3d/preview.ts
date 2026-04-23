import { getGrid, cellKey, TILE_PX, TILE_INCH } from '@/core/grid';
import type { State, Surface } from '@/core/state';

const PX_PER_INCH_3D = 3;
const TILE_PX_3D = TILE_INCH * PX_PER_INCH_3D;
const ORBIT_AC_KEY = '__orbitAC__';

interface ContainerWithAC extends HTMLElement {
  [ORBIT_AC_KEY]?: AbortController;
}

export function render3D(container: HTMLElement, state: State, onChange: () => void): void {
  // Abort previous orbit listeners before tearing down the old scene.
  const c = container as ContainerWithAC;
  c[ORBIT_AC_KEY]?.abort();
  container.innerHTML = '';

  const need = (id: string): Surface => {
    const s = state.surfaces.find(x => x.id === id);
    if (!s) throw new Error(`preview3d: missing surface '${id}'`);
    return s;
  };

  const main = need('main');
  const shower = need('shower');
  const ceiling = need('ceiling');
  const wallN = need('wallN');
  const wallS = need('wallS');
  const wallE = need('wallE');
  const wallW = need('wallW');

  const roomWin = ceiling.widthIn;
  const roomDin = ceiling.heightIn;
  const roomHin = state.ceilFt * 12;
  const roomW = roomWin * PX_PER_INCH_3D;
  const roomD = roomDin * PX_PER_INCH_3D;
  const roomH = roomHin * PX_PER_INCH_3D;

  const scene = document.createElement('div');
  scene.className = 'scene-3d';

  const world = document.createElement('div');
  world.className = 'world';
  world.style.width = roomW + 'px';
  world.style.height = roomH + 'px';
  scene.appendChild(world);

  const build3DFace = (s: Surface, transform: string): HTMLElement => {
    const face = document.createElement('div');
    face.className = 'face';
    face.dataset.surfaceId = s.id;
    const wPx = s.widthIn * PX_PER_INCH_3D;
    const hPx = s.heightIn * PX_PER_INCH_3D;
    face.style.width = wPx + 'px';
    face.style.height = hPx + 'px';
    face.style.transform = transform;

    const grid = document.createElement('div');
    grid.className = 'grid-3d';
    grid.style.width = wPx + 'px';
    grid.style.height = hPx + 'px';

    const g = getGrid(s);
    const colSizes3d = g.colSizes.map(v => (v / TILE_PX) * TILE_PX_3D);
    const rowSizes3d = g.rowSizes.map(v => (v / TILE_PX) * TILE_PX_3D);
    grid.style.gridTemplateColumns = colSizes3d.map(v => v.toFixed(2) + 'px').join(' ');
    grid.style.gridTemplateRows = rowSizes3d.map(v => v.toFixed(2) + 'px').join(' ');

    const tilesMap = state.tiles[s.id] ?? new Map<string, string>();
    for (let r = 0; r < g.rows; r++) {
      for (let col = 0; col < g.cols; col++) {
        const t = document.createElement('div');
        t.className = 'tile-3d';
        const color = tilesMap.get(cellKey(r, col));
        if (color) t.style.background = color;
        grid.appendChild(t);
      }
    }
    face.appendChild(grid);
    return face;
  };

  // applyOrbit closes over roomW/H/D captured at render time; any dim change must trigger re-render.
  const applyOrbit = (): void => {
    const { rotX, rotY } = state.orbit;
    world.style.transform =
      `rotateX(${rotX}deg) rotateY(${rotY}deg) translate3d(${-roomW / 2}px, ${-roomH / 2}px, ${-roomD / 2}px)`;
  };

  world.appendChild(build3DFace(ceiling,
    `translate3d(0px, 0px, ${roomD}px) rotateX(-90deg)`));

  const showerWpx = shower.widthIn * PX_PER_INCH_3D;
  world.appendChild(build3DFace(shower,
    `translate3d(0px, ${roomH}px, 0px) rotateX(90deg)`));
  world.appendChild(build3DFace(main,
    `translate3d(${showerWpx}px, ${roomH}px, 0px) rotateX(90deg)`));

  world.appendChild(build3DFace(wallN, `translate3d(0px, 0px, 0px)`));
  world.appendChild(build3DFace(wallS, `translate3d(${roomW}px, 0px, ${roomD}px) rotateY(180deg)`));
  world.appendChild(build3DFace(wallE, `translate3d(${roomW}px, 0px, 0px) rotateY(-90deg)`));
  world.appendChild(build3DFace(wallW, `translate3d(0px, 0px, ${roomD}px) rotateY(90deg)`));

  applyOrbit();

  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'drag to orbit';
  scene.appendChild(hint);

  const reset = document.createElement('button');
  reset.className = 'orbit-reset';
  reset.textContent = 'Reset view';
  reset.addEventListener('click', () => {
    state.orbit = { rotX: -18, rotY: -28 };
    applyOrbit();
    onChange();
  });
  scene.appendChild(reset);

  // Fresh AbortController per render; aborted by the next render3D call.
  const ac = new AbortController();
  c[ORBIT_AC_KEY] = ac;
  const { signal } = ac;

  let dragging = false;
  let lastX = 0, lastY = 0;
  scene.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('button')) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    state.orbit.rotY += dx * 0.5;
    state.orbit.rotX = Math.max(-80, Math.min(10, state.orbit.rotX - dy * 0.4));
    applyOrbit();
  }, { signal });
  window.addEventListener('mouseup', () => {
    if (dragging) { dragging = false; onChange(); }
  }, { signal });

  container.appendChild(scene);
}
