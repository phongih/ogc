-- MOCK IIOS policy store (OGC-ADR-039 option C, ADR-040). Its own database (`iios_mock`), its own
-- role; the OGC API's roles have no access. Synthetic data only.

create table iios_policy (
  ref          text primary key,
  org_id       uuid not null,
  name         text not null check (length(name) between 3 and 100),
  description  text,
  status       text not null check (status in ('active', 'retired')),
  rules        jsonb not null,
  version      int not null check (version >= 1),
  updated_at   timestamptz not null
);
create unique index iios_policy_org_name on iios_policy (org_id, lower(name));

-- Append-only: one row per version, never changed or removed.
create table iios_policy_history (
  ref          text not null references iios_policy (ref),
  version      int not null,
  change       text not null check (change in ('created', 'revised', 'retired')),
  status       text not null,
  description  text,
  rules        jsonb not null,
  changed_by   text not null,
  changed_at   timestamptz not null,
  primary key (ref, version)
);
create function iios_history_no_change() returns trigger language plpgsql as $$
begin
  raise exception 'iios_policy_history is append-only';
end $$;
create trigger iios_policy_history_no_change before update or delete or truncate
  on iios_policy_history for each statement execute function iios_history_no_change();

-- Which member has which policy (at most one).
create table iios_attachment (
  principal_id text primary key,
  org_id       uuid not null,
  policy_ref   text not null references iios_policy (ref)
);
