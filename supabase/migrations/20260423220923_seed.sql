-- seed default tile (uuid stable across envs so surfaces can reference it deterministically)
insert into public.tiles (id, shape, size_in, label)
values ('00000000-0000-0000-0000-000000000001', 'square', 7.87, 'Default 7.87" Square')
on conflict (id) do nothing;

-- seed 8 surfaces, all using the default tile, matching defaultSurfaces(9) in state.ts
insert into public.surfaces (id, "group", name, width_in, height_in, note, height_locked, tile_id) values
  ('main',    'Floors',  'Main bath floor', 130, 78,  'plan · 10''10" × 6''6" (less shower)', false, '00000000-0000-0000-0000-000000000001'),
  ('ensuite', 'Floors',  'En suite floor',   96, 69,  'editable default · ~46 ft²',            false, '00000000-0000-0000-0000-000000000001'),
  ('shower',  'Floors',  'Shower floor',     40, 78,  'plan · 3''4" × 6''6"',                   false, '00000000-0000-0000-0000-000000000001'),
  ('ceiling', 'Ceiling', 'Main ceiling',    170, 78,  'plan · 14''2" × 6''6"',                  false, '00000000-0000-0000-0000-000000000001'),
  ('wallN',   'Walls',   'North wall',      170, 108, 'plan · 14''2" · vanity wall',            true,  '00000000-0000-0000-0000-000000000001'),
  ('wallS',   'Walls',   'South wall',      170, 108, 'plan · 14''2" · tub/toilet wall',        true,  '00000000-0000-0000-0000-000000000001'),
  ('wallE',   'Walls',   'East wall',        78, 108, 'plan · 6''6" · door end',                true,  '00000000-0000-0000-0000-000000000001'),
  ('wallW',   'Walls',   'West wall',        78, 108, 'plan · 6''6" · shower end',              true,  '00000000-0000-0000-0000-000000000001')
on conflict (id) do nothing;

-- seed settings singleton
insert into public.project_settings (id) values (1) on conflict (id) do nothing;
