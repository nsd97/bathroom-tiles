# Tile Library + Supabase + Versions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace localStorage persistence with Supabase (magic-link auth + realtime sync for three allowlisted users), introduce a global tile library (square/hex shapes), and add named-snapshot versions of the room.

**Architecture:** One in-memory `State` model, mutated by a Supabase-backed storage layer that both writes and subscribes. UI dumb-renders `State`. Realtime `postgres_changes` echoes changes from other clients. One tile per surface determines that surface's grid geometry (square → rect, hex → SVG).

**Tech Stack:** Vite + TypeScript (existing), `@supabase/supabase-js` (new), Vitest (existing), Supabase CLI for migrations/project mgmt.

**Design doc:** `docs/plans/2026-04-23-tile-library-and-supabase-design.md` — read it for context on *why* decisions were made.

**Critical rule — use context7 heavily.** Before writing any code that calls Supabase SDK APIs (auth, realtime, RLS test patterns), query context7 via `mcp__context7__resolve-library-id` + `mcp__context7__query-docs` for `@supabase/supabase-js`. Do not write SDK calls from memory. User explicit requirement.

**Test discipline:** @superpowers:test-driven-development — write the failing test first, confirm it fails, implement minimum code, confirm it passes, commit. @superpowers:verification-before-completion — run tests and typecheck before claiming any task done.

**Commit cadence:** commit after each task (not each step). Branch: `nsd97/tile-library` (current).

---

## Phase 0 — Supabase project bootstrap (user-gated)

### Task 0.1: Pre-flight check — Supabase CLI login

**Files:** none (environmental setup)

**Step 1:** Confirm CLI works.

Run: `supabase --version`
Expected: `2.72.7` or newer.

**Step 2:** Check for PAT.

