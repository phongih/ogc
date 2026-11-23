-- Make-up ledger on the Platform (ADR-040 §7; the demo's rules, owner decisions 21/11 + 23/11).
-- Make-up ITEMS are not stored: every absent mark at a regular session of the learner's own class
-- is an item, derived on read, so none can be forgotten or deleted by hand. Stored here is only
-- how an item is being made up: a booking into a session, or self-study.

-- Classes of the same course teach the same units: a learner may join another class's session.
alter table class add column course_id text check (course_id is null or length(course_id) between 1 and 64);

-- Guardian ↔ learner links: synthetic seed only. `ogc_app` may read them and nothing else — there
-- is no path to create a link (D-14 stays closed).
create table guardian_link (
  org_id                uuid not null,
  guardian_principal_id text not null check (length(guardian_principal_id) between 1 and 128),
  learner_id            text not null,
  primary key (org_id, guardian_principal_id, learner_id),
  foreign key (org_id, learner_id) references learner (org_id, id)
);

-- One arrangement per item: either a booking (join another class / a make-up session) or self-study.
create table makeup_booking (
  org_id            uuid not null,
  missed_session_id text not null,
  learner_id        text not null,
  session_id        text not null,
  booked_by         text not null,
  booked_at         timestamptz not null default now(),
  primary key (org_id, missed_session_id, learner_id),
  foreign key (org_id, missed_session_id) references session (org_id, id),
  foreign key (org_id, learner_id) references learner (org_id, id),
  foreign key (org_id, session_id) references session (org_id, id)
);
create index makeup_booking_session on makeup_booking (org_id, session_id);

create table makeup_selfstudy (
  org_id            uuid not null,
  missed_session_id text not null,
  learner_id        text not null,
  assigned_by       text not null,
  assigned_at       timestamptz not null default now(),
  submitted_at      timestamptz,
  note              text check (note is null or length(note) between 10 and 2000),
  returned_note     text check (returned_note is null or length(returned_note) between 1 and 2000),
  confirmed_at      timestamptz,
  confirmed_by      text,
  primary key (org_id, missed_session_id, learner_id),
  foreign key (org_id, missed_session_id) references session (org_id, id),
  foreign key (org_id, learner_id) references learner (org_id, id)
);

do $$
declare t text;
begin
  foreach t in array array['guardian_link', 'makeup_booking', 'makeup_selfstudy'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I using (org_id = ogc_current_org()) with check (org_id = ogc_current_org())',
      t || '_tenant', t);
    execute format('revoke all on %I from public', t);
    execute format('grant select on %I to ogc_app', t);
  end loop;
end $$;

-- What the application may change: arrangements (an item is booked OR self-study, so switching
-- deletes the other), self-study progress, and the session kind it creates ('makeup').
grant insert, delete on makeup_booking to ogc_app;
grant insert, delete on makeup_selfstudy to ogc_app;
grant update (submitted_at, note, returned_note, confirmed_at, confirmed_by) on makeup_selfstudy to ogc_app;
