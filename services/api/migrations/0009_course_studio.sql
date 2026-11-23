-- Course Studio on the Platform (owner 23/11, slice 3 part A): courses OGC authors itself. The rules
-- of the demo's mock adapter (apps/web/src/lib/adapters/mockCourseAuthoring.ts, owner decisions
-- 22/11), on PostgreSQL. SYNTHETIC content only; no EduOS code or content.
--  - a course is lessons, a lesson an ordered list of typed blocks (validated by the API with the
--    contracts' fail-closed validator; stored as jsonb);
--  - draft → submit → a DIFFERENT person approves → an IMMUTABLE published version (v1, v2, …).
--    Versions and review events are insert-only for the application, and a trigger refuses any
--    UPDATE even to the owner role;
--  - teachers edit their own courses, staff every course of their org (courses:author); staff
--    approve, never the person who submitted nor anyone who edited the draft since the last
--    publication.

create table authored_course (
  org_id             uuid not null,
  ref                text not null check (ref ~ '^CS-[A-Z0-9-]{2,30}$'),
  owner_teacher_id   text,          -- a teacher's own course; null = created by staff
  owner_principal_id text not null, -- IIOS principal (data, never authority)
  owner_name         text not null,
  draft              jsonb not null,
  revision           integer not null check (revision >= 1),
  editors            jsonb not null default '[]', -- [{id, name}] since the last publication
  pending_content    jsonb,
  pending_by         text,          -- IIOS principal who submitted
  pending_by_name    text,
  pending_at         timestamptz,
  updated_at         timestamptz not null,
  primary key (org_id, ref),
  check ((pending_content is null) = (pending_by is null)
     and (pending_content is null) = (pending_at is null)
     and (pending_content is null) = (pending_by_name is null)),
  check (octet_length(draft::text) <= 262144),
  foreign key (org_id, owner_teacher_id) references teacher (org_id, id)
);

create table course_version (
  org_id         uuid not null,
  course_ref     text not null,
  version        integer not null check (version >= 1),
  content        jsonb not null,
  submitted_by   text not null,  -- display names, as the demo shows them
  approved_by    text not null,
  published_at   timestamptz not null,
  note           text check (length(note) <= 300),
  primary key (org_id, course_ref, version),
  foreign key (org_id, course_ref) references authored_course (org_id, ref)
);

create table course_review (
  org_id     uuid not null,
  course_ref text not null,
  seq        integer not null check (seq >= 1),
  at         timestamptz not null,
  by_name    text not null,
  action     text not null check (action in ('submitted', 'withdrawn', 'approved', 'returned')),
  version    integer,
  note       text check (length(note) <= 300),
  primary key (org_id, course_ref, seq),
  check ((action = 'approved') = (version is not null)),
  foreign key (org_id, course_ref) references authored_course (org_id, ref)
);

-- A published version and the review history never change.
create function ogc_refuse_update() returns trigger language plpgsql as $$
begin
  raise exception '% rows are immutable', tg_table_name;
end $$;
create trigger course_version_immutable before update on course_version
  for each row execute function ogc_refuse_update();
create trigger course_review_immutable before update on course_review
  for each row execute function ogc_refuse_update();

do $$
declare t text;
begin
  foreach t in array array['authored_course', 'course_version', 'course_review'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I using (org_id = ogc_current_org()) with check (org_id = ogc_current_org())',
      t || '_tenant', t);
    execute format('revoke all on %I from public', t);
    execute format('grant select, insert on %I to ogc_app', t);
  end loop;
end $$;

grant update (draft, revision, editors, pending_content, pending_by, pending_by_name, pending_at, updated_at)
  on authored_course to ogc_app;
