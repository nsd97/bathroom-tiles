# Tile Library + Supabase Sync + Versions — Design

**Date:** 2026-04-23
**Status:** Approved, ready for implementation plan
**Scope:** Introduce a tile library (square + hex shapes with labels), move persistence from localStorage to Supabase with magic-link auth and live sync for three allowlisted users, and add named-snapshot versions of the room layout.

## Goals

1. **Tile library.** A global catalog of tile definitions (shape, size, label). Each surface is laid with one tile from the library, which determines its grid geometry. Color remains an orthogonal axis applied at paint time via the palette.
2. **Shared source of truth.** The three users (Noah, Brenda, Mackenzie) see and edit the same data in real time. No per-user projects, no sharing UI.
3. **Design versions.** Capture the same room in multiple labeled snapshots ("Option A — marble", "Option B — hex"), load any version back into the working state, and compare by switching.
4. **Steve Jobs bar.** Minimal, intentional, elegant. No feature that isn't load-bearing.

## Non-goals

- Undo/redo (separate feature if ever needed).
- Export/import files.
- Multiple projects / multiple rooms in one workspace.
- Admin UI for the user allowlist (hardcoded).
- Grout color, tile color previews in the library, offline queue persistence.
- Mixing tile shapes on a single surface (one tile per surface).

---

## 1. Tile library

**Identity:** a tile is `shape + size_in + label`. Nothing else. Color is orthogonal and lives in the palette/paint layer.

**Shapes (v1):**
- `square`
- `hex-pointy` (points up/down, horizontally staggered rows)
- `hex-flat` (flat edges up/down, vertically staggered columns)

**Size:** one `size_in` number per tile. For square = side length; for hex = edge length. Free-form inches, matches existing surface-dimension inputs.

**Label:** required text, auto-default on create (e.g. `Square 3"`, `Hex (pointy) 2"`), user-overridable.

**Assignment to surfaces:** exactly one tile per surface. Changing the tile on a surface reflows its grid. If the new tile's shape differs from the old, painted cells on that surface are cleared (with inline confirm). Same-shape size change preserves cells when `cell_key` is still valid.

## 2. Sharing + auth

- **One shared dataset.** All three users operate on the same rows. No notion of "my project."
- **Auth:** Supabase Email OTP (magic link / 6-digit code). New-user signups disabled in dashboard settings.
- **Access control:** RLS policies on every table check `auth.jwt() ->> 'email'` against a hardcoded allowlist of three emails:
  - `deskinnoah@gmail.com`
  - `brenda@deskin.ca`
  - `mackenzieagretto1@gmail.com`
- **Sign-in UX:** full-screen minimalist email prompt. Session persists via Supabase client's default storage (localStorage).

## 3. Realtime sync

- One Supabase Realtime channel subscribed to `postgres_changes` on `tiles`, `surfaces`, `painted_cells`, `project_settings`, `versions`.
- **Inbound:** apply changes to in-memory `State` and do a targeted rerender (single-cell paints repaint one DOM/SVG node; surface-level changes rebuild that surface).
- **Outbound writes:**
  - Single-cell paint → upsert on mousedown.
  - **Drag-paint** collects cells in memory while mouse is down; **batch upsert** on mouseup (one request per stroke).
  - Tile / surface / settings / version edits → single upsert per change.
- **Echo suppression:** clients track a local set of pending-write keys; incoming realtime events that match a pending key are absorbed silently to avoid flicker.
- **Conflict model:** last-write-wins via `updated_at`. No locking, no CRDT. Acceptable for three-user collaboration on a home-renovation planner.
- **Connection loss:** edits continue locally; dim "Reconnecting…" indicator top-right; auto-retry via Supabase client defaults. No offline queue persisted across tab-death (minimal; fine for v1).

**Implementation note:** Supabase SDK APIs (Realtime, Auth, RLS syntax) must be verified via `context7` before writing code. Training data can be stale on these.

## 4. Data model

Five tables, all in the `public` schema.