Run: `echo "token: ${SUPABASE_ACCESS_TOKEN:+set}${SUPABASE_ACCESS_TOKEN:-unset}"`
Expected: if `unset`, halt this task and ask the user to either run `supabase login` (interactive, opens browser) or export `SUPABASE_ACCESS_TOKEN` (a PAT from https://supabase.com/dashboard/account/tokens). **Do not proceed until set.**

**Step 3:** Confirm org membership.

Run: `supabase orgs list`
Expected: at least one org listed. Note the org ID for the next task.

**No commit.** This task is environment-only.

---

### Task 0.2: Create the Supabase project

**Files:** none

**Step 1:** Ask the user to confirm:
- Project name (suggest `bathroom-tiles`)
- Org ID (from Task 0.1)
- Region (suggest `us-east-1` unless user objects)
- DB password (user picks — save this; you'll need it for CLI link later)

**Step 2:** Create.

Run: `supabase projects create "bathroom-tiles" --org-id <ORG_ID> --region <REGION> --db-password <PASSWORD>`
Expected: prints a project ref (20-char ID) and dashboard URL.

**Step 3:** Save the project ref and anon key.

Run: `supabase projects api-keys --project-ref <REF>`
Expected: prints `anon` and `service_role` keys. Keep `anon` for `.env.local`; never put `service_role` in the frontend.

**Step 4:** Link the local repo.

Run: `cd /Users/noahdeskin/conductor/workspaces/bathroom-tiles/lusaka && supabase link --project-ref <REF>`
Expected: prompts for DB password; links repo to project; creates `supabase/config.toml`.

**Step 5:** Commit the linkage file.

```bash
git add supabase/config.toml .gitignore
git commit -m "chore: link repo to Supabase project"
```

Also ensure `.gitignore` excludes `.env.local` and `supabase/.temp/` — add them if not present.

---

### Task 0.3: Populate `.env.local` and install the SDK

**Files:**
- Create: `.env.local` (gitignored — DO NOT commit)
- Modify: `.gitignore` (add `.env.local`, `supabase/.temp/`)
- Modify: `package.json` (add `@supabase/supabase-js` to `dependencies`)
- Modify: `src/vite-env.d.ts` (create if absent — declare env vars)

**Step 1:** Update `.gitignore`:

```
.env.local
.env.*.local
supabase/.temp/
```

**Step 2:** Create `.env.local`:

```
VITE_SUPABASE_URL=https://<REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<ANON_KEY>
```

**Step 3:** Install SDK.

Run: `pnpm add @supabase/supabase-js`
Expected: resolves and writes to `package.json` dependencies.

**Step 4:** Create `src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

**Step 5:** Typecheck still passes.

Run: `pnpm typecheck`
Expected: no errors.

**Commit:**
```bash
git add .gitignore package.json pnpm-lock.yaml src/vite-env.d.ts
git commit -m "chore: add supabase-js dependency and env typing"
```

---

### Task 0.4: Disable new-user signups

**Files:** none (dashboard setting)

**Step 1:** Ask user to open https://supabase.com/dashboard/project/<REF>/auth/providers, select Email, turn OFF "Allow new users to sign up." Leave "Confirm email" OFF (magic link is already the confirmation).

**Step 2:** Confirm with user before proceeding. No commit.

---

## Phase 1 — Schema + seed migration

### Task 1.1: Create the init migration (schema + RLS)

**Files:**
- Create: `supabase/migrations/0001_init.sql`

**Step 1:** Before writing: use context7 to verify Supabase RLS syntax and `auth.jwt()` access pattern.

Run:
```
mcp__context7__resolve-library-id  { libraryName: "supabase" }
mcp__context7__query-docs  { query: "postgres RLS policy using auth.jwt email allowlist", libraryId: <from above> }
```

**Step 2:** Write `supabase/migrations/0001_init.sql`:

```sql
-- tiles: the global tile library
create table public.tiles (
  id uuid primary key default gen_random_uuid(),
  shape text not null check (shape in ('square','hex-pointy','hex-flat')),
  size_in numeric not null check (size_in > 0),
  label text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- surfaces: the bathroom's surfaces (pre-seeded)
create table public.surfaces (
  id text primary key,
  "group" text not null check ("group" in ('Floors','Ceiling','Walls')),
  name text not null,
  width_in numeric not null,
  height_in numeric not null,
  note text,
  height_locked boolean not null default false,
  tile_id uuid not null references public.tiles(id) on delete restrict,
  updated_at timestamptz not null default now()
);

-- painted_cells: one row per painted cell
create table public.painted_cells (
  surface_id text not null references public.surfaces(id) on delete cascade,
  cell_key text not null,
  color text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (surface_id, cell_key)
);

-- project_settings: singleton
create table public.project_settings (
  id int primary key default 1 check (id = 1),
  ceil_ft numeric not null default 9,
  palette text[] not null default array['#ffffff','#f5f5f7','#d2d2d7','#86868b','#1d1d1f','#000000','#b85450','#3a5a7a'],
  selected_color text not null default '#b85450'
);

-- versions: named snapshots of working state
create table public.versions (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  surfaces_snapshot jsonb not null,
  painted_cells_snapshot jsonb not null,
  settings_snapshot jsonb not null
);

-- RLS: allowlist of three emails, same rule across all tables
alter table public.tiles enable row level security;
alter table public.surfaces enable row level security;
alter table public.painted_cells enable row level security;
alter table public.project_settings enable row level security;
alter table public.versions enable row level security;

create policy "allowlist_read_tiles" on public.tiles for select
  using (auth.jwt() ->> 'email' in ('deskinnoah@gmail.com','brenda@deskin.ca','mackenzieagretto1@gmail.com'));
create policy "allowlist_write_tiles" on public.tiles for all
  using (auth.jwt() ->> 'email' in ('deskinnoah@gmail.com','brenda@deskin.ca','mackenzieagretto1@gmail.com'))
  with check (auth.jwt() ->> 'email' in ('deskinnoah@gmail.com','brenda@deskin.ca','mackenzieagretto1@gmail.com'));

-- repeat for surfaces, painted_cells, project_settings, versions
-- (write out all 10 policies in full — DRY helper not needed at 5 tables)
```

**Step 3:** Fill in the remaining 8 policies for `surfaces`, `painted_cells`, `project_settings`, `versions` — same shape.

**Step 4:** Enable realtime on data tables.

Append to the migration:
```sql
-- realtime publication
alter publication supabase_realtime add table public.tiles;
alter publication supabase_realtime add table public.surfaces;
alter publication supabase_realtime add table public.painted_cells;
alter publication supabase_realtime add table public.project_settings;
alter publication supabase_realtime add table public.versions;
```

**Step 5:** Commit the migration file (do NOT push to DB yet).
```bash
git add supabase/migrations/0001_init.sql
git commit -m "feat(db): init schema with RLS + realtime publication"
```

---

### Task 1.2: Create the seed migration

**Files:**
- Create: `supabase/migrations/0002_seed.sql`

**Step 1:** Write:

```sql
-- seed default tile (uuid stable across envs so surfaces can reference it deterministically)
insert into public.tiles (id, shape, size_in, label)
values ('00000000-0000-0000-0000-000000000001', 'square', 7.87, 'Default 7.87" Square')
on conflict (id) do nothing;

-- seed 8 surfaces, all using the default tile, matching defaultSurfaces(9) in state.ts
insert into public.surfaces (id, "group", name, width_in, height_in, note, height_locked, tile_id) values
  ('main',    'Floors',  'Main bath floor', 130, 78,  'plan · 10''10" × 6''6" (less shower)', false, '00000000-0000-0000-0000-000000000001'),
  ('ensuite', 'Floors',  'En suite floor',   96, 69,  'editable default · ~46 ft²',          false, '00000000-0000-0000-0000-000000000001'),
  ('shower',  'Floors',  'Shower floor',     40, 78,  'plan · 3''4" × 6''6"',                 false, '00000000-0000-0000-0000-000000000001'),
  ('ceiling', 'Ceiling', 'Main ceiling',    170, 78,  'plan · 14''2" × 6''6"',                false, '00000000-0000-0000-0000-000000000001'),
  ('wallN',   'Walls',   'North wall',      170, 108, 'plan · 14''2" · vanity wall',          true,  '00000000-0000-0000-0000-000000000001'),
  ('wallS',   'Walls',   'South wall',      170, 108, 'plan · 14''2" · tub/toilet wall',      true,  '00000000-0000-0000-0000-000000000001'),
  ('wallE',   'Walls',   'East wall',        78, 108, 'plan · 6''6" · door end',              true,  '00000000-0000-0000-0000-000000000001'),
  ('wallW',   'Walls',   'West wall',        78, 108, 'plan · 6''6" · shower end',            true,  '00000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- seed settings singleton
insert into public.project_settings (id) values (1) on conflict (id) do nothing;
```

Note: ceiling walls = `9 * 12 = 108` inches.

**Commit:**
```bash
git add supabase/migrations/0002_seed.sql
git commit -m "feat(db): seed default tile, surfaces, settings"
```

---

### Task 1.3: Push migrations to the remote DB

**Files:** none

**Step 1:** Push.

Run: `supabase db push`
Expected: applies `0001_init.sql` and `0002_seed.sql` to the remote project. Prompts before applying.

**Step 2:** Verify via MCP.

Run: `mcp__supabase__list_tables` with schema `public`
Expected: lists `tiles`, `surfaces`, `painted_cells`, `project_settings`, `versions`.

**Step 3:** Verify seed.

Run: `mcp__supabase__execute_sql` with `select count(*) from surfaces`
Expected: `8`.

Run: `mcp__supabase__execute_sql` with `select count(*) from tiles`
Expected: `1`.

No commit (migrations already committed; this is application).

---

## Phase 2 — Auth + storage foundation

### Task 2.1: Create the Supabase client singleton

**Files:**
- Create: `src/auth/client.ts`

**Step 1:** Query context7 for current `createClient` signature and `persistSession` / `detectSessionInUrl` options for email OTP.

Run:
```
mcp__context7__query-docs { query: "supabase-js createClient options persistSession auth flow magic link" }
```

**Step 2:** Write `src/auth/client.ts`:

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anon) throw new Error('missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');

export const supabase: SupabaseClient = createClient(url, anon, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  realtime: { params: { eventsPerSecond: 20 } },
});
```

**Step 3:** Typecheck.

Run: `pnpm typecheck`
Expected: no errors.

**Commit:**
```bash
git add src/auth/client.ts
git commit -m "feat(auth): add Supabase client singleton"
```

---

### Task 2.2: Auth gate state machine — write failing tests

**Files:**
- Create: `tests/auth/gate.test.ts`

**Step 1:** Read @superpowers:test-driven-development for discipline.

**Step 2:** Write `tests/auth/gate.test.ts`:

```ts
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
```

**Step 3:** Run tests.

Run: `pnpm test tests/auth/gate.test.ts`
Expected: FAIL with cannot-resolve `@/auth/gate`.

**No commit yet.**

---

### Task 2.3: Auth gate state machine — implement

**Files:**
- Create: `src/auth/gate.ts`

**Step 1:** Write:

```ts
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
```

**Step 2:** Run tests.

Run: `pnpm test tests/auth/gate.test.ts`
Expected: all 4 pass.

**Step 3:** Typecheck.

Run: `pnpm typecheck`
Expected: no errors.

**Commit:**
```bash
git add src/auth/gate.ts tests/auth/gate.test.ts
git commit -m "feat(auth): add email allowlist gate state machine"
```

---

### Task 2.4: Login screen (email OTP flow)

**Files:**
- Create: `src/auth/login.ts`
- Create: `src/styles/auth.css`
- Modify: `src/main.ts` to import `auth.css`

**Step 1:** Query context7:

```
mcp__context7__query-docs { query: "supabase-js signInWithOtp email magic link verifyOtp" }
```

Note whether the flow is (a) magic-link-only (click link in email), (b) 6-digit OTP code (enter on screen), or (c) both. **Default to (a) magic-link.** If user wants 6-digit code UX, they'll say so; otherwise magic-link is the minimal path.

**Step 2:** Write `src/auth/login.ts`. Shape:

```ts
import { supabase } from './client';

export function mountLogin(root: HTMLElement, opts: { onSent: () => void }): void {
  root.innerHTML = ''; // replaces entire app body
  // build minimal centered form: one email input, one "Send magic link" button,
  // status line below for errors / "check your email" confirmation.
  // On submit: call supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })
  // On success: flip to "Check <email>. Click the link to sign in."
  // On failure: show error inline.
}
```

Full implementation left to the engineer; the shape is constrained by the `mountLogin` signature and the confirmed `signInWithOtp` API from context7.

**Step 3:** Write `src/styles/auth.css`:

- Full-viewport centered card.
- Single email input, single primary button.
- No logo, no subheading clutter. Label: "Sign in to the tile planner." Input placeholder: "your email".
- Use existing color variables from `base.css` where possible for consistency.

**Step 4:** Wire in `src/main.ts`: `import './styles/auth.css';` near the other CSS imports.

**Step 5:** Typecheck.

Run: `pnpm typecheck`
Expected: no errors.

**Commit:**
```bash
git add src/auth/login.ts src/styles/auth.css src/main.ts
git commit -m "feat(auth): add email OTP login screen"
```

---

### Task 2.5: Wire auth gate into boot

**Files:**
- Modify: `src/main.ts` (restructure boot)

**Step 1:** Query context7 for `supabase.auth.onAuthStateChange` and `supabase.auth.getSession` patterns.

**Step 2:** Restructure `src/main.ts`. High-level shape:

```ts
import { supabase } from './auth/client';
import { gateStateFor } from './auth/gate';
import { mountLogin } from './auth/login';
// ... other imports unchanged

async function boot() {
  const root = document.getElementById('app');
  if (!root) throw new Error('missing #app');

  const { data: { session } } = await supabase.auth.getSession();
  let state = gateStateFor(session);

  function render() {
    if (state === 'signed-out') {
      mountLogin(root, { onSent: () => {/* no-op, user will click email */} });
    } else if (state === 'not-allowed') {
      root.innerHTML = '<div class="denied">Access denied. Sign out and try a different account.</div>';
      // TODO: add sign-out button
    } else if (state === 'ready') {
      mountApp(root);  // everything currently in main.ts's body moves here
    }
  }

  supabase.auth.onAuthStateChange((_event, newSession) => {
    state = gateStateFor(newSession);
    render();
  });

  render();
}

boot();
```

**Step 3:** Extract the current body of `main.ts` into a `mountApp(root)` function at the bottom of the same file. It should remain using `loadSaved/persist` from `storage/local.ts` for now — the storage swap happens in Phase 4.

**Step 4:** Typecheck.

Run: `pnpm typecheck`
Expected: no errors.

**Step 5:** Smoke test.

Run: `pnpm dev`, open browser, verify the login screen appears when not signed in. Enter one of the three allowlisted emails, click "Send magic link," check inbox, click the link. Expect redirect back to the app and the existing UI to render. Close dev server.

**Commit:**
```bash
git add src/main.ts
git commit -m "feat(auth): gate app behind email allowlist"
```

---

## Phase 3 — Tile domain model

### Task 3.1: Tile type + default-label generator — failing tests

**Files:**
- Create: `tests/core/tile.test.ts`

**Step 1:** Write:

```ts
import { describe, expect, it } from 'vitest';
import { defaultTileLabel, type Tile } from '@/core/tile';

describe('defaultTileLabel', () => {
  it('formats square tiles', () => {
    expect(defaultTileLabel('square', 3)).toBe('Square 3"');
    expect(defaultTileLabel('square', 7.87)).toBe('Square 7.87"');
  });

  it('formats pointy-top hex', () => {
    expect(defaultTileLabel('hex-pointy', 2)).toBe('Hex (pointy) 2"');
  });

  it('formats flat-top hex', () => {
    expect(defaultTileLabel('hex-flat', 4)).toBe('Hex (flat) 4"');
  });

  it('trims trailing zeros on sizes', () => {
    expect(defaultTileLabel('square', 3.5)).toBe('Square 3.5"');
    expect(defaultTileLabel('square', 3.0)).toBe('Square 3"');
  });
});

describe('Tile type shape', () => {
  it('accepts all three shape literals', () => {
    const t: Tile = { id: 'x', shape: 'square', sizeIn: 1, label: 'x' };
    expect(t.shape).toBe('square');
  });
});
```

**Step 2:** Run.

Run: `pnpm test tests/core/tile.test.ts`
Expected: FAIL — `@/core/tile` missing.

**No commit yet.**

---

### Task 3.2: Tile type + default-label generator — implement

**Files:**
- Create: `src/core/tile.ts`

**Step 1:** Write:

```ts
export type TileShape = 'square' | 'hex-pointy' | 'hex-flat';

export interface Tile {
  id: string;
  shape: TileShape;
  sizeIn: number;
  label: string;
}

const SHAPE_LABELS: Record<TileShape, string> = {
  'square': 'Square',
  'hex-pointy': 'Hex (pointy)',
  'hex-flat': 'Hex (flat)',
};

export function defaultTileLabel(shape: TileShape, sizeIn: number): string {
  const size = Number.isInteger(sizeIn) ? String(sizeIn) : String(parseFloat(sizeIn.toFixed(2)));
  return `${SHAPE_LABELS[shape]} ${size}"`;
}
```

**Step 2:** Run tests.

Run: `pnpm test tests/core/tile.test.ts`
Expected: all pass.

**Commit:**
```bash
git add src/core/tile.ts tests/core/tile.test.ts
git commit -m "feat(core): add Tile type and default-label generator"
```

---

### Task 3.3: Extend `State` with tiles array and Surface.tileId

**Files:**
- Modify: `src/core/state.ts`
- Modify: `tests/grid.test.ts`, `tests/stats.test.ts` (only if breakage; likely fine)

**Step 1:** Read current `src/core/state.ts`.

**Step 2:** Edit `src/core/state.ts`:

```ts
import type { Tile } from './tile';

// ... existing imports, SurfaceGroup, etc.

export interface Surface {
  id: string;
  group: SurfaceGroup;
  name: string;
  widthIn: number;
  heightIn: number;
  note?: string;
  heightLocked?: boolean;
  tileId: string;                   // NEW
}

export interface State {
  ceilFt: number;
  palette: string[];
  selectedColor: string;
  tool: Tool;
  surfaces: Surface[];
  tiles: Record<string, Map<string, string>>;   // painted cells (unchanged)
  tileLibrary: Tile[];                          // NEW — the global tile library
  viewMode: ViewMode;
  orbit: Orbit;
}
```

**Step 3:** Update `initialState()` to return an empty shell (no hardcoded surfaces — those come from Supabase now):

```ts
export function initialState(): State {
  return {
    ceilFt: 9,
    palette: [...DEFAULT_PALETTE],
    selectedColor: DEFAULT_PALETTE[4]!,
    tool: 'paint',
    surfaces: [],
    tiles: {},
    tileLibrary: [],
    viewMode: '2d',
    orbit: { rotX: -18, rotY: -28 },
  };
}
```

**Step 4:** **Remove** `defaultSurfaces()` function from this file. The 8 seeded surfaces now live only in `supabase/migrations/0002_seed.sql`. If any code still imports `defaultSurfaces`, it will break — that's expected. We'll fix call sites in the next tasks.

**Step 5:** Typecheck.

Run: `pnpm typecheck`
Expected: errors in `storage/local.ts` and `main.ts` that reference `defaultSurfaces`. These are expected — next tasks fix them.

**No commit yet** — breakage will be resolved in Task 3.4.

---

### Task 3.4: Resolve `defaultSurfaces` fallout

**Files:**
- Modify: `src/storage/local.ts` (remove `defaultSurfaces` dependency)

**Step 1:** `storage/local.ts` currently re-seeds surfaces via `defaultSurfaces()` on load. Since surfaces now live in Supabase, this path is obsolete. Strip `applySaved`, `persist`, `loadSaved`, `SavedShape` down to ONLY what's UI-local (orbit, viewMode). Rename the file's key constant to `tilePlanner.ui.v1`.

New `src/storage/local.ts`:

```ts
import type { State } from '@/core/state';

const KEY = 'tilePlanner.ui.v1';

interface UIPrefs {
  viewMode?: '2d' | '3d';
  orbit?: { rotX: number; rotY: number };
}

export function loadUIPrefs(): UIPrefs | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as UIPrefs;
  } catch { /* ignore */ }
  return null;
}

export function persistUIPrefs(state: State): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ viewMode: state.viewMode, orbit: state.orbit }));
  } catch { /* ignore */ }
}

