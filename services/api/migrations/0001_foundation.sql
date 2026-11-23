-- OGC Platform — 0001 foundation (ADR-040 §4). Forward-only; never edit after merge.
-- Runs as the migration role (table owner). The application connects as `ogc_app`, which must
-- already exist (provisioning creates it: NOLOGIN for tests, LOGIN with a password on the VM),
-- is NOT the owner and has no BYPASSRLS — so row-level security always applies to it.

-- Tenant scope for the current transaction, set by the DAK (`set_config('app.org_id', …, true)`).
-- No setting → NULL → no row is visible or writable.
create function ogc_current_org() returns uuid
  language sql stable
  as $$ select nullif(current_setting('app.org_id', true), '')::uuid $$;

-- ── audit_event: append-only ───────────────────────────────────────────────────────────────
create table audit_event (
  event_id        uuid primary key default gen_random_uuid(),
  org_id          uuid not null,
  principal_id    text not null,
  request_id      text not null,          -- OGC request id
  iios_request_id text,                   -- the grant's IIOS request id (correlation)
  action          text not null,
  resource        jsonb not null,
  outcome         text not null check (outcome in ('allowed', 'denied', 'failed')),
  reason          text,
  at              timestamptz not null default now(),
  before_hash     text,
  after_hash      text
);
create index audit_event_org_at on audit_event (org_id, at desc);
create index audit_event_request on audit_event (request_id);

alter table audit_event enable row level security;
alter table audit_event force row level security;
create policy audit_event_tenant on audit_event
  using (org_id = ogc_current_org())
  with check (org_id = ogc_current_org());

create function ogc_refuse_change() returns trigger
  language plpgsql
  as $$ begin raise exception '% is append-only', tg_table_name; end $$;
-- Statement-level: refused even when RLS would hide every row from the statement.
create trigger audit_event_no_change before update or delete or truncate on audit_event
  for each statement execute function ogc_refuse_change();

-- ── idempotency_key: one stored result per (org, key) ──────────────────────────────────────
create table idempotency_key (
  org_id       uuid not null,
  key          text not null check (length(key) between 8 and 128),
  principal_id text not null,
  route        text not null,
  request_hash text not null,
  status_code  int not null,
  response     jsonb not null,
  created_at   timestamptz not null default now(),
  primary key (org_id, key)
);
alter table idempotency_key enable row level security;
alter table idempotency_key force row level security;
create policy idempotency_key_tenant on idempotency_key
  using (org_id = ogc_current_org())
  with check (org_id = ogc_current_org());

-- ── grants to the application role: read + append (+ the idempotency result) only ────────────────────────────────────
revoke all on audit_event, idempotency_key from public;
grant select, insert on audit_event to ogc_app;
grant select, insert on idempotency_key to ogc_app;
-- the stored result is written after the work, in the same transaction
grant update (status_code, response) on idempotency_key to ogc_app;
grant execute on function ogc_current_org() to ogc_app;
