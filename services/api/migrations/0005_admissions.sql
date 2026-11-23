-- Admissions on the Platform (the demo's rules, owner decisions 22/11): ONE pipeline for every lead,
-- a MINIMAL synthetic profile (no real phone / e-mail, no finances, no visa status), an
-- explainable staff-tunable score, dashboard rates with numerator and denominator.
-- "offer" (first invoice issued) and "enrolled" (paid in full) are set by Billing only.

-- Reference data loaded by the owner role (seed).
create table course (
  org_id uuid not null,
  id     text not null check (length(id) between 1 and 64),
  code   text not null check (length(code) between 1 and 32),
  name   text not null,
  primary key (id),
  unique (org_id, id),
  unique (org_id, code)
);
-- Who leads can be assigned to: the organization's staff (and its Org Admin), by IIOS principal.
create table staff_member (
  org_id       uuid not null,
  principal_id text not null check (length(principal_id) between 1 and 128),
  display_name text not null,
  role         text not null check (role in ('staff', 'admin')),
  primary key (org_id, principal_id)
);

create table lead (
  org_id            uuid not null,
  id                text not null check (length(id) between 1 and 32),
  learner_name      text not null check (length(learner_name) between 2 and 60),
  course_code       text not null,
  center_id         text not null,
  source            text not null check (source in ('referral', 'walk_in', 'website', 'event', 'phone')),
  referrer_name     text,
  campaign_id       text,
  channel           text check (channel is null or channel in ('zalo', 'phone', 'email', 'in_person')),
  needs             text[] not null default '{}',
  note              text not null default '' check (length(note) <= 280),
  stage             text not null check (stage in ('new', 'assigned', 'contacted', 'placement', 'offer', 'enrolled', 'lost')),
  assigned_to       text,
  invoice_no        text,
  first_payment_vnd bigint,
  lost_reason       text,
  created_at        timestamptz not null,
  primary key (org_id, id),
  foreign key (org_id, center_id) references center (org_id, id),
  foreign key (org_id, course_code) references course (org_id, code),
  foreign key (org_id, assigned_to) references staff_member (org_id, principal_id)
);

-- Append-only for the application: insert, never update or delete.
create table lead_history (
  org_id  uuid not null,
  lead_id text not null,
  seq     int not null,
  stage   text not null,
  at      timestamptz not null,
  by_name text not null,
  primary key (org_id, lead_id, seq),
  foreign key (org_id, lead_id) references lead (org_id, id)
);
create table lead_activity (
  org_id  uuid not null,
  lead_id text not null,
  seq     int not null,
  kind    text not null check (kind in ('call', 'message', 'meeting', 'note')),
  text    text not null check (length(text) between 2 and 280),
  at      timestamptz not null,
  by_name text not null,
  primary key (org_id, lead_id, seq),
  foreign key (org_id, lead_id) references lead (org_id, id)
);

create table admissions_settings (
  org_id     uuid primary key,
  max        jsonb not null,
  hot_at     int not null,
  warm_at    int not null,
  stale_days int not null,
  updated_by text not null,
  updated_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['course', 'staff_member', 'lead', 'lead_history', 'lead_activity', 'admissions_settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I using (org_id = ogc_current_org()) with check (org_id = ogc_current_org())',
      t || '_tenant', t);
    execute format('revoke all on %I from public', t);
    execute format('grant select on %I to ogc_app', t);
  end loop;
end $$;

grant insert on lead, lead_history, lead_activity, admissions_settings to ogc_app;
grant update (stage, assigned_to, lost_reason, invoice_no, first_payment_vnd) on lead to ogc_app;
grant update (max, hot_at, warm_at, stale_days, updated_by, updated_at) on admissions_settings to ogc_app;