export function applyUIPrefs(state: State, prefs: UIPrefs): void {
  if (prefs.viewMode === '2d' || prefs.viewMode === '3d') state.viewMode = prefs.viewMode;
  if (prefs.orbit && typeof prefs.orbit.rotX === 'number' && typeof prefs.orbit.rotY === 'number') {
    state.orbit = prefs.orbit;
  }
}
```

**Step 2:** Remove the `Save` / `Load` (file export/import) buttons from `src/main.ts` and `src/ui/layout.ts` — they're orthogonal to Supabase persistence and were file-export artifacts. If the user wants export/import later, it's a separate feature. If `layout.ts` exports `saveBtn`/`loadBtn`/`resetBtn`, drop those refs.

  *(Before removing, grep for references to `saveBtn` / `loadBtn` / `resetBtn` in other modules and update accordingly.)*

**Step 3:** `src/main.ts` — temporarily comment out or stub the parts that use `loadSaved`/`persist`/`applySaved`/`initTiles`. It's OK for the app to not render correctly yet; Phase 4 reconnects storage. Goal is ONLY to make typecheck pass.

Minimal stub in `main.ts` `mountApp`:

```ts
function mountApp(root: HTMLElement) {
  // placeholder — Phase 4 reconnects storage
  root.innerHTML = '<div>App hydration pending (Phase 4).</div>';
}
```

**Step 4:** Typecheck.

Run: `pnpm typecheck`
Expected: passes.

**Step 5:** Run existing tests.

Run: `pnpm test`
Expected: `tests/grid.test.ts`, `tests/stats.test.ts`, `tests/dimensions.test.ts`, `tests/core/tile.test.ts`, `tests/auth/gate.test.ts` all pass.

**Commit:**
```bash
git add -A
git commit -m "refactor(state): drop hardcoded surface seeding; UI-local prefs only in storage/local"
```

---

## Phase 4 — Supabase storage layer

### Task 4.1: Storage module — read functions (failing tests)

**Files:**
- Create: `tests/storage/supabase.test.ts`

**Step 1:** Read @superpowers:test-driven-development.

**Step 2:** Decide on mocking approach. The test file must NOT hit real Supabase. Use a hand-rolled minimal mock that the tests pass as the `client` argument. The storage module will therefore take the client as a parameter rather than importing the singleton directly.

Write `tests/storage/supabase.test.ts` with tests for `fetchAll(client)`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { fetchAll } from '@/storage/supabase';

function mockClient(rows: Record<string, any[]>) {
  return {
    from(table: string) {
      return {
        select: vi.fn().mockResolvedValue({ data: rows[table] ?? [], error: null }),
      };
    },
  } as any;
}

describe('fetchAll', () => {
  it('loads tiles, surfaces, painted cells, settings, versions and maps snake_case → camelCase', async () => {
    const client = mockClient({
      tiles: [{ id: 't1', shape: 'square', size_in: 3, label: 'Square 3"' }],
      surfaces: [{ id: 'main', group: 'Floors', name: 'Main', width_in: 130, height_in: 78, note: null, height_locked: false, tile_id: 't1' }],
      painted_cells: [{ surface_id: 'main', cell_key: '0,0', color: '#fff' }],
      project_settings: [{ id: 1, ceil_ft: 9, palette: ['#fff'], selected_color: '#fff' }],
      versions: [],
    });
    const result = await fetchAll(client);
    expect(result.tileLibrary).toEqual([{ id: 't1', shape: 'square', sizeIn: 3, label: 'Square 3"' }]);
    expect(result.surfaces[0].tileId).toBe('t1');
    expect(result.surfaces[0].widthIn).toBe(130);
    expect(result.paintedCells.main.get('0,0')).toBe('#fff');
    expect(result.settings.ceilFt).toBe(9);
    expect(result.versions).toEqual([]);
  });
});
```