```sql
create table tiles (
  id uuid primary key default gen_random_uuid(),
  shape text not null check (shape in ('square','hex-pointy','hex-flat')),
  size_in numeric not null check (size_in > 0),
  label text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create table surfaces (
  id text primary key,
  "group" text not null check ("group" in ('Floors','Ceiling','Walls')),
  name text not null,
  width_in numeric not null,
  height_in numeric not null,
  note text,
  height_locked boolean not null default false,
  tile_id uuid not null references tiles(id) on delete restrict,
  updated_at timestamptz not null default now()
);

create table painted_cells (
  surface_id text not null references surfaces(id) on delete cascade,
  cell_key text not null,
  color text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  primary key (surface_id, cell_key)
);

create table project_settings (
  id int primary key default 1 check (id = 1),
  ceil_ft numeric not null default 9,
  palette text[] not null default '{#ffffff,#f5f5f7,#d2d2d7,#86868b,#1d1d1f,#000000,#b85450,#3a5a7a}',
  selected_color text not null default '#b85450'
);

create table versions (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  surfaces_snapshot jsonb not null,
  painted_cells_snapshot jsonb not null,
  settings_snapshot jsonb not null
);
```

**Notes:**
- `cell_key` is a string so it holds both rectangular (`"r,c"`) and hex axial (`"q,r"`) coordinates without schema change.
- `versions` captures a point-in-time **layout** — not the tile library and not the palette list itself (the palette is scoped to settings, so it does get snapshotted, but tile definitions are global/shared).
- `orbit` and `viewMode` stay in localStorage — UI-local, not shared.

**Seed migration (part of `0001_init.sql`):**
- One tile: `Default 7.87" Square` (square, size_in=7.87).
- The 8 surfaces from `defaultSurfaces(9)` all pointing to that tile.
- One `project_settings` row (id=1) with ceil_ft=9 and the default palette.
- No initial versions.

**RLS pattern** (applied to all five tables):
```sql
alter table <t> enable row level security;
create policy "allowlist_read"  on <t> for select
  using (auth.jwt() ->> 'email' in ('deskinnoah@gmail.com','brenda@deskin.ca','mackenzieagretto1@gmail.com'));
create policy "allowlist_write" on <t> for all
  using (auth.jwt() ->> 'email' in (...same...))
  with check (auth.jwt() ->> 'email' in (...same...));
```

## 5. Versions (named snapshots)

**Model:** there is always one mutable **working state** (the live tables). A version is a labeled point-in-time snapshot captured from working state. Loading a version overwrites working state with that snapshot. Linear list, not a tree. Delete allowed with confirm.

**Snapshot contents:**
- `surfaces_snapshot` — array of every surface's `{id, width_in, height_in, tile_id, note, ...}` (shape fields but **not** created_at).
- `painted_cells_snapshot` — map `{surface_id: {cell_key: color}}`.
- `settings_snapshot` — `{ceil_ft, palette, selected_color}`.

