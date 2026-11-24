-- Gamification on the Platform (owner 24/11; same rules as the demo, owner 22/11). Rewards are
-- DERIVED from learning evidence on every read — nothing here records XP. These tables hold only
-- the organization's settings within the closed catalog (staff with rewards:manage change them);
-- an organization without rows uses the defaults. SYNTHETIC data only.

create table reward_settings (
  org_id              uuid primary key,
  level_size          integer not null check (level_size between 10 and 1000),
  leaderboard_enabled boolean not null,
  updated_by          text not null,
  updated_at          timestamptz not null
);

create table reward_rule (
  org_id  uuid not null,
  kind    text not null check (kind in ('activity_completed', 'practice_scored', 'speaking_approved', 'makeup_done')),
  enabled boolean not null,
  xp      integer not null check (xp between 0 and 100),
  primary key (org_id, kind)
);

create table badge_rule (
  org_id    uuid not null,
  kind      text not null check (kind in ('first_activity', 'perfect_score', 'speaking_approved', 'makeup_on_time', 'streak', 'level')),
  enabled   boolean not null,
  threshold integer check (threshold between 1 and 365),
  primary key (org_id, kind),
  -- only the streak and level badges have a threshold
  check ((kind in ('streak', 'level')) = (threshold is not null))
);

do $$
declare t text;
begin
  foreach t in array array['reward_settings', 'reward_rule', 'badge_rule'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy %I on %I using (org_id = ogc_current_org()) with check (org_id = ogc_current_org())', t || '_tenant', t);
    execute format('revoke all on %I from public', t);
    execute format('grant select, insert on %I to ogc_app', t);
  end loop;
end $$;
grant update (level_size, leaderboard_enabled, updated_by, updated_at) on reward_settings to ogc_app;
grant update (enabled, xp) on reward_rule to ogc_app;
grant update (enabled, threshold) on badge_rule to ogc_app;
