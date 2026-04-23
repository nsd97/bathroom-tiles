# Repo cleanup — design

**Date:** 2026-04-23
**Branch:** `nsd97/repo-cleanup`
**Scope:** Reorganize the single-file tile planner into a modular Vite + TypeScript project. No behavior changes.

## Motivation

Today the app is 1261 lines of HTML/CSS/JS in a single `index.html`. The grid math (fractional cuts, dimension parsing, tile counting) is tangled with DOM creation and 3D rendering. Hard to read, impossible to unit-test, and doesn't scale to further features.

## Decisions

| Decision | Choice | Alternatives rejected |
|---|---|---|
| Tooling | Vite + TypeScript, vanilla DOM | (a) pure static ESM, no build — loses TS + HMR; (b) full framework — overkill |
| Module split | By layer (pure core / storage / ui / preview3d) | (a) by feature — worse testability; (b) flat — messy beyond ~10 files |
| Testing | Vitest on pure core only | No tests — measurement math has too many edge cases |
| CSS | Split by concern matching modules, imported from TS | (a) single file — doesn't match layout; (b) CSS Modules — ceremony without payoff for single design system |
| TS strictness | `strict: true`, `noUncheckedIndexedAccess: true` | loose — defeats the point of adding TS |
| Package manager | pnpm | npm/yarn fine; pnpm for speed + lockfile cleanliness |

## Directory layout

```
managua/
├── index.html              # shell: <div id="app"> + module script
├── package.json
├── tsconfig.json
├── vite.config.ts
├── public/
├── src/
│   ├── main.ts             # bootstrap: wire core → ui, mount
│   ├── core/               # pure, no DOM, no globals
│   │   ├── dimensions.ts   # parseDim, formatDim
│   │   ├── grid.ts         # getGrid, isCutCell, cellKey
│   │   ├── palette.ts      # default palette, color ops
│   │   ├── state.ts        # State/Surface/PaletteEntry/Tool types + reducers
│   │   └── stats.ts        # computeSurfaceStats, totals, +10% waste math
│   ├── storage/
│   │   └── local.ts        # loadSaved, persist (localStorage v2)
│   ├── ui/
│   │   ├── sidebar.ts      # aside: ceiling, palette, tools, counts, file
│   │   ├── swatches.ts
│   │   ├── surface.ts      # 2D surface DOM + pointer handlers
│   │   ├── tools.ts        # paint/eyedrop/erase state
│   │   └── counts.ts
│   ├── preview3d/
│   │   └── preview.ts
│   └── styles/
│       ├── base.css        # tokens, reset, typography
│       ├── sidebar.css
│       ├── canvas.css
│       └── preview3d.css
└── tests/
    ├── dimensions.test.ts
    ├── grid.test.ts
    └── stats.test.ts
```

**Dependency rule (no cycles):**
- `core/` imports nothing internal.
- `storage/` imports `core/`.
- `ui/` and `preview3d/` import `core/` + `storage/`.
- `main.ts` imports everything and wires it.

## Data flow

Single source of truth: a `state` object owned by `main.ts`. One-way flow:

```
user action → ui/* dispatch → main.ts reducer(state, action) → state →
  render(state) across ui/* modules → storage/local.persist (debounced ~200ms)
```

- Core modules are pure: take state/inputs, return new state or derived values.
- UI modules are thin views + event emitters — no state ownership, no math.
- Paint/drag (high frequency): `surface.ts` applies cell updates directly to its own DOM for responsiveness, then dispatches the committed change on pointer-up. Everything else goes through the reducer.
- Persistence: debounced writes on state change; one read at boot.

## Types

`core/state.ts` is the canonical type home:

- `State` — top-level app state
- `Surface` — one paintable surface (id, name, dims, tiles)
- `PaletteEntry` — color + label
- `Tool` — `'paint' | 'eyedrop' | 'erase'`

All other modules import types from here.

## Tooling

**`package.json` scripts**

- `dev` — `vite`
- `build` — `vite build`
- `preview` — `vite preview`
- `test` — `vitest run`
- `test:watch` — `vitest`
- `typecheck` — `tsc --noEmit`

**Dependencies:** `vite`, `typescript`, `vitest` as devDeps. Zero runtime deps.

**`tsconfig.json`:** `strict: true`, `noUncheckedIndexedAccess: true`, `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`. Path alias `@/*` → `src/*`.

## Tests

Vitest, pure-core only (no DOM tests):

- `dimensions.test.ts` — `parseDim` on `14'2"`, `170"`, `14.2ft`, malformed input; `formatDim` round-trip.
- `grid.test.ts` — exact-fit dims (no cut), fractional col, fractional row, both; sub-epsilon tolerance.
- `stats.test.ts` — total/full/cut counts; +10% waste order math.

## Migration plan

Each step leaves the app working.

1. Scaffold Vite+TS at repo root. Keep old `index.html` as `index.legacy.html` for reference.
2. Lift CSS into `src/styles/*.css` split by concern. Import from `main.ts`. Verify visual parity.
3. Extract pure core — `parseDim`, `formatDim`, `getGrid`, `isCutCell`, `cellKey`, `computeSurfaceStats`, `defaultSurfaces`, `DEFAULT_PALETTE` — into `src/core/*.ts` with types. Write Vitest suites. App still runs from legacy JS.
4. Extract storage into `src/storage/local.ts`. Wire it into the legacy IIFE.
5. Rewrite UI in modules — `sidebar.ts`, `swatches.ts`, `surface.ts`, `tools.ts`, `counts.ts`. Replace legacy DOM code section by section; delete legacy JS when the last module lands.
6. Extract 3D preview into `src/preview3d/preview.ts`.
7. Delete `index.legacy.html`; finalize `index.html` as the shell.
8. Verify: `pnpm dev` and exercise paint/eyedrop/erase, save/load/reset, ceiling change, 2D↔3D toggle, dimension edits. `pnpm test` green. `pnpm typecheck` green. `pnpm build` succeeds.

## Out of scope

- New features or UX changes
- ESLint/Prettier, CI, deploy config
- Accessibility audit, i18n
- Switching storage backends
- Refactoring the 3D preview internals (just extracted as-is)

## Success criteria

- Single file → modular tree matching the layout above.
- `pnpm test`, `pnpm typecheck`, `pnpm build` all pass.
- Manual parity check: every interaction from the legacy app behaves identically.
- No runtime dependencies added.
