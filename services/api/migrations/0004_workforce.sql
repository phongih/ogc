-- Workforce · teacher load on the Platform (the demo's rules, owner decisions 22/11): load = teaching
-- hours in the next 7 days from the schedule (computed on read); each teacher has their own target
-- hours / week set by center staff; bands are % of target with thresholds staff tune. SUGGEST ONLY.

create table teacher_target (
  org_id       uuid not null,
  teacher_id   text not null,
  employment   text not null check (employment in ('full_time', 'part_time')),
  target_hours numeric(3, 1) not null check (target_hours between 1 and 40 and target_hours * 2 = floor(target_hours * 2)),
  updated_by   text not null,
  updated_at   timestamptz not null default now(),
  primary key (org_id, teacher_id),
  foreign key (org_id, teacher_id) references teacher (org_id, id)
);

create table workforce_settings (
  org_id     uuid primary key,
  under_pct  int not null check (under_pct between 1 and 99),
  over_pct   int not null check (over_pct between 100 and 200),
  updated_by text not null,
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['teacher_target', 'workforce_settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I using (org_id = ogc_current_org()) with check (org_id = ogc_current_org())',
      t || '_tenant', t);
    execute format('revoke all on %I from public', t);
    execute format('grant select on %I to ogc_app', t);
  end loop;
end $$;

grant insert on teacher_target, workforce_settings to ogc_app;
grant update (employment, target_hours, updated_by, updated_at) on teacher_target to ogc_app;
grant update (under_pct, over_pct, updated_by, updated_at) on workforce_settings to ogc_app;
