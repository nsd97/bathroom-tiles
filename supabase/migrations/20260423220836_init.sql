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
  using ((select auth.jwt() ->> 'email') in ('deskinnoah@gmail.com','brenda@deskin.ca','mackenzieagretto1@gmail.com'));
create policy "allowlist_write_tiles" on public.tiles for all
  using ((select auth.jwt() ->> 'email') in ('deskinnoah@gmail.com','brenda@deskin.ca','mackenzieagretto1@gmail.com'))
  with check ((select auth.jwt() ->> 'email') in ('deskinnoah@gmail.com','brenda@deskin.ca','mackenzieagretto1@gmail.com'));

create policy "allowlist_read_surfaces" on public.surfaces for select
  using ((select auth.jwt() ->> 'email') in ('deskinnoah@gmail.com','brenda@deskin.ca','mackenzieagretto1@gmail.com'));
create policy "allowlist_write_surfaces" on public.surfaces for all
  using ((select auth.jwt() ->> 'email') in ('deskinnoah@gmail.com','brenda@deskin.ca','mackenzieagretto1@gmail.com'))
  with check ((select auth.jwt() ->> 'email') in ('deskinnoah@gmail.com','brenda@deskin.ca','mackenzieagretto1@gmail.com'));

create policy "allowlist_read_painted_cells" on public.painted_cells for select
  using ((select auth.jwt() ->> 'email') in ('deskinnoah@gmail.com','brenda@deskin.ca','mackenzieagretto1@gmail.com'));
create policy "allowlist_write_painted_cells" on public.painted_cells for all
  using ((select auth.jwt() ->> 'email') in ('deskinnoah@gmail.com','brenda@deskin.ca','mackenzieagretto1@gmail.com'))
  with check ((select auth.jwt() ->> 'email') in ('deskinnoah@gmail.com','brenda@deskin.ca','mackenzieagretto1@gmail.com'));

create policy "allowlist_read_project_settings" on public.project_settings for select
  using ((select auth.jwt() ->> 'email') in ('deskinnoah@gmail.com','brenda@deskin.ca','mackenzieagretto1@gmail.com'));
create policy "allowlist_write_project_settings" on public.project_settings for all
  using ((select auth.jwt() ->> 'email') in ('deskinnoah@gmail.com','brenda@deskin.ca','mackenzieagretto1@gmail.com'))
  with check ((select auth.jwt() ->> 'email') in ('deskinnoah@gmail.com','brenda@deskin.ca','mackenzieagretto1@gmail.com'));

create policy "allowlist_read_versions" on public.versions for select
  using ((select auth.jwt() ->> 'email') in ('deskinnoah@gmail.com','brenda@deskin.ca','mackenzieagretto1@gmail.com'));
create policy "allowlist_write_versions" on public.versions for all
  using ((select auth.jwt() ->> 'email') in ('deskinnoah@gmail.com','brenda@deskin.ca','mackenzieagretto1@gmail.com'))
  with check ((select auth.jwt() ->> 'email') in ('deskinnoah@gmail.com','brenda@deskin.ca','mackenzieagretto1@gmail.com'));

-- realtime publication
alter publication supabase_realtime add table public.tiles;
alter publication supabase_realtime add table public.surfaces;
alter publication supabase_realtime add table public.painted_cells;
alter publication supabase_realtime add table public.project_settings;
alter publication supabase_realtime add table public.versions;
