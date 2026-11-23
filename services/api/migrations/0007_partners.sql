-- Partner Commissions on the Platform, core (owner 23/11: two PRs — this one: refer from Admissions,
-- partners ranked by fit, ledger, tier rules with versions, signals, activity; settlements, report
-- import and trends next). SYNTHETIC: a mock receivable, nothing is invoiced or paid.
--  - only a reference code, a short display name and the course go to a partner;
--  - suggestions are ranked by fit for the learner, never by commission;
--  - staff record what partners report; an Org Admin activates a rule version and approves an
--    entry — never their own step; an approved amount is locked;
--  - signals only suggest; every step goes into an append-only activity log.

create table partner (
  org_id          uuid not null,
  id              text not null check (id ~ '^PTN-[A-Z0-9]{2,20}$'),
  name            text not null check (length(name) between 2 and 80),
  courses         text[] not null,
  near_center_ids text[] not null default '{}',
  retention_pct   int not null check (retention_pct between 0 and 100),
  settlement_days int not null check (settlement_days between 1 and 90),
  primary key (org_id, id)
);

create table partner_rule (
  org_id                  uuid not null,
  id                      text not null check (id ~ '^TR-[0-9]{1,9}$'),
  partner_id              text not null,
  version                 int not null check (version >= 1),
  status                  text not null check (status in ('pending', 'active', 'retired', 'rejected')),
  cycle                   text not null check (cycle in ('monthly', 'quarterly')),
  mode                    text not null check (mode in ('progressive', 'retroactive')),
  tiers                   jsonb not null,
  attribution_window_days int not null check (attribution_window_days between 7 and 180),
  clawback_window_days    int not null check (clawback_window_days between 0 and 60),
  proposed_by             text not null,  -- IIOS principal
  proposed_by_name        text not null,
  proposed_at             timestamptz not null,
  decided_by_name         text,
  decided_at              timestamptz,
  primary key (org_id, id),
  unique (org_id, partner_id, version),
  foreign key (org_id, partner_id) references partner (org_id, id)
);
-- at most one active and one pending version per partner
create unique index partner_rule_one_active on partner_rule (org_id, partner_id) where status = 'active';
create unique index partner_rule_one_pending on partner_rule (org_id, partner_id) where status = 'pending';

create table commission_entry (
  org_id               uuid not null,
  id                   text not null check (id ~ '^CE-[0-9]{1,9}$'),
  partner_id           text not null,
  lead_id              text,
  lead_ref_code        text not null check (lead_ref_code ~ '^LR-[0-9]{1,8}$'),
  learner_display_name text not null check (length(learner_display_name) between 2 and 60),
  course_code          text not null,
  referred_at          timestamptz not null,
  expires_at           timestamptz not null,
  enrolled_at          timestamptz,
  enrolled_by          text,  -- principal who recorded the enrolment (maker-checker)
  status               text not null check (status in ('referred', 'enrolled', 'approved', 'paid', 'rejected')),
  applied_rule_id      text,
  locked_amount_vnd    bigint check (locked_amount_vnd >= 0),
  locked_tier_index    int,
  approved_at          timestamptz,
  due_date             timestamptz,
  reject_reason        text check (length(reject_reason) between 3 and 200),
  settled_batch_id     text,
  updated_by_name      text not null,
  updated_at           timestamptz not null,
  primary key (org_id, id),
  unique (org_id, lead_ref_code),
  check ((status in ('approved', 'paid')) = (locked_amount_vnd is not null)),
  foreign key (org_id, partner_id) references partner (org_id, id),
  foreign key (org_id, lead_id) references lead (org_id, id),
  foreign key (org_id, applied_rule_id) references partner_rule (org_id, id)
);
create unique index commission_entry_one_per_lead on commission_entry (org_id, lead_id) where lead_id is not null;

create table partner_activity (
  org_id  uuid not null,
  seq     int not null,
  at      timestamptz not null,
  by_name text not null,
  action  text not null,
  subject text not null,
  detail  text,
  primary key (org_id, seq)
);

create table partner_signal_mark (
  org_id    uuid not null,
  signal_id text not null check (length(signal_id) between 3 and 400),
  state     text not null check (state in ('snoozed', 'dismissed', 'followed')),
  note      text check (length(note) <= 200),
  until     timestamptz,
  by_name   text not null,
  at        timestamptz not null,
  primary key (org_id, signal_id)
);

do $$
declare t text;
begin
  foreach t in array array['partner', 'partner_rule', 'commission_entry', 'partner_activity', 'partner_signal_mark'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I using (org_id = ogc_current_org()) with check (org_id = ogc_current_org())',
      t || '_tenant', t);
    execute format('revoke all on %I from public', t);
    execute format('grant select on %I to ogc_app', t);
  end loop;
end $$;

grant insert on partner_rule, commission_entry, partner_activity, partner_signal_mark to ogc_app;
grant update (status, decided_by_name, decided_at) on partner_rule to ogc_app;
grant update (status, enrolled_at, enrolled_by, applied_rule_id, locked_amount_vnd, locked_tier_index,
              approved_at, due_date, reject_reason, updated_by_name, updated_at) on commission_entry to ogc_app;
grant update (state, note, until, by_name, at) on partner_signal_mark to ogc_app;
