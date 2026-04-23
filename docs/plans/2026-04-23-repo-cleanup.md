# Repo Cleanup Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the single-file tile planner (1261-line `index.html`) into a modular Vite + TypeScript project with layered architecture and Vitest coverage of the pure core. No behavior changes.

**Architecture:** Single source of truth `state` object owned by `main.ts`. Pure-logic modules in `core/` (no DOM). `storage/` imports `core/`. `ui/` and `preview3d/` are thin views that read state and dispatch user actions. One-way data flow: user → dispatch → pure reducer → state → render.

**Tech Stack:** Vite, TypeScript (strict), Vitest, pnpm. Zero runtime deps.

**Design doc:** `docs/plans/2026-04-23-repo-cleanup-design.md`

**Reference file during migration:** the legacy single-file app will be preserved at `index.legacy.html` until Task 10 deletes it. You can open it in a browser any time to compare behavior.

---

## Ground Rules

- **TDD** for every file in `src/core/`. Write the failing test, run it to confirm it fails, implement, confirm pass, commit.
- **No tests** for UI modules, storage, or 3D preview — verify manually in-browser.
- **Commit after each task.** The commit message prefix convention is `refactor:` (no behavior change) or `test:` for test-only commits.
- **Preserve constants verbatim:**
  - `TILE_INCH = 7.87`
  - `TILE_PX = 18`
  - `PX_PER_INCH_3D = 3`
  - localStorage key: `'tilePlanner.v2'`
- **If in doubt about current syntax**, use context7: `mcp__context7__query-docs` with library id for `vite`, `vitest`, or `typescript`. Do NOT web-search for library setup.
- **Do not start the dev server in the background and keep it running across tasks.** Start it for verification within a task, stop it, then commit.

---

## Task 1: Scaffold Vite + TypeScript + Vitest

**Files:**
- Rename: `index.html` → `index.legacy.html`
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.ts`, `.gitignore` (append)
- Modify: `.gitignore` — add `node_modules`, `dist`, `coverage`

**Step 1.1: Rename the legacy file**

```bash
git mv index.html index.legacy.html
```

**Step 1.2: Create `package.json`**

Create `package.json`:

```json
{
  "name": "bathroom-tile-planner",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^6.0.0",
    "vitest": "^2.1.0"
  }
}
```

**Step 1.3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "paths": { "@/*": ["./src/*"] },
    "baseUrl": "."
  },
  "include": ["src/**/*", "tests/**/*", "vite.config.ts"]
}
```

**Step 1.4: Create `vite.config.ts`**

```ts
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

(Vitest reads config from `vite.config.ts` via the shared `test` key.)

**Step 1.5: Create the new `index.html` shell**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tile Planner · Bathroom</title>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

**Step 1.6: Create `src/main.ts` stub**

```ts
console.log('tile planner — scaffold OK');
```

**Step 1.7: Update `.gitignore`**

Append to existing `.gitignore`:

```
node_modules
dist
coverage
```

**Step 1.8: Install dependencies**

Run: `pnpm install`
Expected: creates `node_modules/` and `pnpm-lock.yaml`.

**Step 1.9: Verify dev server starts**

Run: `pnpm dev` (background or separate terminal), open `http://localhost:5173/`, confirm page loads (blank body is fine), confirm console prints `tile planner — scaffold OK`. Stop dev server.

Also verify legacy still works: `http://localhost:5173/index.legacy.html` renders the old app.

**Step 1.10: Verify typecheck passes**

Run: `pnpm typecheck`
Expected: exits 0 with no output.

**Step 1.11: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vite.config.ts index.html index.legacy.html src/main.ts .gitignore
git commit -m "refactor: scaffold Vite + TypeScript + Vitest"
```

---

## Task 2: Split CSS into `src/styles/`

**Files:**
- Create: `src/styles/base.css`, `src/styles/sidebar.css`, `src/styles/canvas.css`, `src/styles/preview3d.css`
- Modify: `src/main.ts` — add CSS imports

**Source:** CSS from `index.legacy.html` lines 7–465 (inside the `<style>` tag).

**Split boundaries (consult `index.legacy.html`):**
- `base.css` ← lines 8–31: `:root` tokens, universal reset (`* { box-sizing... }`), `html, body` rules.
- `sidebar.css` ← lines 33–236: everything from `aside` through `.io-btn:hover` (sidebar, swatches, tools, counts, io).
- `canvas.css` ← lines 238–398: `main`, `.canvas-header`, `code`, `.group*`, `.surfaces`, `.surface*`, `.dim-*`, `.grid`, `.tile*`, `.view-toggle*`.
- `preview3d.css` ← lines 400–464: `.scene-3d` and descendants.

**Step 2.1: Create the four CSS files**

For each file, copy the exact CSS rules from the matching line range in `index.legacy.html`. Do not reformat, do not rename, do not tweak. Just move.

**Step 2.2: Add imports to `src/main.ts`**

Replace the stub with:

```ts
import './styles/base.css';
import './styles/sidebar.css';
import './styles/canvas.css';
import './styles/preview3d.css';

console.log('tile planner — styles loaded');
```

**Step 2.3: Verify imports resolve**

Run: `pnpm typecheck`
Expected: exits 0. (Vite handles CSS imports at bundle time; TS is fine with them as side-effect imports.)

**Step 2.4: Sanity-check in browser**

Start `pnpm dev`, load `/`, open DevTools → Sources → confirm the four CSS files are fetched as separate modules. The app body is still empty — that's expected. Stop dev server.

**Step 2.5: Commit**

```bash
git add src/styles/ src/main.ts
git commit -m "refactor: split CSS into modules by concern"
```

---

## Task 3: Core — `dimensions.ts` (parseDim, formatDim)

**Files:**
- Create: `src/core/dimensions.ts`
- Create: `tests/dimensions.test.ts`

**Step 3.1: Write the failing tests first**

Create `tests/dimensions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseDim, formatDim } from '@/core/dimensions';

describe('parseDim', () => {
  it('parses feet-and-inches with double quote', () => {
    expect(parseDim('14\'2"')).toBe(170);
  });
  it('parses feet-and-inches without inch unit', () => {
    expect(parseDim("14'2")).toBe(170);
  });
  it('parses plain inches with quote', () => {
    expect(parseDim('170"')).toBe(170);
  });
  it('parses plain inches without unit', () => {
    expect(parseDim('170')).toBe(170);
  });
  it('parses decimal feet', () => {
    expect(parseDim('14.5ft')).toBe(174);
  });
  it('parses with whitespace and unicode quotes', () => {
    expect(parseDim('14\u2019 2\u201D')).toBe(170);
  });
  it('returns NaN for malformed input', () => {
    expect(parseDim('nope')).toBeNaN();
    expect(parseDim('')).toBeNaN();
    expect(parseDim(null)).toBeNaN();
  });
});

