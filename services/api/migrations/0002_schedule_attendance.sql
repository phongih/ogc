-- OGC Platform — 0002 schedule & attendance (ADR-040 §7 step 3). Forward-only.
-- Ids are text (they keep the demo's synthetic ids); the tenant root `org_id` is a uuid.
-- Every child row references its parent by (org_id, id), so a row can never point at another
-- organization's center, class, teacher or learner — even though foreign-key checks bypass RLS.

create table center (
  org_id uuid not null,
  id     text not null check (length(id) between 1 and 64),
  name   text not null,
  primary key (id),
  unique (org_id, id)
);

-- OGC's own records of people. `principal_id` links a record to the IIOS principal; it is data
-- (which teacher is this), never authority (what may they do — that comes from the grant).
create table teacher (
  org_id       uuid not null,
  id           text not null check (length(id) between 1 and 64),
  principal_id text,
  name         text not null,
  primary key (id),
  unique (org_id, id),
  unique (org_id, principal_id)
);

create table learner (
  org_id       uuid not null,
  id           text not null check (length(id) between 1 and 64),
  principal_id text,
  display_name text not null,
  primary key (id),
  unique (org_id, id)
);

create table class (
  org_id       uuid not null,
  id           text not null check (length(id) between 1 and 64),
  center_id    text not null,
  name         text not null,
  teacher_id   text,
  room         text,
  duration_min int not null default 90 check (duration_min between 15 and 480),
  primary key (id),
  unique (org_id, id),
  foreign key (org_id, center_id) references center (org_id, id),
  foreign key (org_id, teacher_id) references teacher (org_id, id)
);

create table roster (
  org_id     uuid not null,
  class_id   text not null,
  learner_id text not null,
  primary key (class_id, learner_id),
  foreign key (org_id, class_id) references class (org_id, id),
  foreign key (org_id, learner_id) references learner (org_id, id)
);

create table session (
  org_id        uuid not null,
  id            text not null check (length(id) between 1 and 64),
  class_id      text not null,
  title         text not null check (length(title) between 1 and 120),
  at            timestamptz not null,
  state         text not null default 'scheduled' check (state in ('scheduled', 'cancelled')),
  kind          text not null default 'regular' check (kind in ('regular', 'makeup')),
  substitute_id text,
  held_by       text,  -- class teacher when it started, if the class has a new teacher since
  replaced_by   text,
  replaces      text,
  primary key (id),
  unique (org_id, id),
  foreign key (org_id, class_id) references class (org_id, id),
  foreign key (org_id, substitute_id) references teacher (org_id, id),
  foreign key (org_id, held_by) references teacher (org_id, id),
  foreign key (org_id, replaced_by) references session (org_id, id),
  foreign key (org_id, replaces) references session (org_id, id)
);
create index session_class_at on session (class_id, at);
create index session_org_at on session (org_id, at);

create table attendance (
  org_id     uuid not null,
  session_id text not null,
  learner_id text not null,
  mark       text not null check (mark in ('present', 'late', 'absent')),
  marked_by  text not null,  -- IIOS principal
  marked_at  timestamptz not null default now(),
  primary key (session_id, learner_id),
  foreign key (org_id, session_id) references session (org_id, id),
  foreign key (org_id, learner_id) references learner (org_id, id)
);

-- Row-level security on every table, forced, keyed on the DAK's transaction setting.
do $$
declare t text;
begin
  foreach t in array array['center', 'teacher', 'learner', 'class', 'roster', 'session', 'attendance'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I using (org_id = ogc_current_org()) with check (org_id = ogc_current_org())',
      t || '_tenant', t);
    execute format('revoke all on %I from public', t);
    execute format('grant select on %I to ogc_app', t);
  end loop;
end $$;

-- What the application may change: sessions (schedule), the class teacher, attendance marks.
-- Reference data (centers, people, classes, rosters) is loaded by the owner role.
grant insert on session to ogc_app;
grant update (at, state, substitute_id, held_by, replaced_by) on session to ogc_app;
grant update (teacher_id) on class to ogc_app;
grant insert on attendance to ogc_app;
grant update (mark, marked_by, marked_at) on attendance to ogc_app;