Tile definitions (`tiles`) are **not** snapshotted. If you load an old version that references a deleted tile, the load is blocked with a helpful error (we'll check FK validity before applying).

**UX:**
- VERSIONS panel in the sidebar, above TILES.
- Each row: `label · time-ago · author`. Inline × on hover.
- Top row: `+ Save as version…` → inline label input + confirm.
- Click a row → inline confirm `Load "<label>"? Current unsaved changes will be lost.` → load.

## 6. Frontend architecture

```
src/
  auth/
    client.ts          NEW — Supabase client singleton (env-driven URL + anon key)
    gate.ts            NEW — auth state machine: loading | signed-out | not-allowed | ready
    login.ts           NEW — email OTP sign-in screen
  storage/
    supabase.ts        NEW — read/write/subscribe per table; realtime channel lifecycle
    local.ts           MOD — now only UI-local prefs (orbit, viewMode) under a new key
  core/
    state.ts           MOD — add tiles: Tile[]; Surface gets tileId: string; drop hardcoded seeding
    tile.ts            NEW — Tile type, shape enum, default-label generator
    stats.ts           MOD — branch on tile shape for count/area
  ui/
    tile-library.ts    NEW — sidebar panel: list + "+ New tile" inline form
    versions.ts        NEW — sidebar panel: list + "+ Save as version…" inline form + load/delete
    surface.ts         MOD — tile chip per surface; branches to hex-grid when tile.shape != square
    hex-grid.ts        NEW — axial-coord hex geometry + SVG rendering + cell hit-test
    swatches.ts        KEEP — palette unchanged
  preview3d/           MOD — extrude each painted cell as a prism matching its tile shape
  main.ts              MOD — boot = check session → gate → hydrate → subscribe → render

.env.local             NEW — VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (gitignored)

supabase/
  migrations/
    0001_init.sql      NEW — tables + RLS + seed tile + seed surfaces + settings row
```

**Boot sequence:**
1. Create Supabase client.
2. Check session. None → render login. Email ∉ allowlist → render not-authorized. Else → proceed.
3. Parallel fetch of all five tables into `State`.
4. Open realtime channel; wire echo-suppression.
5. Render sidebar (TILES, VERSIONS, COLORS) + canvas + 3D preview.

**Dependency added:** `@supabase/supabase-js` (~30 kB gzipped). No other new deps.

**Hex grid geometry (`hex-grid.ts`):**
- Size `s` = edge length.
- Pointy-top: width across flats `s·√3`, height `2s`, col pitch `s·√3`, row pitch `3s/2`, odd rows offset `s·√3/2`.
- Flat-top: width `2s`, height across flats `s·√3`, col pitch `3s/2`, row pitch `s·√3`, odd cols offset `s·√3/2`.
- Render SVG root with `<clipPath>` = the surface rect (inches → px); one `<polygon>` per hex cell; click handlers read axial `q,r` from data attrs.
- Rename current `TILE_PX` → `PX_PER_INCH` (what it actually represents once tile size varies).

## 7. Testing, error handling, rollout

**Tests (vitest, already configured):**
- Existing `core/grid.ts` tests still pass — square path is unchanged.
- `core/tile.ts` — default-label generator across shape/size inputs.
- `ui/hex-grid.ts` — axial↔pixel round-trip, hit-test at known coords, edge-clipped cell counts for known surface sizes.
- `storage/supabase.ts` with a mocked client — write shape, subscribe applies to state, drag-paint coalesces to one batch upsert, echo suppression drops own writes.
- `ui/versions.ts` snapshot + restore round-trip.
- No live-Supabase integration test in this iteration. Manual smoke test across three signed-in browsers.

**Error handling (minimal):**
- Auth errors → inline under email input.
- Write failure → optimistic UI, silent revert, `console.warn`.
- Realtime disconnect → top-right "Reconnecting…" pill, auto-retry.
- RLS denial (shouldn't happen) → full-screen access-denied stub with sign-out.
- Load-version references missing tile → inline error "Version references a deleted tile — cannot load."

**Rollout (becomes the implementation plan):**
1. `supabase login` (user, one-time).
2. `supabase projects create` — user confirms org + region + db password.
3. Link local repo to project: `supabase link --project-ref <ref>`.
4. Write `supabase/migrations/0001_init.sql` and run `supabase db push`.
5. Dashboard: disable "Allow new user signups."
6. Populate `.env.local` with URL + anon key.
7. Install `@supabase/supabase-js`.
8. Implement auth gate + `storage/supabase.ts`.
9. Add `core/tile.ts`, extend `state.ts`, add `ui/tile-library.ts`.
10. Build `ui/hex-grid.ts`, branch `ui/surface.ts` on tile shape.
11. Extend `preview3d` to extrude hex prisms.
12. Add `ui/versions.ts` + save/load/delete flows.
13. Manual smoke test with all three accounts.
14. Ship.

## Open items deferred for execution

- Confirm exact Supabase Realtime channel API against `context7` before writing subscription code (SDK has moved between `on('postgres_changes', …)` variants).
- Verify `supabase projects create` flag names against current CLI (`--org-id`, `--region`, `--db-password`).
- Pick DB region at project-create time (user decision at that moment).