describe('formatDim', () => {
  it('formats round feet', () => {
    expect(formatDim(168)).toBe("14'");
  });
  it('formats feet + inches', () => {
    expect(formatDim(170)).toBe('14\'2"');
  });
  it('formats pure inches when < 1 ft', () => {
    expect(formatDim(7.87)).toBe('7.87"');
  });
  it('returns empty string for NaN / null', () => {
    expect(formatDim(NaN)).toBe('');
    expect(formatDim(null)).toBe('');
  });
});
```

**Step 3.2: Run tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — module `@/core/dimensions` not found.

**Step 3.3: Implement `src/core/dimensions.ts`**

Port verbatim from `index.legacy.html` lines 588–614, adding types:

```ts
export function parseDim(raw: unknown): number {
  if (raw == null) return NaN;
  const s = String(raw).trim().toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"');
  if (!s) return NaN;
  const m1 = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(\d+(?:\.\d+)?)?\s*(?:"|in|inch|inches)?$/);
  if (m1) {
    const ft = parseFloat(m1[1]!);
    const inch = m1[2] ? parseFloat(m1[2]) : 0;
    return ft * 12 + inch;
  }
  const m2 = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?$/);
  if (m2) return parseFloat(m2[1]!);
  return NaN;
}

export function formatDim(inches: number | null | undefined): string {
  if (inches == null || !Number.isFinite(inches)) return '';
  const total = Math.round(inches * 100) / 100;
  const ft = Math.floor(total / 12);
  const inRem = Math.round((total - ft * 12) * 100) / 100;
  if (ft === 0) return `${inRem}"`;
  if (inRem === 0) return `${ft}'`;
  return `${ft}'${inRem}"`;
}
```

Note the `!` non-null assertions on capture groups — `noUncheckedIndexedAccess` makes regex match groups `string | undefined`; the regex guarantees group 1 exists when `m1`/`m2` matches.

**Step 3.4: Run tests to verify they pass**

Run: `pnpm test`
Expected: PASS, 10+ assertions green.

**Step 3.5: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

**Step 3.6: Commit**

```bash
git add src/core/dimensions.ts tests/dimensions.test.ts
git commit -m "refactor: extract dimensions module with tests"
```

---

## Task 4: Core — `grid.ts` (getGrid, isCutCell, cellKey)

**Files:**
- Create: `src/core/grid.ts`
- Create: `tests/grid.test.ts`

**Step 4.1: Write the failing tests**

Create `tests/grid.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getGrid, isCutCell, cellKey, TILE_INCH, TILE_PX } from '@/core/grid';

const exactFit = { widthIn: TILE_INCH * 4, heightIn: TILE_INCH * 3 };
const fracCol = { widthIn: TILE_INCH * 4 + 2, heightIn: TILE_INCH * 3 };
const fracRow = { widthIn: TILE_INCH * 4, heightIn: TILE_INCH * 3 + 2 };
const fracBoth = { widthIn: TILE_INCH * 4 + 2, heightIn: TILE_INCH * 3 + 2 };

describe('getGrid', () => {
  it('returns full grid with no cuts for exact fit', () => {
    const g = getGrid(exactFit);
    expect(g.cols).toBe(4);
    expect(g.rows).toBe(3);
    expect(g.fullCols).toBe(4);
    expect(g.fullRows).toBe(3);
    expect(g.hasColCut).toBe(false);
    expect(g.hasRowCut).toBe(false);
    expect(g.colSizes).toEqual([TILE_PX, TILE_PX, TILE_PX, TILE_PX]);
    expect(g.rowSizes).toEqual([TILE_PX, TILE_PX, TILE_PX]);
  });

  it('adds fractional col when width overhangs', () => {
    const g = getGrid(fracCol);
    expect(g.cols).toBe(5);
    expect(g.fullCols).toBe(4);
    expect(g.hasColCut).toBe(true);
    expect(g.hasRowCut).toBe(false);
    expect(g.colSizes).toHaveLength(5);
    expect(g.colSizes[4]).toBeCloseTo((2 / TILE_INCH) * TILE_PX, 2);
  });

  it('adds fractional row when height overhangs', () => {
    const g = getGrid(fracRow);
    expect(g.rows).toBe(4);
    expect(g.fullRows).toBe(3);
    expect(g.hasRowCut).toBe(true);
    expect(g.hasColCut).toBe(false);
  });

  it('adds both fractional row and col', () => {
    const g = getGrid(fracBoth);
    expect(g.cols).toBe(5);
    expect(g.rows).toBe(4);
    expect(g.hasColCut).toBe(true);
    expect(g.hasRowCut).toBe(true);
  });

  it('treats sub-epsilon remainder as no cut', () => {
    const g = getGrid({ widthIn: TILE_INCH * 4 + 0.001, heightIn: TILE_INCH * 3 });
    expect(g.hasColCut).toBe(false);
    expect(g.cols).toBe(4);
  });
});

describe('isCutCell', () => {
  it('marks last col cut when hasColCut', () => {
    const g = getGrid(fracCol);
    expect(isCutCell(g, 0, 4)).toBe(true);
    expect(isCutCell(g, 0, 3)).toBe(false);
  });
  it('marks last row cut when hasRowCut', () => {
    const g = getGrid(fracRow);
    expect(isCutCell(g, 3, 0)).toBe(true);
    expect(isCutCell(g, 2, 0)).toBe(false);
  });
  it('marks nothing as cut on exact fit', () => {
    const g = getGrid(exactFit);
    for (let r = 0; r < g.rows; r++)
      for (let c = 0; c < g.cols; c++)
        expect(isCutCell(g, r, c)).toBe(false);
  });
});

describe('cellKey', () => {
  it('produces stable string keys', () => {
    expect(cellKey(2, 5)).toBe('2,5');
    expect(cellKey(0, 0)).toBe('0,0');
  });
});
```

**Step 4.2: Run tests, verify fail**

Run: `pnpm test`
Expected: FAIL — module not found.

**Step 4.3: Implement `src/core/grid.ts`**

Port from legacy lines 552–553 (constants) and 616–640 (logic):

```ts
export const TILE_INCH = 7.87;
export const TILE_PX = 18;

export interface SurfaceDims {
  widthIn: number;
  heightIn: number;
}

