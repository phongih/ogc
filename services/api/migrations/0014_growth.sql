-- Growth · referrals on the Platform (owner 23/11, slice 6 part A). The demo's rules (mockGrowth.ts,
-- owner decisions 22/11), on PostgreSQL. SYNTHETIC: nothing is charged, paid or credited for real.
--  - guardians and ADULT learners refer (a learner under 18 has no link); the reward is tuition
--    credit in a wallet: a % of the new learner's first tuition payment, capped;
--  - a referral counts only when its first invoice is paid in full (Admissions "enrolled") and
--    center staff confirm it, after anti-fraud checks; the credit is applied to the referrer's
--    invoices issued after it (and given back if that invoice is voided);
--  - the public /join form takes a display name, a course and a center — no contact details.

-- Who is an adult learner (may refer). Synthetic: set by the seed.
alter table learner add column adult boolean not null default false;

-- Referral codes: a public directory (code → organization), so the /join page can find the
-- organization without a grant. Readable by anyone through the API; written only within the
-- organization in scope.
create table referral_code (
  code         text primary key check (code ~ '^OGC[0-9A-Z]{6}$'),
  org_id       uuid not null,
  principal_id text not null,
  unique (org_id, principal_id)
);

create table referral_program (
  org_id     uuid primary key,
  enabled    boolean not null,
  reward_pct numeric(4, 1) not null check (reward_pct between 0 and 30),
  cap_vnd    bigint not null check (cap_vnd between 0 and 50000000),
  updated_by text not null,
  updated_at timestamptz not null default now()
);
create table referral_campaign (
  org_id    uuid not null,
  id        text not null check (id ~ '^camp-[a-z0-9-]{1,40}$'),
  name      text not null check (length(name) between 2 and 80),
  active    boolean not null,
  bonus_pct numeric(4, 1) not null check (bonus_pct between 0 and 20),
  primary key (org_id, id)
);

create table referral_click (
  org_id uuid not null,
  code   text not null references referral_code (code),
  clicks integer not null default 0 check (clicks >= 0),
  primary key (org_id, code)
);

-- A referral lead names its referrer (the lead itself stays in Admissions: one pipeline).
alter table lead add column referrer_principal_id text;
alter table lead add column referral_code text references referral_code (code);
alter table lead add constraint lead_referral_names_referrer
  check ((source = 'referral') = (referrer_principal_id is not null and referral_code is not null));

-- The reward decision per referral lead: decided once (insert-only).
create table referral_reward (
  org_id     uuid not null,
  lead_id    text not null,
  status     text not null check (status in ('confirmed', 'rejected')),
  reward_vnd bigint check (reward_vnd >= 0),
  pct        numeric(4, 1),
  at         timestamptz not null,
  by_name    text not null,
  reason     text check (length(reason) between 3 and 200),
  primary key (org_id, lead_id),
  check ((status = 'confirmed') = (reward_vnd is not null)),
  check ((status = 'rejected') = (reason is not null)),
  foreign key (org_id, lead_id) references lead (org_id, id)
);

-- The wallet: append-only entries per referrer (credit > 0, applied < 0).
create table wallet_entry (
  org_id       uuid not null,
  id           text not null check (id ~ '^W-[0-9]{1,9}$'),
  principal_id text not null,
  at           timestamptz not null,
  kind         text not null check (kind in ('credit', 'applied')),
  amount_vnd   bigint not null check (amount_vnd <> 0),
  note         text not null check (length(note) between 3 and 200),
  lead_id      text,
  invoice_id   text,
  primary key (org_id, id),
  check ((kind = 'credit') = (amount_vnd > 0)),
  foreign key (org_id, lead_id) references lead (org_id, id),
  foreign key (org_id, invoice_id) references invoice (org_id, id)
);
-- One credit per confirmed referral.
create unique index wallet_entry_one_reward on wallet_entry (org_id, lead_id)
  where lead_id is not null;

-- Invoices may now carry wallet credit (applied when issued, never more than the subtotal).
alter table invoice drop constraint invoice_credit_applied_vnd_check;
alter table invoice add constraint invoice_credit_applied_vnd_check
  check (credit_applied_vnd >= 0 and credit_applied_vnd <= subtotal_vnd);

create trigger referral_reward_immutable before update on referral_reward
  for each row execute function ogc_refuse_update();
create trigger wallet_entry_immutable before update on wallet_entry
  for each row execute function ogc_refuse_update();

do $$
declare t text;
begin
  foreach t in array array['referral_program', 'referral_campaign', 'referral_click',
                           'referral_reward', 'wallet_entry'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I using (org_id = ogc_current_org()) with check (org_id = ogc_current_org())',
      t || '_tenant', t);
    execute format('revoke all on %I from public', t);
    execute format('grant select, insert on %I to ogc_app', t);
  end loop;
end $$;
grant update (clicks) on referral_click to ogc_app;
grant update (enabled, reward_pct, cap_vnd, updated_by, updated_at) on referral_program to ogc_app;
grant update (active, bonus_pct) on referral_campaign to ogc_app;

-- The code directory: anyone may look a code up (the public page); a code is added only for the
-- organization in scope.
alter table referral_code enable row level security;
alter table referral_code force row level security;
create policy referral_code_lookup on referral_code for select using (true);
create policy referral_code_add on referral_code for insert with check (org_id = ogc_current_org());
revoke all on referral_code from public;
grant select, insert on referral_code to ogc_app;
