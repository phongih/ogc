-- Partner Commissions, part B (owner 23/11): settlement batches and partner reports. SYNTHETIC: a
-- mock receivable, nothing is invoiced or paid.
--  - staff draft a batch from approved entries of one partner and enrolment cycle; an Org Admin
--    who did not draft it sends it — then it is locked; the partner pays the WHOLE batch and staff
--    record it (every entry becomes paid); a wrong batch is cancelled with a reason (a sent one by
--    an Org Admin) and its entries go back to "approved";
--  - partner reports are previewed against the ledger; a person applies one row at a time (no
--    table: applying is an ordinary enrolment / rejection, logged).

create table settlement_batch (
  org_id          uuid not null,
  id              text not null check (id ~ '^ST-[A-Z0-9]{2,20}-[0-9]{2,4}$'),
  partner_id      text not null,
  cycle_key       text not null,
  cycle_label     text not null,
  status          text not null check (status in ('draft', 'sent', 'paid', 'cancelled')),
  created_by      text not null,  -- IIOS principal (maker-checker)
  created_by_name text not null,
  created_at      timestamptz not null,
  sent_by_name    text,
  sent_at         timestamptz,
  due_date        timestamptz,
  paid_by_name    text,
  paid_at         timestamptz,
  payment_ref     text check (payment_ref ~ '^[A-Za-z0-9-]{3,30}$'),
  cancel_reason   text check (length(cancel_reason) between 3 and 200),
  primary key (org_id, id),
  check ((status in ('sent', 'paid')) = (sent_at is not null) or status = 'cancelled'),
  check ((status = 'paid') = (payment_ref is not null)),
  foreign key (org_id, partner_id) references partner (org_id, id)
);

create table settlement_batch_entry (
  org_id   uuid not null,
  batch_id text not null,
  entry_id text not null,
  primary key (org_id, batch_id, entry_id),
  foreign key (org_id, batch_id) references settlement_batch (org_id, id),
  foreign key (org_id, entry_id) references commission_entry (org_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['settlement_batch', 'settlement_batch_entry'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I using (org_id = ogc_current_org()) with check (org_id = ogc_current_org())',
      t || '_tenant', t);
    execute format('revoke all on %I from public', t);
    execute format('grant select on %I to ogc_app', t);
  end loop;
end $$;

grant insert on settlement_batch, settlement_batch_entry to ogc_app;
grant update (status, sent_by_name, sent_at, due_date, paid_by_name, paid_at, payment_ref, cancel_reason)
  on settlement_batch to ogc_app;
grant update (settled_batch_id) on commission_entry to ogc_app;