export interface Grid {
  cols: number;
  rows: number;
  fullCols: number;
  fullRows: number;
  hasColCut: boolean;
  hasRowCut: boolean;
  colSizes: number[];
  rowSizes: number[];
}

export function cellKey(r: number, c: number): string {
  return `${r},${c}`;
}

export function getGrid(s: SurfaceDims): Grid {
  const wTiles = s.widthIn / TILE_INCH;
  const hTiles = s.heightIn / TILE_INCH;
  const fullCols = Math.floor(wTiles + 1e-6);
  const fullRows = Math.floor(hTiles + 1e-6);
  const colRem = +(wTiles - fullCols).toFixed(6);
  const rowRem = +(hTiles - fullRows).toFixed(6);
  const hasColCut = colRem > 0.01;
  const hasRowCut = rowRem > 0.01;
  const cols = fullCols + (hasColCut ? 1 : 0);
  const rows = fullRows + (hasRowCut ? 1 : 0);
  const colSizes: number[] = [];
  for (let i = 0; i < fullCols; i++) colSizes.push(TILE_PX);
  if (hasColCut) colSizes.push(+(colRem * TILE_PX).toFixed(2));
  const rowSizes: number[] = [];
  for (let i = 0; i < fullRows; i++) rowSizes.push(TILE_PX);
  if (hasRowCut) rowSizes.push(+(rowRem * TILE_PX).toFixed(2));
  return { cols, rows, fullCols, fullRows, hasColCut, hasRowCut, colSizes, rowSizes };
}

export function isCutCell(grid: Grid, r: number, c: number): boolean {
  return (grid.hasColCut && c === grid.cols - 1) || (grid.hasRowCut && r === grid.rows - 1);
}
```

**Step 4.4: Run tests, verify pass**

Run: `pnpm test`
Expected: PASS. If any assertion fails, fix the port before moving on — do not change tests to match a buggy port.

**Step 4.5: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

**Step 4.6: Commit**

```bash
git add src/core/grid.ts tests/grid.test.ts
git commit -m "refactor: extract grid module with tests"
```

---

## Task 5: Core — `state.ts` (types, defaults)

**Files:**
- Create: `src/core/state.ts`
- Create: `src/core/palette.ts`

No tests — these are type/constant exports only.

**Step 5.1: Create `src/core/palette.ts`**

```ts
export const DEFAULT_PALETTE: readonly string[] = [
  '#ffffff', '#f5f5f7', '#d2d2d7', '#86868b', '#1d1d1f', '#000000',
  '#b85450', '#3a5a7a',
];
```

**Step 5.2: Create `src/core/state.ts`**

Port the surface defaults from legacy lines 563–575, with types:

```ts
import { DEFAULT_PALETTE } from './palette';

export type Tool = 'paint' | 'eyedrop' | 'erase';
export type ViewMode = '2d' | '3d';
export type SurfaceGroup = 'Floors' | 'Ceiling' | 'Walls';

export interface Surface {
  id: string;
  group: SurfaceGroup;
  name: string;
  widthIn: number;
  heightIn: number;
  note?: string;
  heightLocked?: boolean;
}

export interface Orbit {
  rotX: number;
  rotY: number;
}

export interface State {
  ceilFt: number;
  palette: string[];
  selectedColor: string;
  tool: Tool;
  surfaces: Surface[];
  tiles: Record<string, Map<string, string>>;
  viewMode: ViewMode;
  orbit: Orbit;
}

export function defaultSurfaces(ceilFt: number): Surface[] {
  const ceilIn = ceilFt * 12;
  return [
    { id: 'main',    group: 'Floors',  name: 'Main bath floor', widthIn: 130, heightIn: 78,    note: "plan \u00b7 10'10\" \u00d7 6'6\" (less shower)" },
    { id: 'ensuite', group: 'Floors',  name: 'En suite floor',  widthIn: 96,  heightIn: 69,    note: 'editable default \u00b7 ~46 ft\u00b2' },
    { id: 'shower',  group: 'Floors',  name: 'Shower floor',    widthIn: 40,  heightIn: 78,    note: "plan \u00b7 3'4\" \u00d7 6'6\"" },
    { id: 'ceiling', group: 'Ceiling', name: 'Main ceiling',    widthIn: 170, heightIn: 78,    note: "plan \u00b7 14'2\" \u00d7 6'6\"" },
    { id: 'wallN',   group: 'Walls',   name: 'North wall',      widthIn: 170, heightIn: ceilIn, note: "plan \u00b7 14'2\" \u00b7 vanity wall", heightLocked: true },
    { id: 'wallS',   group: 'Walls',   name: 'South wall',      widthIn: 170, heightIn: ceilIn, note: "plan \u00b7 14'2\" \u00b7 tub/toilet wall", heightLocked: true },
    { id: 'wallE',   group: 'Walls',   name: 'East wall',       widthIn: 78,  heightIn: ceilIn, note: "plan \u00b7 6'6\" \u00b7 door end", heightLocked: true },
    { id: 'wallW',   group: 'Walls',   name: 'West wall',       widthIn: 78,  heightIn: ceilIn, note: "plan \u00b7 6'6\" \u00b7 shower end", heightLocked: true },
  ];
}

export function initialState(): State {
  const ceilFt = 9;
  return {
    ceilFt,
    palette: [...DEFAULT_PALETTE],
    selectedColor: DEFAULT_PALETTE[4]!,
    tool: 'paint',
    surfaces: defaultSurfaces(ceilFt),
    tiles: {},
    viewMode: '2d',
    orbit: { rotX: -18, rotY: -28 },
  };
}

export function initTiles(
  surfaces: Surface[],
  prev?: Record<string, Map<string, string>>,
): Record<string, Map<string, string>> {
  const tiles: Record<string, Map<string, string>> = {};
  for (const s of surfaces) tiles[s.id] = prev?.[s.id] ?? new Map();
  return tiles;
}
```

**Step 5.3: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

**Step 5.4: Commit**

```bash
git add src/core/state.ts src/core/palette.ts
git commit -m "refactor: extract state types, defaults, and palette"
```

---

## Task 6: Core — `stats.ts` (computeSurfaceStats, totals)

**Files:**
- Create: `src/core/stats.ts`
- Create: `tests/stats.test.ts`

**Step 6.1: Write the failing tests**

Create `tests/stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeSurfaceStats, computeTotals } from '@/core/stats';
import { TILE_INCH } from '@/core/grid';

