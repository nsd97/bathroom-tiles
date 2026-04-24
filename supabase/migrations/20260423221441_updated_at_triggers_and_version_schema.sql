-- Reusable trigger function: bump updated_at to server clock on UPDATE.
-- Enforced at the DB level so last-write-wins sync does not depend on clients
-- remembering to set updated_at.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Apply to surfaces and painted_cells (the two tables whose updated_at column
-- drives sync reconciliation).
create trigger surfaces_set_updated_at
  before update on public.surfaces
  for each row execute function public.set_updated_at();

create trigger painted_cells_set_updated_at
  before update on public.painted_cells
  for each row execute function public.set_updated_at();

-- versions stores JSONB snapshots of surfaces/painted_cells/settings. Tag each
-- snapshot with the schema it was written against so future schema changes can
-- migrate or reject old snapshots instead of deserializing them as partial
-- objects.
alter table public.versions add column schema_version int not null default 1;
