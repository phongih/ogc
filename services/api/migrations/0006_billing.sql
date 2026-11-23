-- Billing on the Platform (owner 23/11: "đủ như demo"; no referral wallet yet; a paid first invoice
-- only moves the lead, it creates no learner). SYNTHETIC: nothing is charged, paid or sent.
--  - fee lines: staff propose, an Org Admin approves (never their own proposal); an approved line is
--    never edited, only retired;
--  - invoices: one per learner per fee line, ever; a lead's first invoice moves it to "offer";
--  - payments are append-only; an invoice with a payment is never voided.

-- Who pays a learner's tuition: their guardian (guardian_link), or the learner themselves when
-- they pay their own (an adult with an account). Synthetic flags, set by the seed only.
alter table learner add column pays_own_tuition boolean not null default false;
alter table guardian_link add column guardian_name text check (length(guardian_name) between 1 and 80);

create table fee_line (
  org_id            uuid not null,
  id                text not null check (id ~ '^FL-[0-9]{1,9}$'),
  year              text not null check (year ~ '^[0-9]{4}-[0-9]{4}$'),
  course_code       text not null,
  center_id         text,  -- null = every center of the organization
  kind              text not null check (kind in ('tuition', 'materials')),
  period            text not null check (length(period) between 2 and 30),
  from_date         date not null,
  to_date           date not null,
  due_date          date not null,
  amount_vnd        bigint not null check (amount_vnd between 1000 and 500000000),
  status            text not null check (status in ('pending', 'approved', 'rejected', 'retired')),
  proposed_by       text not null,  -- IIOS principal
  proposed_by_name  text not null,
  proposed_at       timestamptz not null,
  decided_by_name   text,
  decided_at        timestamptz,
  note              text check (length(note) <= 200),
  primary key (org_id, id),
  check (from_date <= to_date and due_date <= to_date),
  foreign key (org_id, course_code) references course (org_id, code),
  foreign key (org_id, center_id) references center (org_id, id)
);

create table invoice (
  org_id             uuid not null,
  id                 text not null check (id ~ '^I-[0-9]{1,9}$'),
  no                 text not null check (no ~ '^INV-[0-9]{4}-[0-9]{4,}$'),
  center_id          text not null,
  learner_name       text not null,
  learner_id         text,
  lead_id            text,
  payer_principal_id text,
  payer_name         text,
  subtotal_vnd       bigint not null check (subtotal_vnd > 0),
  credit_applied_vnd bigint not null default 0 check (credit_applied_vnd = 0),  -- no wallet yet
  issued_at          timestamptz not null,
  due_date           date not null,
  void_reason        text check (length(void_reason) between 3 and 200),
  voided_at          timestamptz,
  primary key (org_id, id),
  unique (org_id, no),
  check ((learner_id is null) <> (lead_id is null)),
  check ((void_reason is null) = (voided_at is null)),
  foreign key (org_id, center_id) references center (org_id, id),
  foreign key (org_id, learner_id) references learner (org_id, id),
  foreign key (org_id, lead_id) references lead (org_id, id)
);

create table invoice_line (
  org_id      uuid not null,
  invoice_id  text not null,
  fee_line_id text not null,
  description text not null,
  amount_vnd  bigint not null check (amount_vnd > 0),
  primary key (org_id, invoice_id, fee_line_id),
  foreign key (org_id, invoice_id) references invoice (org_id, id),
  foreign key (org_id, fee_line_id) references fee_line (org_id, id)
);

create table payment (
  org_id      uuid not null,
  id          text not null check (id ~ '^P-[0-9]{1,9}$'),
  invoice_id  text not null,
  amount_vnd  bigint not null check (amount_vnd > 0),
  method      text not null check (method in ('cash', 'bank_transfer', 'card')),
  receipt_no  text not null check (receipt_no ~ '^RC-[0-9]{4}-[0-9]{4,}$'),
  at          timestamptz not null,
  recorded_by text not null,
  primary key (org_id, id),
  unique (org_id, receipt_no),
  foreign key (org_id, invoice_id) references invoice (org_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['fee_line', 'invoice', 'invoice_line', 'payment'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I using (org_id = ogc_current_org()) with check (org_id = ogc_current_org())',
      t || '_tenant', t);
    execute format('revoke all on %I from public', t);
    execute format('grant select on %I to ogc_app', t);
  end loop;
end $$;

grant insert on fee_line, invoice, invoice_line, payment to ogc_app;
grant update (status, decided_by_name, decided_at, note) on fee_line to ogc_app;
grant update (void_reason, voided_at) on invoice to ogc_app;