describe('computeSurfaceStats', () => {
  it('exact fit: full count equals total, cut=0', () => {
    const stats = computeSurfaceStats({ widthIn: TILE_INCH * 4, heightIn: TILE_INCH * 3 });
    expect(stats.total).toBe(12);
    expect(stats.full).toBe(12);
    expect(stats.cut).toBe(0);
    expect(stats.areaFt2).toBeCloseTo((TILE_INCH * 4 * TILE_INCH * 3) / 144, 4);
  });

  it('fractional col: adds a cut column', () => {
    const stats = computeSurfaceStats({ widthIn: TILE_INCH * 4 + 2, heightIn: TILE_INCH * 3 });
    expect(stats.full).toBe(12);
    expect(stats.total).toBe(15);
    expect(stats.cut).toBe(3);
  });
});

describe('computeTotals', () => {
  const surface = {
    id: 'x',
    group: 'Floors' as const,
    name: 'x',
    widthIn: TILE_INCH * 4 + 2,
    heightIn: TILE_INCH * 3,
  };

  it('counts painted tiles grouped by color; splits full vs cut', () => {
    const tiles = { x: new Map<string, string>() };
    tiles.x.set('0,0', '#000');
    tiles.x.set('0,1', '#000');
    tiles.x.set('0,4', '#f00');
    const t = computeTotals([surface], tiles);
    expect(t.totalPaintedFull).toBe(2);
    expect(t.totalPaintedCut).toBe(1);
    expect(t.byColor.get('#000')).toBe(2);
    expect(t.byColor.get('#f00')).toBe(1);
    expect(t.byColorCut.get('#f00')).toBe(1);
    expect(t.order).toBe(Math.ceil(3 * 1.1));
  });

  it('ignores stale keys outside the current grid', () => {
    const tiles = { x: new Map<string, string>() };
    tiles.x.set('99,99', '#000');
    const t = computeTotals([surface], tiles);
    expect(t.totalPaintedFull).toBe(0);
    expect(t.totalPaintedCut).toBe(0);
  });
});
```

**Step 6.2: Run tests, verify fail**

Run: `pnpm test`
Expected: FAIL.

**Step 6.3: Implement `src/core/stats.ts`**

Port from legacy lines 758–765 (surface stats) and 889–936 (totals logic):

```ts
import { getGrid, isCutCell, type Grid } from './grid';
import type { Surface } from './state';

export interface SurfaceStats {
  grid: Grid;
  total: number;
  full: number;
  cut: number;
  areaFt2: number;
}

export function computeSurfaceStats(s: Pick<Surface, 'widthIn' | 'heightIn'>): SurfaceStats {
  const grid = getGrid(s);
  const total = grid.cols * grid.rows;
  const full = grid.fullCols * grid.fullRows;
  const cut = total - full;
  const areaFt2 = (s.widthIn * s.heightIn) / 144;
  return { grid, total, full, cut, areaFt2 };
}

export interface Totals {
  byColor: Map<string, number>;
  byColorCut: Map<string, number>;
  totalPaintedFull: number;
  totalPaintedCut: number;
  totalPainted: number;
  order: number;
}

export function computeTotals(
  surfaces: Surface[],
  tiles: Record<string, Map<string, string>>,
): Totals {
  const byColor = new Map<string, number>();
  const byColorCut = new Map<string, number>();
  let totalPaintedFull = 0;
  let totalPaintedCut = 0;
  for (const s of surfaces) {
    const grid = getGrid(s);
    const map = tiles[s.id];
    if (!map) continue;
    for (const [k, color] of map) {
      if (!color) continue;
      const [rStr, cStr] = k.split(',');
      const r = Number(rStr);
      const c = Number(cStr);
      if (r >= grid.rows || c >= grid.cols) continue;
      byColor.set(color, (byColor.get(color) ?? 0) + 1);
      if (isCutCell(grid, r, c)) {
        byColorCut.set(color, (byColorCut.get(color) ?? 0) + 1);
        totalPaintedCut++;
      } else {
        totalPaintedFull++;
      }
    }
  }
  const totalPainted = totalPaintedFull + totalPaintedCut;
  const order = totalPainted ? Math.ceil(totalPainted * 1.1) : 0;
  return { byColor, byColorCut, totalPaintedFull, totalPaintedCut, totalPainted, order };
}
```

**Step 6.4: Run tests, verify pass**

Run: `pnpm test`
Expected: PASS.

**Step 6.5: Commit**

```bash
git add src/core/stats.ts tests/stats.test.ts
git commit -m "refactor: extract stats module with tests"
```

---

## Task 7: Storage — `local.ts`

**Files:**
- Create: `src/storage/local.ts`

No tests — localStorage isn't worth mocking; manual verification in-browser is fine.

**Step 7.1: Create `src/storage/local.ts`**

Port from legacy lines 642–701. The shape matches the legacy `tilePlanner.v2` key exactly for forward compatibility.

```ts
import type { State } from '@/core/state';
import { defaultSurfaces, initTiles } from '@/core/state';

const STORAGE_KEY = 'tilePlanner.v2';

interface SavedShape {
  ceilFt?: number;
  palette?: string[];
  selectedColor?: string;
  surfaces?: Array<{ id: string; widthIn?: number; heightIn?: number }>;
  tiles?: Record<string, Record<string, string>>;
  viewMode?: '2d' | '3d';
  orbit?: { rotX: number; rotY: number };
}

export function loadSaved(): SavedShape | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as SavedShape;
  } catch {
    // ignore
  }
  return null;
}

export function persist(state: State): void {
  try {
    const tilesOut: Record<string, Record<string, string>> = {};
    for (const [k, m] of Object.entries(state.tiles)) {
      tilesOut[k] = Object.fromEntries(m);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      ceilFt: state.ceilFt,
      palette: state.palette,
      selectedColor: state.selectedColor,
      surfaces: state.surfaces.map(s => ({ id: s.id, widthIn: s.widthIn, heightIn: s.heightIn })),
      tiles: tilesOut,
      viewMode: state.viewMode,
      orbit: state.orbit,
    }));
  } catch {
    // ignore
  }
}