**Step 3:** Run.

Run: `pnpm test tests/storage/supabase.test.ts`
Expected: FAIL — `@/storage/supabase` not found.

---

### Task 4.2: Storage module — `fetchAll` implementation

**Files:**
- Create: `src/storage/supabase.ts`

**Step 1:** Query context7 for `supabase-js` `from().select()` shape and error handling:

```
mcp__context7__query-docs { query: "supabase-js select with error handling typescript" }
```

**Step 2:** Write the module skeleton:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Surface, State } from '@/core/state';
import type { Tile } from '@/core/tile';

export interface LoadedState {
  tileLibrary: Tile[];
  surfaces: Surface[];
  paintedCells: Record<string, Map<string, string>>;
  settings: { ceilFt: number; palette: string[]; selectedColor: string };
  versions: VersionRow[];
}

export interface VersionRow {
  id: string;
  label: string;
  createdAt: string;
  surfacesSnapshot: unknown;
  paintedCellsSnapshot: unknown;
  settingsSnapshot: unknown;
}

export async function fetchAll(client: SupabaseClient): Promise<LoadedState> {
  const [tilesQ, surfacesQ, cellsQ, settingsQ, versionsQ] = await Promise.all([
    client.from('tiles').select('id,shape,size_in,label'),
    client.from('surfaces').select('id,group,name,width_in,height_in,note,height_locked,tile_id'),
    client.from('painted_cells').select('surface_id,cell_key,color'),
    client.from('project_settings').select('id,ceil_ft,palette,selected_color'),
    client.from('versions').select('id,label,created_at,surfaces_snapshot,painted_cells_snapshot,settings_snapshot').order('created_at', { ascending: false }),
  ]);

  // bubble errors
  for (const q of [tilesQ, surfacesQ, cellsQ, settingsQ, versionsQ]) {
    if (q.error) throw new Error(`Supabase fetch failed: ${q.error.message}`);
  }

  const tileLibrary: Tile[] = (tilesQ.data ?? []).map(r => ({
    id: r.id, shape: r.shape, sizeIn: Number(r.size_in), label: r.label,
  }));

  const surfaces: Surface[] = (surfacesQ.data ?? []).map(r => ({
    id: r.id, group: r.group, name: r.name,
    widthIn: Number(r.width_in), heightIn: Number(r.height_in),
    note: r.note ?? undefined, heightLocked: !!r.height_locked,
    tileId: r.tile_id,
  }));

  const paintedCells: Record<string, Map<string, string>> = {};
  for (const s of surfaces) paintedCells[s.id] = new Map();
  for (const c of (cellsQ.data ?? [])) {
    const m = paintedCells[c.surface_id] ?? (paintedCells[c.surface_id] = new Map());
    m.set(c.cell_key, c.color);
  }

  const settingsRow = settingsQ.data?.[0] ?? { ceil_ft: 9, palette: [], selected_color: '#b85450' };
  const settings = {
    ceilFt: Number(settingsRow.ceil_ft),
    palette: settingsRow.palette,
    selectedColor: settingsRow.selected_color,
  };

  const versions: VersionRow[] = (versionsQ.data ?? []).map(r => ({
    id: r.id, label: r.label, createdAt: r.created_at,
    surfacesSnapshot: r.surfaces_snapshot,
    paintedCellsSnapshot: r.painted_cells_snapshot,
    settingsSnapshot: r.settings_snapshot,
  }));

  return { tileLibrary, surfaces, paintedCells, settings, versions };
}
```

**Step 3:** Run tests.

Run: `pnpm test tests/storage/supabase.test.ts`
Expected: passes.

**Step 4:** Typecheck.

Run: `pnpm typecheck`
Expected: passes.

**Commit:**
```bash
git add src/storage/supabase.ts tests/storage/supabase.test.ts
git commit -m "feat(storage): add fetchAll to load state from Supabase"
```

---

### Task 4.3: Write mutations — paint / batch-paint + tests

**Files:**
- Modify: `src/storage/supabase.ts` (add mutations)
- Modify: `tests/storage/supabase.test.ts` (tests first)

**Step 1:** Add tests to `tests/storage/supabase.test.ts`:

```ts
import { paintCell, paintCells, erasCell, /* etc */ } from '@/storage/supabase';

describe('paintCell', () => {
  it('upserts one painted_cells row', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = { from: () => ({ upsert }) } as any;
    await paintCell(client, 'main', '3,5', '#abc');
    expect(upsert).toHaveBeenCalledWith([{ surface_id: 'main', cell_key: '3,5', color: '#abc' }], { onConflict: 'surface_id,cell_key' });
  });
});

