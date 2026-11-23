-- Class courses + My Learning on the Platform (owner 23/11, slice 3 part B). The rules of the demo's
-- mock adapters (mockStudioLinks.ts, courseProgress.ts, mockClassCoursePlayer.ts; owner decisions
-- 22/11), on PostgreSQL. SYNTHETIC content only.
--  - a class follows one published OGC course: the class teacher PROPOSES, center staff
--    (courses:link, by center) LINK it — or reject / unlink with a reason; weekly prep hours on a
--    link (0–10, half hours) count for the class teacher in Workforce;
--  - a learner of the class takes the course in My Learning, PINNED to the version of their first
--    completed lesson; a completed lesson is final (insert-only) and keeps its quiz score.

create table class_course_link (
  org_id          uuid not null,
  id              text not null check (id ~ '^SL-[0-9]{1,6}$'),
  class_id        text not null,
  course_ref      text not null,
  status          text not null check (status in ('proposed', 'linked', 'rejected', 'unlinked')),
  prep_hours      numeric(3, 1) not null default 0
                  check (prep_hours >= 0 and prep_hours <= 10 and prep_hours * 2 = trunc(prep_hours * 2)),
  proposed_by     text,  -- display names, as the demo shows them
  proposed_at     timestamptz,
  decided_by      text,
  decided_at      timestamptz,
  reason          text check (length(reason) between 3 and 200),
  primary key (org_id, id),
  check ((status in ('rejected', 'unlinked')) = (reason is not null)),
  foreign key (org_id, class_id) references class (org_id, id),
  foreign key (org_id, course_ref) references authored_course (org_id, ref)
);
-- One course a class follows at a time; one open proposal per class and course.
create unique index class_course_link_one_linked on class_course_link (org_id, class_id)
  where status = 'linked';
create unique index class_course_link_one_proposal on class_course_link (org_id, class_id, course_ref)
  where status = 'proposed';

create table course_progress (
  org_id     uuid not null,
  learner_id text not null,
  course_ref text not null,
  version    integer not null,  -- pinned: the version of the first completed lesson
  primary key (org_id, learner_id, course_ref),
  foreign key (org_id, learner_id) references learner (org_id, id),
  foreign key (org_id, course_ref, version) references course_version (org_id, course_ref, version)
);

create table course_lesson_done (
  org_id      uuid not null,
  learner_id  text not null,
  course_ref  text not null,
  lesson_id   text not null check (length(lesson_id) between 1 and 64),
  at          timestamptz not null,
  score       integer check (score between 0 and 100),
  answers     jsonb not null default '{}',
  reflections jsonb not null default '{}',
  primary key (org_id, learner_id, course_ref, lesson_id),
  foreign key (org_id, learner_id, course_ref) references course_progress (org_id, learner_id, course_ref)
);
create trigger course_lesson_done_immutable before update on course_lesson_done
  for each row execute function ogc_refuse_update();
create trigger course_progress_immutable before update on course_progress
  for each row execute function ogc_refuse_update();

do $$
declare t text;
begin
  foreach t in array array['class_course_link', 'course_progress', 'course_lesson_done'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format(
      'create policy %I on %I using (org_id = ogc_current_org()) with check (org_id = ogc_current_org())',
      t || '_tenant', t);
    execute format('revoke all on %I from public', t);
    execute format('grant select, insert on %I to ogc_app', t);
  end loop;
end $$;

grant update (status, prep_hours, decided_by, decided_at, reason) on class_course_link to ogc_app;