export function applySaved(state: State, saved: SavedShape): void {
  if (typeof saved.ceilFt === 'number') state.ceilFt = saved.ceilFt;
  if (Array.isArray(saved.palette) && saved.palette.length) state.palette = saved.palette;
  if (saved.selectedColor) state.selectedColor = saved.selectedColor;
  if (saved.viewMode === '2d' || saved.viewMode === '3d') state.viewMode = saved.viewMode;
  if (saved.orbit && typeof saved.orbit.rotX === 'number' && typeof saved.orbit.rotY === 'number') {
    state.orbit = saved.orbit;
  }
  state.surfaces = defaultSurfaces(state.ceilFt);
  if (Array.isArray(saved.surfaces)) {
    const ov = Object.fromEntries(saved.surfaces.map(s => [s.id, s]));
    state.surfaces = state.surfaces.map(s => {
      const o = ov[s.id];
      if (!o) return s;
      const m = { ...s };
      if (typeof o.widthIn === 'number') m.widthIn = o.widthIn;
      if (typeof o.heightIn === 'number') m.heightIn = o.heightIn;
      return m;
    });
  }
  const prev: Record<string, Map<string, string>> = {};
  if (saved.tiles) {
    for (const [id, obj] of Object.entries(saved.tiles)) prev[id] = new Map(Object.entries(obj));
  }
  state.tiles = initTiles(state.surfaces, prev);
}
```

**Step 7.2: Typecheck**

Run: `pnpm typecheck`
Expected: exits 0.

**Step 7.3: Commit**

```bash
git add src/storage/local.ts
git commit -m "refactor: extract localStorage persistence module"
```

---

## Task 8: UI — bootstrap + static markup

**Files:**
- Create: `src/ui/layout.ts` — builds the aside + main DOM skeleton

Builds the chrome so subsequent UI modules have anchor points.

**Step 8.1: Create `src/ui/layout.ts`**

This emits the same HTML structure as legacy lines 467–546 but as a function that fills `#app`.

```ts
export interface LayoutRefs {
  ceilInput: HTMLInputElement;
  swatchesEl: HTMLElement;
  toolButtons: NodeListOf<HTMLButtonElement>;
  countsEl: HTMLElement;
  totalEl: HTMLElement;
  fullCutTotalEl: HTMLElement;
  orderTotalEl: HTMLElement;
  saveBtn: HTMLButtonElement;
  loadBtn: HTMLButtonElement;
  resetBtn: HTMLButtonElement;
  viewToggleButtons: NodeListOf<HTMLButtonElement>;
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
    toolButtons: root.querySelectorAll<HTMLButtonElement>('.tool-btn'),
    countsEl: q('#counts'),
    totalEl: q('#total'),
    fullCutTotalEl: q('#full-cut-total'),
    orderTotalEl: q('#order-total'),
    saveBtn: q<HTMLButtonElement>('#save'),
    loadBtn: q<HTMLButtonElement>('#load'),
    resetBtn: q<HTMLButtonElement>('#reset'),
    viewToggleButtons: root.querySelectorAll<HTMLButtonElement>('#view-toggle button'),
    canvas2d: q('#canvas'),
    canvas3d: q('#canvas-3d'),
  };
}
```

**Step 8.2: Update `src/main.ts` to mount layout**

```ts
import './styles/base.css';
import './styles/sidebar.css';
import './styles/canvas.css';
import './styles/preview3d.css';

import { mountLayout } from './ui/layout';
import { initialState } from './core/state';
import { loadSaved, applySaved } from './storage/local';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app');
const refs = mountLayout(root);

const state = initialState();
const saved = loadSaved();
if (saved) applySaved(state, saved);
refs.ceilInput.value = String(state.ceilFt);

// UI wiring lands in subsequent tasks.
```

**Step 8.3: Verify in browser**

Start `pnpm dev`, load `/`. You should see the sidebar and main pane rendered with correct styles, an empty canvas, and a working (visually) view-toggle. No tiles, no swatches yet. Stop dev server.

**Step 8.4: Commit**

```bash
git add src/ui/layout.ts src/main.ts
git commit -m "refactor: mount static DOM layout from module"
```

---

## Task 9: UI — swatches + tools

**Files:**
- Create: `src/ui/swatches.ts`
- Create: `src/ui/tools.ts`
- Modify: `src/main.ts`

**Step 9.1: Create `src/ui/swatches.ts`**

Port from legacy lines 713–756.

```ts
import type { State } from '@/core/state';

export interface SwatchHandlers {
  onChange: () => void;
}

export function renderSwatches(root: HTMLElement, state: State, handlers: SwatchHandlers): void {
  root.innerHTML = '';
  for (const color of state.palette) {
    const sw = document.createElement('button');
    sw.className = 'swatch' + (color === state.selectedColor ? ' active' : '');
    sw.style.background = color;
    sw.title = color;
    sw.addEventListener('click', () => {
      state.selectedColor = color;
      renderSwatches(root, state, handlers);
      handlers.onChange();
    });
    const rm = document.createElement('span');
    rm.className = 'remove';
    rm.textContent = '\u00d7';
    rm.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.palette.length <= 1) return;
      state.palette = state.palette.filter(c => c !== color);
      if (state.selectedColor === color) state.selectedColor = state.palette[0]!;
      renderSwatches(root, state, handlers);
      handlers.onChange();
    });
    sw.appendChild(rm);
    root.appendChild(sw);
  }
  const add = document.createElement('button');
  add.className = 'add-color';
  add.textContent = '+';
  add.title = 'Add color';
  add.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'color';
    input.value = '#888888';
    input.addEventListener('change', () => {
      if (!state.palette.includes(input.value)) state.palette.push(input.value);
      state.selectedColor = input.value;
      renderSwatches(root, state, handlers);
      handlers.onChange();
    });
    input.click();
  });
  root.appendChild(add);
}
```

**Step 9.2: Create `src/ui/tools.ts`**

Port from legacy lines 938–942 and 1004–1009.

```ts
import type { State, Tool } from '@/core/state';

export function wireToolButtons(buttons: NodeListOf<HTMLButtonElement>, state: State): void {
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tool = btn.dataset.tool as Tool;
      buttons.forEach(b => b.classList.toggle('active', b === btn));
    });
  });
}

export function effectiveTool(state: State, e: { altKey: boolean; shiftKey: boolean }): Tool {
  if (e.altKey) return 'erase';
  if (e.shiftKey) return 'eyedrop';
  return state.tool;
}
```

**Step 9.3: Update `src/main.ts`**

Append after the existing wiring:

```ts
import { renderSwatches } from './ui/swatches';
import { wireToolButtons } from './ui/tools';
import { persist } from './storage/local';

renderSwatches(refs.swatchesEl, state, { onChange: () => persist(state) });
wireToolButtons(refs.toolButtons, state);
```

**Step 9.4: Verify in browser**

`pnpm dev` → sidebar shows 8 default swatches + add button. Click a swatch — active ring moves. Hover — remove × appears. Click + to add a color. Tool buttons toggle active state. Stop dev server.

**Step 9.5: Commit**

```bash
git add src/ui/swatches.ts src/ui/tools.ts src/main.ts
git commit -m "refactor: extract swatches and tool-button modules"
```

---

## Task 10: UI — surface rendering + paint/erase/eyedrop