describe('paintCells (batch)', () => {
  it('upserts multiple rows in one call', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = { from: () => ({ upsert }) } as any;
    await paintCells(client, 'main', new Map([['0,0','#fff'],['0,1','#000']]));
    expect(upsert).toHaveBeenCalledTimes(1);
    const arg = upsert.mock.calls[0][0];
    expect(arg).toHaveLength(2);
  });

  it('is a no-op for empty map', async () => {
    const upsert = vi.fn();
    const client = { from: () => ({ upsert }) } as any;
    await paintCells(client, 'main', new Map());
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('eraseCell', () => {
  it('deletes a painted_cells row', async () => {
    const del = vi.fn().mockReturnValue({
      match: vi.fn().mockResolvedValue({ error: null }),
    });
    const client = { from: () => ({ delete: del }) } as any;
    await erasCell(client, 'main', '3,5');
    expect(del).toHaveBeenCalled();
  });
});
```

**Step 2:** Run — expect failure (symbols don't exist).

**Step 3:** Implement in `src/storage/supabase.ts`:

```ts
export async function paintCell(client: SupabaseClient, surfaceId: string, cellKey: string, color: string): Promise<void> {
  const { error } = await client.from('painted_cells').upsert(
    [{ surface_id: surfaceId, cell_key: cellKey, color }],
    { onConflict: 'surface_id,cell_key' },
  );
  if (error) throw new Error(`paintCell failed: ${error.message}`);
}

export async function paintCells(client: SupabaseClient, surfaceId: string, cells: Map<string, string>): Promise<void> {
  if (cells.size === 0) return;
  const rows = Array.from(cells, ([cell_key, color]) => ({ surface_id: surfaceId, cell_key, color }));
  const { error } = await client.from('painted_cells').upsert(rows, { onConflict: 'surface_id,cell_key' });
  if (error) throw new Error(`paintCells failed: ${error.message}`);
}

export async function eraseCell(client: SupabaseClient, surfaceId: string, cellKey: string): Promise<void> {
  const { error } = await client.from('painted_cells').delete().match({ surface_id: surfaceId, cell_key: cellKey });
  if (error) throw new Error(`eraseCell failed: ${error.message}`);
}
```

**Step 4:** Run tests, expect pass.

**Commit:**
```bash
git add -A
git commit -m "feat(storage): add paint/erase cell mutations"
```

---

### Task 4.4: Tile, surface, settings, version CRUD mutations

**Files:**
- Modify: `src/storage/supabase.ts` (append)
- Modify: `tests/storage/supabase.test.ts` (append)

**Step 1:** Tests first. For each function, write a small mocked-client test asserting the right table + payload shape:

- `createTile(client, { shape, sizeIn, label })` → inserts a new row; returns the created tile with id.
- `deleteTile(client, id)` → deletes; errors surface-cleanly if FK restrict triggers.
- `updateSurfaceDims(client, id, { widthIn, heightIn })` → updates surface.
- `setSurfaceTile(client, surfaceId, tileId)` → updates surface.tile_id.
- `clearSurfacePaint(client, surfaceId)` → deletes all painted_cells for that surface.
- `updateSettings(client, { ceilFt?, palette?, selectedColor? })` → updates singleton row.
- `saveVersion(client, label, snapshots)` → inserts version row, returns id.
- `deleteVersion(client, id)` → deletes.
- `restoreVersion(client, version, /* state-shaped snapshot */)` — this one is richer: clears working state (surfaces, painted_cells) and re-inserts from snapshot. Implement as a sequence of calls; DO NOT attempt a DB transaction from client SDK (not supported over PostgREST — document this in a comment).

**Step 2:** Run tests; expect failures.

**Step 3:** Implement each function. For `restoreVersion`, the sequence is:
  1. Delete all `painted_cells`.
  2. Upsert all `surfaces` rows from snapshot (overwriting widths/heights/tile_ids).
  3. Upsert `project_settings` (id=1).
  4. Upsert all `painted_cells` from snapshot.

  Between steps, handle errors: if step 2 fails (e.g. snapshot references deleted tile via FK), throw a clear error. The UI will treat this as a failed restore and show an inline error.

**Step 4:** Run tests; expect pass.

**Step 5:** Typecheck + full test suite.

Run: `pnpm typecheck && pnpm test`
Expected: passes.

**Commit:**
```bash
git add -A
git commit -m "feat(storage): add tile/surface/settings/version mutations"
```

---

### Task 4.5: Realtime subscription + echo suppression

**Files:**
- Modify: `src/storage/supabase.ts` (add `subscribeAll`)
- Create: `tests/storage/subscribe.test.ts` (basic mock test for echo suppression logic)

**Step 1:** Query context7:

```
mcp__context7__query-docs { query: "supabase-js channel postgres_changes subscribe handler typescript" }
```

Confirm the current signature — in recent versions it's `client.channel('...').on('postgres_changes', { event: '*', schema: 'public', table: 'x' }, handler).subscribe()`. Note the exact `new` vs `old` record payload shape.

**Step 2:** Design signature:

```ts
export interface ChangeHandlers {
  onTile: (change: { kind: 'insert'|'update'|'delete', row: any, oldRow?: any }) => void;
  onSurface: (change: { kind: 'insert'|'update'|'delete', row: any, oldRow?: any }) => void;
  onPaintedCell: (change: { kind: 'insert'|'update'|'delete', row: any, oldRow?: any }) => void;
  onSettings: (change: { row: any }) => void;
  onVersion: (change: { kind: 'insert'|'update'|'delete', row: any, oldRow?: any }) => void;
}

/** Call once on app load; returns an unsubscribe. Pass `pendingKeys` — a shared Set that the storage
 *  mutations push into before write and remove after echo arrives. */
export function subscribeAll(client: SupabaseClient, handlers: ChangeHandlers, pendingKeys: Set<string>): () => void {
  const channel = client.channel('bathroom-tiles');
  channel
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tiles' }, (payload) => {
      // ... dispatch to handlers.onTile with appropriate change kind
    })
    // ... repeat for surfaces, painted_cells, project_settings, versions
    .subscribe();
  return () => { client.removeChannel(channel); };
}
```

**Echo suppression:** before a write mutation, compute a key (e.g. `painted_cell:main:3,5:#abc`) and add to `pendingKeys`. In the subscription handler, if the incoming change matches a pending key, remove the key and return without dispatching. If mutations are async and echo can race, keep a small time-window for each pending key (TTL ~2s).

**Step 3:** Tests: verify that a handler is NOT invoked when the corresponding key is pre-seeded in `pendingKeys`. (Unit test the dispatcher logic without the real channel — extract the per-table dispatch into a pure function that tests can call directly.)

**Step 4:** Run tests, expect pass. Typecheck.

**Commit:**
```bash
git add -A
git commit -m "feat(storage): subscribe to realtime postgres_changes with echo suppression"
```

---

### Task 4.6: Wire storage into main.ts boot

**Files:**
- Modify: `src/main.ts`

**Step 1:** Replace the `mountApp` placeholder. New shape:

```ts
async function mountApp(root: HTMLElement) {
  const refs = mountLayout(root);
  const state = initialState();

  // Hydrate from Supabase
  const loaded = await fetchAll(supabase);
  state.tileLibrary = loaded.tileLibrary;
  state.surfaces = loaded.surfaces;
  state.tiles = loaded.paintedCells;
  state.ceilFt = loaded.settings.ceilFt;
  state.palette = loaded.settings.palette;
  state.selectedColor = loaded.settings.selectedColor;
  // versions handled in Phase 10

  // UI-local prefs
  const ui = loadUIPrefs();
  if (ui) applyUIPrefs(state, ui);

  // Subscribe realtime
  const pendingKeys = new Set<string>();
  const unsubscribe = subscribeAll(supabase, {
    onPaintedCell: (c) => applyPaintedCellChange(state, c, refs),
    onSurface: (c) => applySurfaceChange(state, c, refs),
    onTile: (c) => applyTileChange(state, c, refs),
    onSettings: (c) => applySettingsChange(state, c, refs),
    onVersion: (c) => applyVersionChange(state, c, refs),
  }, pendingKeys);

  // Render
  renderAll(state, refs);

  // Wire input handlers (they now call storage/supabase mutations, not storage/local.persist)
  wireCanvasPainting(refs.canvas2d, state, { /* ... */ });
  // ... ceiling input, tool buttons, view toggle — adapt each handler to call the relevant
  //     storage mutation and add the pending key to `pendingKeys`.

  // On sign-out, call unsubscribe(). Handle via onAuthStateChange in boot.
}
```

Apply-change helper functions live in a new `src/ui/apply.ts` module if they get long; otherwise inline in `main.ts`. Rule of thumb: when `main.ts` exceeds ~200 lines, extract.

**Step 2:** Typecheck.

Run: `pnpm typecheck`
Expected: passes.

**Step 3:** Smoke test.

Run: `pnpm dev`, sign in, verify the 8 surfaces render, ceiling input works, painting persists (reload page → paint still there), and opening a second browser (also signed in) shows paints propagating live between the two tabs.

If realtime isn't working, re-check Supabase dashboard → Database → Replication → `supabase_realtime` publication includes all 5 tables.

**Commit:**
```bash
git add -A
git commit -m "feat(app): hydrate + sync state via Supabase storage layer"
```

---

## Phase 5 — Tile library UI

### Task 5.1: Tile library sidebar panel — read-only list

**Files:**
- Create: `src/ui/tile-library.ts`
- Modify: `src/ui/layout.ts` (add panel mount point above the color swatches)
- Modify: `src/styles/sidebar.css` (styles for the panel, matching existing sidebar tone)

**Step 1:** Add a `tileLibraryEl` to `LayoutRefs` and a corresponding `<div class="panel tile-library">` in `mountLayout`. Label: "TILES" in the existing section-header style.

**Step 2:** Write `renderTileLibrary(root, state, handlers)` that:
  - Lists each `state.tileLibrary` entry as a row: shape glyph (■ for square, ⬢ for hex-pointy, ⬡ for hex-flat) + label. Clicking the row emits `handlers.onSelect(tile)` (used in Task 5.3).
  - Highlights the row whose id matches the "focused surface's" tileId (introduce `focusedSurfaceId` in state? no — keep focus UI-local in `main.ts` as a closure).
  - Trailing `×` button on hover; clicking emits `handlers.onDelete(tile)` (no-op for now; Task 5.5 wires it).
  - Trailing row: `+ New tile` button → emits `handlers.onAddRequested()` (opens form in Task 5.2).

**Step 3:** Wire it from `main.ts` `mountApp` — render the library alongside other renders.

**Step 4:** Smoke test: sign in, confirm the one default tile (`Default 7.87" Square`) appears in the panel.

**Commit:**
```bash
git add -A
git commit -m "feat(ui): add tile library sidebar panel (read-only list)"
```

---

### Task 5.2: "+ New tile" inline form

**Files:**
- Modify: `src/ui/tile-library.ts`
- Modify: `src/styles/sidebar.css`

**Step 1:** When `onAddRequested` fires, the `+ New tile` button is replaced (in place) with an inline form:
  - Three pill-shaped radio buttons: `■ Square` / `⬢ Pointy hex` / `⬡ Flat hex`. Default `square`.
  - Size input: `<input type="number" step="0.01" min="0.01">`, suffix `in`.
  - Label input: `<input type="text">`; placeholder + default value is `defaultTileLabel(shape, size)`, re-computed when shape or size changes UNLESS the user has edited the label manually (track a `labelDirty` flag).
  - Two buttons: `Cancel` / `Add tile`. Add is disabled while size is empty or ≤ 0.

**Step 2:** On Add: call `handlers.onCreate({ shape, sizeIn, label })` — which in `main.ts` wires to `createTile(supabase, ...)`. On success the realtime subscription will insert the new tile into `state.tileLibrary` and rerender — but optimistic: also push it into state immediately, and mark its eventual echo key as pending.

**Step 3:** Smoke test: create a tile; appears in list; reload page; still there; open in another browser; also there.

**Commit:**
```bash
git add -A
git commit -m "feat(ui): inline 'New tile' form in tile library panel"
```

---

### Task 5.3: Surface focus + assigning a tile

**Files:**
- Modify: `src/ui/surface.ts` (add click-to-focus; render tile chip per surface)
- Modify: `src/ui/tile-library.ts` (row-click handler assigns tile to focused surface)
- Modify: `src/main.ts` (track `focusedSurfaceId`)

**Step 1:** In `renderSurface`, add to the `surface-head` a small tile chip: `Tile: <shape-glyph> <label>`. Looked up via `state.tileLibrary.find(t => t.id === s.tileId)`.

**Step 2:** On mousedown in a surface's grid, update `focusedSurfaceId = s.id` (closure variable in `main.ts`). Apply a subtle highlight to the focused surface (CSS class).

**Step 3:** When a tile row in the library is clicked AND there's a focused surface AND focusedSurface.tileId !== clicked.id:
  - If focused surface has zero painted cells OR clicked tile's shape equals current tile's shape: call `setSurfaceTile(supabase, focusedSurfaceId, newTileId)` directly.
  - Else (shape change with painted cells): show an inline confirm bar at the top of the focused surface: `Switching tiles clears X painted cells. [Switch] [Cancel]`. On Switch: call `clearSurfacePaint` + `setSurfaceTile` in sequence.

**Step 4:** Smoke test with a newly created non-square tile: create "Hex 2 inch (pointy)". Focus the Main bath floor. Click the new hex tile. Confirm the grid reflows to hex (Phase 7 will make this visual; for now the tileId just changes and the rerender will show squares still — accept that temporarily).

**Commit:**
```bash
git add -A
git commit -m "feat(ui): surface focus + tile assignment (confirm on shape change)"
```

---

### Task 5.4: Delete a tile (with FK-aware messaging)

**Files:**
- Modify: `src/ui/tile-library.ts`
- Modify: `src/storage/supabase.ts` (ensure `deleteTile` returns a helpful error)

**Step 1:** In `tile-library.ts`, the × button on a row fires `onDelete(tile)`. In `main.ts`, call `deleteTile(supabase, tile.id)`. If the promise rejects (FK restrict from `surfaces.tile_id`), show an inline error on that row: "In use by N surface — cannot delete" (compute N by counting `state.surfaces.filter(s => s.tileId === tile.id)`).

**Step 2:** Prevent the × button from showing at all when the computed in-use count > 0; show a non-button hint on hover instead. Avoids the need to catch the DB error in the common case.

**Commit:**
```bash
git add -A
git commit -m "feat(ui): delete tile from library (blocked when in use)"
```

---

## Phase 6 — Hex grid geometry + rendering

### Task 6.1: Hex geometry — failing tests

**Files:**
- Create: `tests/ui/hex-grid.test.ts`

**Step 1:** Decide the coordinate system. **Use axial `(q, r)`** — standard in hex literature, single canonical key `"q,r"`. Origin at `(0,0)` placed at the surface's top-left.

**Step 2:** Write tests covering:

```ts
import { describe, expect, it } from 'vitest';
import { axialToPixel, pixelToAxial, hexesInRect, hexVertices } from '@/ui/hex-grid';

describe('pointy-top hex', () => {
  it('axialToPixel at origin', () => {
    const p = axialToPixel({ q: 0, r: 0 }, { shape: 'hex-pointy', sizeIn: 2 });
    expect(p.x).toBeCloseTo(0);  // or s·√3/2 if we center the (0,0) hex fully inside the rect
    expect(p.y).toBeCloseTo(0);
  });

  it('axialToPixel and pixelToAxial round-trip', () => {
    const opts = { shape: 'hex-pointy' as const, sizeIn: 2 };
    for (const q of [-1, 0, 1, 3]) for (const r of [-1, 0, 1, 2]) {
      const p = axialToPixel({ q, r }, opts);
      const a = pixelToAxial(p, opts);
      expect(a.q).toBe(q);
      expect(a.r).toBe(r);
    }
  });
});

describe('flat-top hex', () => {
  // mirror of the above
});

describe('hexesInRect', () => {
  it('lists all axial coords whose hex intersects a given inch-rect', () => {
    const list = hexesInRect({ widthIn: 10, heightIn: 10 }, { shape: 'hex-pointy', sizeIn: 2 });
    expect(list.length).toBeGreaterThan(0);
    // Every returned (q, r) has a pixel center within or near the rect.
  });
});

describe('hexVertices', () => {
  it('returns 6 points forming a hex polygon', () => {
    const verts = hexVertices({ q: 0, r: 0 }, { shape: 'hex-pointy', sizeIn: 2 });
    expect(verts).toHaveLength(6);
  });
});
```

Round-trip test is the critical correctness property. Do not move past this task until pixel→axial→pixel produces the same axial for a grid of sample coordinates.

**Step 3:** Run; expect FAIL (module missing).

**No commit yet.**

---

### Task 6.2: Hex geometry — implement

**Files:**
- Create: `src/ui/hex-grid.ts`

**Step 1:** Implement using the standard redblobgames axial formulas (https://www.redblobgames.com/grids/hexagons/ — reference to pixel-conversion formulas; don't fetch, use well-known math). Approximate core:

```ts
export interface HexOpts { shape: 'hex-pointy'|'hex-flat'; sizeIn: number; }
export interface Axial { q: number; r: number; }
export interface Point { x: number; y: number; }  // inches

const SQRT3 = Math.sqrt(3);

export function axialToPixel({ q, r }: Axial, opts: HexOpts): Point {
  const s = opts.sizeIn;
  if (opts.shape === 'hex-pointy') {
    return { x: s * SQRT3 * (q + r / 2), y: s * (3 / 2) * r };
  } else {
    return { x: s * (3 / 2) * q, y: s * SQRT3 * (r + q / 2) };
  }
}

export function pixelToAxial({ x, y }: Point, opts: HexOpts): Axial {
  const s = opts.sizeIn;
  let qf: number, rf: number;
  if (opts.shape === 'hex-pointy') {
    qf = (x * SQRT3 / 3 - y / 3) / s;
    rf = (y * 2 / 3) / s;
  } else {
    qf = (x * 2 / 3) / s;
    rf = (-x / 3 + y * SQRT3 / 3) / s;
  }
  return hexRound(qf, rf);
}

function hexRound(qf: number, rf: number): Axial {
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf), s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

export function hexVertices(a: Axial, opts: HexOpts): Point[] {
  const c = axialToPixel(a, opts);
  const s = opts.sizeIn;
  const startAngle = opts.shape === 'hex-pointy' ? -Math.PI / 6 : 0;
  const pts: Point[] = [];
  for (let i = 0; i < 6; i++) {
    const ang = startAngle + i * Math.PI / 3;
    pts.push({ x: c.x + s * Math.cos(ang), y: c.y + s * Math.sin(ang) });
  }
  return pts;
}

export function hexesInRect(rect: { widthIn: number; heightIn: number }, opts: HexOpts): Axial[] {
  // Determine axial bounding range: find axial at each corner of the rect, then
  // iterate over the inclusive q/r envelope and keep axials whose center is inside
  // the rect OR whose hex polygon intersects the rect.
  // (For edge counts we want ALL hexes that overlap the rect, clipped.)
  // Simple implementation: over-estimate the envelope and filter by center-inside-rect
  // OR any vertex-inside-rect.
  // ...
}
```

**Step 2:** Iterate until all tests in 6.1 pass.

**Step 3:** Typecheck.

**Commit:**
```bash
git add -A
git commit -m "feat(ui): hex-grid geometry (axial↔pixel, vertices, rect enumeration)"
```

---

### Task 6.3: Hex surface rendering (SVG)

**Files:**
- Create: `src/ui/hex-surface.ts`
- Modify: `src/ui/surface.ts` (branch on tile shape)

**Step 1:** In `hex-surface.ts` export `renderHexSurface(s: Surface, tile: Tile, state: State): HTMLElement` that builds an `<svg>` with:
  - `viewBox` set to `0 0 ${widthIn * PX_PER_INCH} ${heightIn * PX_PER_INCH}`.
  - Root `<clipPath id="clip-${s.id}">` containing a rect covering the surface.
  - Each hex from `hexesInRect(s, tile)` rendered as `<polygon points="…" fill="color-or-white" stroke="var(--grid-line)" stroke-width="1" clip-path="url(#clip-${s.id})">`.
  - `data-q`, `data-r` attrs on each polygon for hit-testing.

**Step 2:** Rename `TILE_PX` in `src/core/grid.ts` to `PX_PER_INCH = 18 / 7.87` (roughly 2.287 px/in) and update callers. Keep `TILE_PX` as a named re-export for backward compat if any style code depends on the constant... actually, do NOT keep back-compat shims (per repo rules). Update all callers.

**Step 3:** In `src/ui/surface.ts`:
  - Look up the tile for the surface via `state.tileLibrary.find(t => t.id === s.tileId)`.
  - If shape === `square`: existing path (unchanged, but using new `PX_PER_INCH` instead of `TILE_PX`).
  - Else: delegate to `renderHexSurface`.

**Step 4:** Wire painting on hex surfaces. Extract `apply` + `setTile` + event delegation helpers from `src/ui/surface.ts` into a small `src/ui/painting.ts` that accepts a `target` of `{surfaceId, cellKey}` (string key — unified for both grids). For hex, target extraction reads `data-q`/`data-r` from the clicked polygon and builds `"q,r"`.

**Step 5:** Smoke test: assign a hex tile to a surface in the library; confirm it renders as hexes; click to paint; reload; paint persists.

**Commit:**
```bash
git add -A
git commit -m "feat(ui): SVG hex-surface renderer; surface.ts branches on tile shape"
```

---

### Task 6.4: Stats for hex surfaces

**Files:**
- Modify: `src/core/stats.ts`
- Modify: `tests/stats.test.ts` (add hex-path test)

**Step 1:** Make `computeSurfaceStats` accept the surface's tile:

```ts
export function computeSurfaceStats(s: Surface, tile: Tile): SurfaceStats { ... }
```

For `square`: current logic (unchanged but reading tile.sizeIn → effective cell inches; use `tile.sizeIn` instead of the old `TILE_INCH` constant).

For hex: `total = hexesInRect(s, tile).length`; `full` = count of hexes fully inside the rect (no clipping); `cut = total - full`; `areaFt2 = widthIn*heightIn/144` (unchanged).

**Step 2:** Update callers — `computeTotals` iterates surfaces and now needs the tile for each. Pass `state.tileLibrary` and look up per surface.

**Step 3:** Add a hex-path test to `tests/stats.test.ts`. Simple case: 12×12 inch surface with 2" edge hex-pointy — compute expected counts and assert.

**Step 4:** Run full suite.

Run: `pnpm test && pnpm typecheck`
Expected: passes.

**Commit:**
```bash
git add -A
git commit -m "feat(core): generalize stats to per-tile-shape counting"
```

---

## Phase 7 — 3D preview extension

### Task 7.1: 3D preview extrudes per tile shape

**Files:**
- Modify: `src/preview3d/preview.ts`

**Step 1:** Read the current `preview.ts` to understand its rendering model (read-only browse).

**Step 2:** For each painted cell, extrude a prism matching its surface's tile shape:
  - Square → box (existing path).
  - Hex → hexagonal prism. Use `hexVertices` from `@/ui/hex-grid` (if that module is SVG-coupled, move the pure geometry helpers to `@/core/hex.ts`; 3D code reads from there).

**Step 3:** Smoke test 3D mode. Verify hex tiles show as hex prisms.

**Commit:**
```bash
git add -A
git commit -m "feat(preview3d): extrude painted cells matching tile shape"
```

---

## Phase 8 — Versions

### Task 8.1: Version snapshot helpers — failing tests

**Files:**
- Create: `tests/core/version.test.ts`

**Step 1:** Tests for `buildSnapshot(state)` and `restoreIntoState(state, snapshot)` in a new `src/core/version.ts`:

```ts
describe('buildSnapshot', () => {
  it('captures surfaces, painted cells, and settings', () => {
    const state = makeTestState();
    const snap = buildSnapshot(state);
    expect(snap.surfaces).toEqual(state.surfaces.map(s => ({ ... })));
    expect(snap.paintedCells.main).toEqual({ '0,0': '#fff' });
    expect(snap.settings.ceilFt).toBe(9);
    expect(snap).not.toHaveProperty('tileLibrary');  // tile library NOT in snapshot
  });
});

describe('restoreIntoState', () => {
  it('replaces surfaces + paintedCells + settings, leaves tileLibrary alone', () => {
    const state = makeTestState();
    const snap = makeOtherSnapshot();
    restoreIntoState(state, snap);
    expect(state.surfaces).toEqual(snap.surfaces.map(/* ... */));
    expect(state.tileLibrary).toEqual(/* original */);
  });

  it('throws if snapshot references a tile not in the current library', () => {
    const state = makeTestState();
    const snap = makeSnapshotReferencingMissingTile();
    expect(() => restoreIntoState(state, snap)).toThrow(/missing tile/i);
  });
});
```

**Step 2:** Run; expect fail.

---

### Task 8.2: Version helpers — implement

**Files:**
- Create: `src/core/version.ts`

**Step 1:** Define snapshot shape (matches DB JSONB columns):

```ts
export interface Snapshot {
  surfaces: Array<{ id, widthIn, heightIn, tileId, note, heightLocked, group, name }>;
  paintedCells: Record<string, Record<string, string>>;  // {surfaceId: {cellKey: color}}
  settings: { ceilFt, palette, selectedColor };
}
```

Implement pure functions to convert state ↔ snapshot. Validate in `restoreIntoState` that every `surface.tileId` appears in `state.tileLibrary`.

**Step 2:** Run tests; expect pass.

**Commit:**
```bash
git add -A
git commit -m "feat(core): version snapshot build/restore helpers"
```

---

### Task 8.3: Versions sidebar panel + save/load/delete

**Files:**
- Create: `src/ui/versions.ts`
- Modify: `src/ui/layout.ts` (add versions panel above tile library)
- Modify: `src/styles/sidebar.css`
- Modify: `src/main.ts` (wire handlers)

**Step 1:** Panel structure, mirroring tile-library:
  - Header: "VERSIONS".
  - Top row: `+ Save as version…` → on click, inline label input + confirm button. On confirm: call `saveVersion(supabase, label, buildSnapshot(state))`. Realtime echo inserts into `state.versions`.
  - Each version row: `<label>` · time-ago · `author` (first name or email prefix). On click: inline confirm `Load "<label>"? Unsaved changes will be lost. [Load] [Cancel]`. On Load: call `restoreVersion(supabase, version)` — which on success will trigger realtime changes that re-hydrate state. After server-side restore, the live subscription should mirror everything back.
  - Trailing × on hover: deletes the version (with one-click inline confirm).

**Step 2:** In `main.ts` `mountApp`, hydrate `state.versions` from `loaded.versions` and render. Add `onVersion` handler in subscribe handlers to keep `state.versions` in sync.

**Step 3:** Smoke test: save a version, modify the room, load the saved version, confirm the room reverts. Delete a version.

**Commit:**
```bash
git add -A
git commit -m "feat(ui): versions sidebar panel with save/load/delete"
```

---

## Phase 9 — Polish + cleanup

### Task 9.1: Reconnecting indicator

**Files:**
- Create: `src/ui/connection-indicator.ts`
- Modify: `src/main.ts`

**Step 1:** Query context7 for realtime connection state events:

```
mcp__context7__query-docs { query: "supabase-js realtime channel subscribe CHANNEL_ERROR CLOSED reconnection events" }
```

**Step 2:** Build a small top-right pill element that shows:
  - Nothing when connected.
  - "Reconnecting…" dim grey when channel status is `CHANNEL_ERROR` / `CLOSED` / `TIMED_OUT`.
  - "Offline" subtle red when `navigator.onLine` is false.

Listen to channel status events and `window.online/offline` events.

**Step 3:** Smoke test: kill Wi-Fi briefly, confirm the pill appears, reconnect, pill disappears.

**Commit:**
```bash
git add -A
git commit -m "feat(ui): reconnecting/offline indicator"
```

---

### Task 9.2: Sign-out affordance

**Files:**
- Modify: `src/ui/layout.ts` (add a small "Sign out" link in a footer or header corner)
- Modify: `src/main.ts`

**Step 1:** Tiny `Sign out` text button. On click: `await supabase.auth.signOut()`. The `onAuthStateChange` listener from Task 2.5 handles the rerender to the login screen.

**Commit:**
```bash
git add -A
git commit -m "feat(auth): sign-out button"
```

---

### Task 9.3: Drop unused local-storage shape type

**Files:**
- Modify: `src/storage/local.ts` (already pruned in Task 3.4; verify no stale exports)
- Modify: any remaining imports of removed symbols.

**Step 1:** Grep for `SavedShape`, `applySaved`, `serializeTiles`, `loadSaved`, `persist` across `src/`. Anything still importing them must be updated.

Run: `Grep -r "applySaved\|SavedShape\|serializeTiles\|loadSaved\b\|persist\b" src/`

**Step 2:** Delete any dead imports.

**Commit (if any changes):**
```bash
git add -A
git commit -m "chore: remove unused local-storage exports"
```

---

### Task 9.4: Full-suite verification before sign-off

**Files:** none

**Step 1:** @superpowers:verification-before-completion

Run: `pnpm typecheck`
Expected: zero errors.

Run: `pnpm test`
Expected: all tests pass.

Run: `pnpm build`
Expected: builds cleanly; note the bundle size increase (should be ~30 kB gzipped from supabase-js).

**Step 2:** Three-browser manual smoke test (requires signing in as each of the three accounts in three browsers or three profiles):
- [ ] Noah can sign in via magic link. Rejected if using a non-allowlisted email.
- [ ] Create a new tile ("Hex Matte 2" pointy"). Brenda sees it appear within 2s.
- [ ] Assign the hex tile to Main bath floor. Mackenzie sees the grid reflow.
- [ ] Paint cells in Main. Brenda sees paints land live.
- [ ] Save version "Option A". Load a different version. State reverts. Mackenzie sees the revert live.
- [ ] Sign out. Return to login screen. Sign in again — state persists.
- [ ] Reload page — state loads from Supabase.

**Step 3:** No commit unless tweaks needed for smoke-test-revealed bugs. If bugs: fix, commit per normal.

---

## Explicit non-goals (do NOT implement in this plan)

- Undo/redo
- Export/import JSON files
- Multiple rooms / multiple projects
- Admin UI for the email allowlist
- Grout color
- Per-tile color preview in the library
- Offline queue that survives tab-death
- Mobile-friendly responsive layout (defer until requested)

---

## Rollback plan

If Supabase integration goes sideways, revert the merge of this branch. LocalStorage-only version remains at commit `7338ebc` (pre-branch baseline).
