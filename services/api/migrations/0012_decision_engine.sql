-- Decision Engine on the Platform (owner 23/11, PR B of the slice "skill profile, Current Students
-- & Decision Engine"). The rules of the demo's runner (apps/web/src/lib/adapters/
-- mockDecisionEngine.ts, owner decisions 21/11), on PostgreSQL:
--  - Observe → Detect → Decide (cooldown per rule and subject) → Act. Actions are LIMITED to a log
--    entry, an in-app notification to the teacher / center staff, and the "learners needing
--    support" list. The engine never assigns work, changes a score or moves a lesson;
--  - center staff (engine:manage) tune the fixed rule set: on / off, priority, cooldown,
--    thresholds, actions — no free-form rules;
--  - it runs when a staff or teacher page asks and the last run is older than 60 s (owner
--    23/11: no background service on VM 2), serialised per organization.
-- Events and actions are insert-only for the application.

create table engine_rule (
  org_id       uuid not null,
  id           text not null check (id ~ '^R-[0-9]{1,3}$'),
  kind         text not null,
  category     text not null check (category in ('learning', 'attendance', 'operations', 'engagement')),
  name         text not null,
  description  text not null,
  enabled      boolean not null,
  priority     text not null check (priority in ('P1', 'P2', 'P3')),
  cooldown_min integer not null check (cooldown_min between 0 and 10080),
  params       jsonb not null default '{}',
  actions      text[] not null check (cardinality(actions) >= 1
                 and actions <@ array['log_only', 'notify_teacher', 'notify_staff', 'support_queue']),
  updated_by   text,  -- display name
  updated_at   timestamptz,
  primary key (org_id, id),
  unique (org_id, kind)
);

create table engine_event (
  org_id    uuid not null,
  id        text not null check (id ~ '^EV-[0-9]{1,9}$'),
  rule_id   text not null,
  rule_name text not null,
  kind      text not null,
  priority  text not null,
  at        timestamptz not null,
  subject   jsonb not null,  -- {type, id, label}
  evidence  text not null,
  primary key (org_id, id),
  foreign key (org_id, rule_id) references engine_rule (org_id, id)
);
create index engine_event_at on engine_event (org_id, at desc);

create table engine_action (
  org_id    uuid not null,
  id        text not null check (id ~ '^AC-[0-9]{1,9}$'),
  event_id  text not null,
  rule_name text not null,
  action    text not null check (action in ('log_only', 'notify_teacher', 'notify_staff', 'support_queue')),
  target    text not null,
  at        timestamptz not null,
  primary key (org_id, id),
  foreign key (org_id, event_id) references engine_event (org_id, id)
);

-- Cooldown state: when a rule last fired for a subject.
create table engine_fired (
  org_id  uuid not null,
  rule_id text not null,
  key     text not null,
  at      timestamptz not null,
  primary key (org_id, rule_id, key),
  foreign key (org_id, rule_id) references engine_rule (org_id, id)
);

-- In-app notifications. recipient: 'staff' or 'teacher:<teacher id>'.
create table engine_notification (
  org_id    uuid not null,
  id        text not null check (id ~ '^NT-[0-9]{1,9}$'),
  recipient text not null check (recipient = 'staff' or recipient ~ '^teacher:.+$'),
  event_id  text not null,
  priority  text not null,
  text      text not null,
  at        timestamptz not null,
  read      boolean not null default false,
  primary key (org_id, id),
  foreign key (org_id, event_id) references engine_event (org_id, id)
);
create index engine_notification_recipient on engine_notification (org_id, recipient, at desc);

create table engine_job (
  org_id           uuid not null primary key,
  runs             integer not null,
  last_run_at      timestamptz,
  last_duration_ms integer,
  last_detected    integer not null default 0,
  last_new_events  integer not null default 0,
  last_skipped     integer not null default 0,
  seq              bigint not null default 0  -- last EV / AC / NT number handed out
);

create trigger engine_event_immutable before update on engine_event
  for each row execute function ogc_refuse_update();
create trigger engine_action_immutable before update on engine_action
  for each row execute function ogc_refuse_update();

do $$
declare t text;
begin
  foreach t in array array['engine_rule', 'engine_event', 'engine_action', 'engine_fired',
                           'engine_notification', 'engine_job'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I using (org_id = ogc_current_org()) with check (org_id = ogc_current_org())',
      t || '_tenant', t);
    execute format('revoke all on %I from public', t);
    execute format('grant select on %I to ogc_app', t);
  end loop;
end $$;

grant update (enabled, priority, cooldown_min, params, actions, updated_by, updated_at) on engine_rule to ogc_app;
grant insert on engine_event, engine_action, engine_fired, engine_notification, engine_job to ogc_app;
grant update (at) on engine_fired to ogc_app;
grant update (read) on engine_notification to ogc_app;
grant update (runs, last_run_at, last_duration_ms, last_detected, last_new_events, last_skipped, seq)
  on engine_job to ogc_app;