**Files:**
- Create: `src/ui/surface.ts`
- Modify: `src/main.ts`

This task ports the biggest chunk of legacy UI: surface DOM construction, dim-input editing, mouse paint/drag/eyedrop/erase, group rendering.

**Step 10.1: Create `src/ui/surface.ts`**

Port from legacy lines 767–1002. The module exports two functions: one to render all surfaces, one to wire canvas-wide paint events. Dependencies receive `state` + render callbacks.

```ts
import { getGrid, isCutCell, cellKey, TILE_PX } from '@/core/grid';
import { computeSurfaceStats } from '@/core/stats';
import { parseDim, formatDim } from '@/core/dimensions';
import type { State, Surface } from '@/core/state';
import { effectiveTool } from './tools';

export interface SurfaceCallbacks {
  onRerenderCounts: () => void;
  onRenderSwatches: () => void;
  persist: () => void;
}

export function renderCanvas(canvas: HTMLElement, state: State, cb: SurfaceCallbacks): void {
  canvas.innerHTML = '';
  const groupOrder = ['Floors', 'Ceiling', 'Walls'] as const;
  const groups = new Map<string, Surface[]>();
  for (const g of groupOrder) groups.set(g, []);
  for (const s of state.surfaces) {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group)!.push(s);
  }
  for (const [gname, gsurf] of groups) {
    if (!gsurf.length) continue;
    const gEl = document.createElement('div');
    gEl.className = 'group';
    const head = document.createElement('div');
    head.className = 'group-head';
    const suffix = gname === 'Walls' ? ` \u00b7 ${state.ceilFt}' ceiling` : '';
    head.innerHTML = `<span class="group-title">${gname}${suffix}</span><span class="group-rule"></span>`;
    gEl.appendChild(head);
    const surfs = document.createElement('div');
    surfs.className = 'surfaces';
    for (const s of gsurf) surfs.appendChild(renderSurface(s, state, canvas, cb));
    gEl.appendChild(surfs);
    canvas.appendChild(gEl);
  }
}

function renderSurface(s: Surface, state: State, canvas: HTMLElement, cb: SurfaceCallbacks): HTMLElement {
  const stats = computeSurfaceStats(s);
  const { grid } = stats;

  const surf = document.createElement('div');
  surf.className = 'surface';
  surf.dataset.surfaceId = s.id;

  const head = document.createElement('div');
  head.className = 'surface-head';

  const nameLine = document.createElement('div');
  nameLine.className = 'surface-name';
  nameLine.textContent = s.name;
  head.appendChild(nameLine);

  const meta = document.createElement('div');
  meta.className = 'surface-meta';
  const countStr = stats.cut
    ? `${stats.full} full + ${stats.cut} cut = ${stats.total}`
    : `${stats.full} tiles`;
  meta.textContent = `${countStr} \u00b7 ${stats.areaFt2.toFixed(1)} ft\u00b2 \u00b7 ${s.note ?? ''}`;
  head.appendChild(meta);

  const dimRow = document.createElement('div');
  dimRow.className = 'dim-row';
  const wLbl = document.createElement('span'); wLbl.textContent = 'W';
  const wIn = document.createElement('input');
  wIn.type = 'text';
  wIn.className = 'dim-input';
  wIn.value = formatDim(s.widthIn);
  wIn.addEventListener('change', () => {
    const v = parseDim(wIn.value);
    if (!Number.isFinite(v) || v <= 0) { wIn.value = formatDim(s.widthIn); return; }
    s.widthIn = v;
    rerenderSurface(s.id, state, canvas, cb);
  });
  const sep = document.createElement('span'); sep.className = 'dim-sep'; sep.textContent = '\u00d7';
  const hLbl = document.createElement('span'); hLbl.textContent = 'H';
  const hIn = document.createElement('input');
  hIn.type = 'text';
  hIn.className = 'dim-input';
  hIn.value = formatDim(s.heightIn);
  if (s.heightLocked) { hIn.disabled = true; hIn.title = 'Linked to ceiling height'; }
  hIn.addEventListener('change', () => {
    const v = parseDim(hIn.value);
    if (!Number.isFinite(v) || v <= 0) { hIn.value = formatDim(s.heightIn); return; }
    s.heightIn = v;
    rerenderSurface(s.id, state, canvas, cb);
  });
  dimRow.append(wLbl, wIn, sep, hLbl, hIn);
  head.appendChild(dimRow);

  surf.appendChild(head);
  surf.appendChild(buildGridElement(s, grid, state));
  return surf;
}

function buildGridElement(s: Surface, grid: ReturnType<typeof getGrid>, state: State): HTMLElement {
  const gridEl = document.createElement('div');
  gridEl.className = 'grid';
  gridEl.dataset.surfaceId = s.id;
  gridEl.style.gridTemplateColumns = grid.colSizes.map(v => v + 'px').join(' ');
  gridEl.style.gridTemplateRows = grid.rowSizes.map(v => v + 'px').join(' ');
  const tilesMap = state.tiles[s.id] ?? new Map<string, string>();
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      const t = document.createElement('div');
      t.className = 'tile';
      if (isCutCell(grid, r, c)) t.classList.add('cut');
      t.dataset.surfaceId = s.id;
      t.dataset.r = String(r);
      t.dataset.c = String(c);
      const color = tilesMap.get(cellKey(r, c));
      if (color) t.style.background = color;
      gridEl.appendChild(t);
    }
  }
  return gridEl;
}

function rerenderSurface(surfaceId: string, state: State, canvas: HTMLElement, cb: SurfaceCallbacks): void {
  const s = state.surfaces.find(x => x.id === surfaceId);
  if (!s) return;
  const existing = canvas.querySelector<HTMLElement>(`.surface[data-surface-id="${surfaceId}"]`);
  const replacement = renderSurface(s, state, canvas, cb);
  if (existing?.parentNode) existing.parentNode.replaceChild(replacement, existing);
  cb.onRerenderCounts();
  cb.persist();
}

interface TileTarget { surfaceId: string; r: number; c: number; }

function tileFromEvent(e: Event): TileTarget | null {
  const target = e.target as HTMLElement | null;
  const el = target?.closest<HTMLElement>('.tile');
  if (!el) return null;
  return {
    surfaceId: el.dataset.surfaceId!,
    r: Number(el.dataset.r),
    c: Number(el.dataset.c),
  };
}

function setTile(state: State, canvas: HTMLElement, surfaceId: string, r: number, c: number, color: string | null): void {
  const map = state.tiles[surfaceId] ?? (state.tiles[surfaceId] = new Map());
  if (color == null) map.delete(cellKey(r, c));
  else map.set(cellKey(r, c), color);
  const el = canvas.querySelector<HTMLElement>(
    `.tile[data-surface-id="${surfaceId}"][data-r="${r}"][data-c="${c}"]`,
  );
  if (el) el.style.background = color ?? '';
}

function apply(state: State, canvas: HTMLElement, target: TileTarget | null, e: MouseEvent, cb: SurfaceCallbacks): void {
  if (!target) return;
  const tool = effectiveTool(state, e);
  if (tool === 'paint') setTile(state, canvas, target.surfaceId, target.r, target.c, state.selectedColor);
  else if (tool === 'erase') setTile(state, canvas, target.surfaceId, target.r, target.c, null);
  else {
    const map = state.tiles[target.surfaceId];
    const c = map?.get(cellKey(target.r, target.c));
    if (c) {
      state.selectedColor = c;
      if (!state.palette.includes(c)) state.palette.push(c);
      cb.onRenderSwatches();
    }
  }
}

export function wireCanvasPainting(canvas: HTMLElement, state: State, cb: SurfaceCallbacks): void {
  let painting = false;
  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input')) return;
    e.preventDefault();
    const t = tileFromEvent(e);
    if (!t) return;
    painting = true;
    apply(state, canvas, t, e, cb);
    cb.onRerenderCounts();
  });
  canvas.addEventListener('mouseover', (e) => {
    if (!painting) return;
    const t = tileFromEvent(e);
    if (!t) return;
    apply(state, canvas, t, e, cb);
  });
  window.addEventListener('mouseup', () => {
    if (painting) {
      painting = false;
      cb.onRerenderCounts();
      cb.persist();
    }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}
```

Note: the `TILE_PX` import isn't used directly but the module depends on `grid.colSizes`/`grid.rowSizes` which already embed it.

**Step 10.2: Create `src/ui/counts.ts`**

Port from legacy lines 889–936.

```ts
import { computeTotals } from '@/core/stats';
import type { State } from '@/core/state';

export interface CountsRefs {
  countsEl: HTMLElement;
  totalEl: HTMLElement;
  fullCutTotalEl: HTMLElement;
  orderTotalEl: HTMLElement;
}

export function renderCounts(refs: CountsRefs, state: State): void {
  const totals = computeTotals(state.surfaces, state.tiles);
  refs.countsEl.innerHTML = '';
  if (totals.byColor.size === 0) {
    const d = document.createElement('div');
    d.className = 'count-empty';
    d.textContent = 'No tiles painted yet.';
    refs.countsEl.appendChild(d);
  } else {
    const sorted = [...totals.byColor.entries()].sort((a, b) => b[1] - a[1]);
    for (const [color, n] of sorted) {
      const cutN = totals.byColorCut.get(color) ?? 0;
      const fullN = n - cutN;
      const row = document.createElement('div');
      row.className = 'count-row';
      row.innerHTML = `
        <span class="count-chip" style="background:${color}"></span>
        <span class="count-label">${color}${cutN ? ` <span style="opacity:.6">(${fullN}+${cutN}c)</span>` : ''}</span>
        <span class="count-num">${n.toLocaleString()}</span>
      `;
      refs.countsEl.appendChild(row);
    }
  }
  refs.totalEl.textContent = totals.totalPainted.toLocaleString();
  refs.fullCutTotalEl.textContent = `${totals.totalPaintedFull.toLocaleString()} \u00b7 ${totals.totalPaintedCut.toLocaleString()}`;
  refs.orderTotalEl.textContent = totals.totalPainted ? totals.order.toLocaleString() : '\u2014';
}
```

**Step 10.3: Wire everything in `src/main.ts`**

Replace the contents of `src/main.ts` (keep CSS imports at top):

```ts
import './styles/base.css';
import './styles/sidebar.css';
import './styles/canvas.css';
import './styles/preview3d.css';

import { mountLayout } from './ui/layout';
import { initialState, defaultSurfaces, initTiles } from './core/state';
import { loadSaved, persist, applySaved } from './storage/local';
import { renderSwatches } from './ui/swatches';
import { wireToolButtons } from './ui/tools';
import { renderCanvas, wireCanvasPainting } from './ui/surface';
import { renderCounts } from './ui/counts';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app');
const refs = mountLayout(root);

const state = initialState();
const saved = loadSaved();
if (saved) applySaved(state, saved);
refs.ceilInput.value = String(state.ceilFt);

const countsRefs = {
  countsEl: refs.countsEl,
  totalEl: refs.totalEl,
  fullCutTotalEl: refs.fullCutTotalEl,
  orderTotalEl: refs.orderTotalEl,
};

const doRenderSwatches = () => renderSwatches(refs.swatchesEl, state, { onChange: () => persist(state) });
const doRenderCounts = () => renderCounts(countsRefs, state);
const doPersist = () => persist(state);

const surfaceCb = {
  onRerenderCounts: doRenderCounts,
  onRenderSwatches: doRenderSwatches,
  persist: doPersist,
};

doRenderSwatches();
wireToolButtons(refs.toolButtons, state);
renderCanvas(refs.canvas2d, state, surfaceCb);
wireCanvasPainting(refs.canvas2d, state, surfaceCb);
doRenderCounts();

refs.ceilInput.addEventListener('change', () => {
  const v = parseFloat(refs.ceilInput.value);
  if (!Number.isFinite(v) || v < 4 || v > 20) { refs.ceilInput.value = String(state.ceilFt); return; }
  state.ceilFt = v;
  const ceilIn = v * 12;
  for (const s of state.surfaces) if (s.heightLocked) s.heightIn = ceilIn;
  renderCanvas(refs.canvas2d, state, surfaceCb);
  doRenderCounts();
  persist(state);
});

refs.saveBtn.addEventListener('click', () => {
  const tilesOut: Record<string, Record<string, string>> = {};
  for (const [k, m] of Object.entries(state.tiles)) tilesOut[k] = Object.fromEntries(m);
  const data = {
    version: 2,
    ceilFt: state.ceilFt,
    palette: state.palette,
    selectedColor: state.selectedColor,
    surfaces: state.surfaces.map(s => ({ id: s.id, widthIn: s.widthIn, heightIn: s.heightIn })),
    tiles: tilesOut,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'bathroom-tiles.json';
  a.click();
  URL.revokeObjectURL(a.href);
});

refs.loadBtn.addEventListener('click', () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json';
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(String(r.result));
        applySaved(state, d);
        refs.ceilInput.value = String(state.ceilFt);
        doRenderSwatches();
        renderCanvas(refs.canvas2d, state, surfaceCb);
        doRenderCounts();
        persist(state);
      } catch (err) {
        alert('Could not load: ' + (err as Error).message);
      }
    };
    r.readAsText(f);
  });
  input.click();
});

refs.resetBtn.addEventListener('click', () => {
  if (!confirm('Clear every painted tile?')) return;
  state.tiles = initTiles(state.surfaces);
  renderCanvas(refs.canvas2d, state, surfaceCb);
  doRenderCounts();
  persist(state);
});
```

**Step 10.4: Manual verification in browser**

Start `pnpm dev`. Exercise every 2D behavior:

1. Palette: click swatches to select, × to remove, + to add custom color.
2. Tools: switch paint/eyedrop/erase; hold shift while painting (eyedrop); hold option/alt (erase).
3. Drag paint across multiple tiles.
4. Edit a surface's W or H dimension — grid resizes, cut cells re-mark.
5. Change ceiling height — all `heightLocked` walls update.
6. Reset — confirm dialog, tiles clear.
7. Save → downloads `bathroom-tiles.json`. Modify the file slightly (or clear tiles), Load → restores.
8. Refresh the page — tiles, palette, ceiling, selected color all persist.
9. Compare side-by-side with `/index.legacy.html` — should match pixel for pixel in 2D mode.

Stop dev server once satisfied.

**Step 10.5: Typecheck + tests**

Run: `pnpm typecheck && pnpm test`
Expected: both exit 0.

**Step 10.6: Commit**

```bash
git add src/ui/surface.ts src/ui/counts.ts src/main.ts
git commit -m "refactor: port 2D canvas, painting, counts, and IO"
```

---

## Task 11: 3D preview

**Files:**
- Create: `src/preview3d/preview.ts`
- Modify: `src/main.ts`

**Step 11.1: Create `src/preview3d/preview.ts`**

Port from legacy lines 1093–1252.

```ts
import { getGrid, cellKey, TILE_PX } from '@/core/grid';
import type { State, Surface } from '@/core/state';

const PX_PER_INCH_3D = 3;
const TILE_INCH_LOCAL = 7.87;
const TILE_PX_3D = TILE_INCH_LOCAL * PX_PER_INCH_3D;

export function render3D(container: HTMLElement, state: State, onChange: () => void): void {
  container.innerHTML = '';

  const getSurface = (id: string): Surface | undefined =>
    state.surfaces.find(s => s.id === id);

  const main = getSurface('main')!;
  const shower = getSurface('shower')!;
  const ceiling = getSurface('ceiling')!;
  const wallN = getSurface('wallN')!;
  const wallS = getSurface('wallS')!;
  const wallE = getSurface('wallE')!;
  const wallW = getSurface('wallW')!;

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
      for (let c = 0; c < g.cols; c++) {
        const t = document.createElement('div');
        t.className = 'tile-3d';
        const color = tilesMap.get(cellKey(r, c));
        if (color) t.style.background = color;
        grid.appendChild(t);
      }
    }
    face.appendChild(grid);
    return face;
  };

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
  });
  window.addEventListener('mouseup', () => {
    if (dragging) { dragging = false; onChange(); }
  });

  container.appendChild(scene);
}
```

**Step 11.2: Wire view toggle in `src/main.ts`**

Append at end of `main.ts`:

```ts
import { render3D } from './preview3d/preview';

function setViewMode(mode: '2d' | '3d'): void {
  state.viewMode = mode;
  refs.viewToggleButtons.forEach(b => b.classList.toggle('active', b.dataset.view === mode));
  if (mode === '3d') {
    refs.canvas2d.hidden = true;
    refs.canvas3d.hidden = false;
    render3D(refs.canvas3d, state, () => persist(state));
  } else {
    refs.canvas3d.hidden = true;
    refs.canvas2d.hidden = false;
  }
  persist(state);
}

refs.viewToggleButtons.forEach((b) => {
  b.addEventListener('click', () => setViewMode(b.dataset.view as '2d' | '3d'));
});

setViewMode(state.viewMode);
```

Also extend the ceiling-height handler to re-render 3D when visible. Find the existing handler:

```ts
refs.ceilInput.addEventListener('change', () => {
```

Add inside its body, right before `persist(state);`:

```ts
if (state.viewMode === '3d') render3D(refs.canvas3d, state, () => persist(state));
```

**Step 11.3: Manual verification**

`pnpm dev`. Click "3D preview" toggle → room renders as a 3D box. Drag to orbit. Reset view button works. Switch back to 2D. Refresh page while in 3D mode → restores to 3D. Paint a few tiles in 2D, switch to 3D → they show on the walls/floor/ceiling.

**Step 11.4: Commit**

```bash
git add src/preview3d/preview.ts src/main.ts
git commit -m "refactor: extract 3D preview module"
```

---

## Task 12: Finalize

**Files:**
- Delete: `index.legacy.html`

**Step 12.1: Parity walkthrough one last time**

Start `pnpm dev`, and with `/` and `/index.legacy.html` open in two browser tabs, run the full manual checklist from Task 10.4 and Task 11.3 side-by-side. Any divergence is a bug — fix it before deleting.

**Step 12.2: Run full verification suite**

```bash
pnpm test
pnpm typecheck
pnpm build
```

Each must exit 0. `pnpm build` should produce `dist/index.html` + bundled CSS/JS. Open `dist/index.html` via `pnpm preview` and do a quick smoke test.

**Step 12.3: Delete the legacy file**

```bash
git rm index.legacy.html
```

**Step 12.4: Final commit**

```bash
git commit -m "refactor: remove legacy single-file app"
```

**Step 12.5: Verify working tree is clean**

Run: `git status`
Expected: `nothing to commit, working tree clean`.

Run: `git log --oneline main..HEAD`
Expected: ~12 commits, each a focused refactor step.

---

## Final acceptance criteria

- [ ] `src/` tree matches design doc layout.
- [ ] `index.html` is a minimal shell (no inline CSS/JS).
- [ ] `pnpm test` — all green (dimensions, grid, stats suites).
- [ ] `pnpm typecheck` — zero errors with `strict: true` + `noUncheckedIndexedAccess: true`.
- [ ] `pnpm build` — succeeds.
- [ ] Manual parity check (Tasks 10.4 + 11.3) — every interaction matches the legacy app's behavior.
- [ ] `package.json` has zero runtime deps; only `vite`, `typescript`, `vitest` in `devDependencies`.
- [ ] localStorage key `tilePlanner.v2` still readable by a pre-refactor browser snapshot.
- [ ] No `index.legacy.html` in the tree.
