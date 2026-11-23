-- Speaking review (owner 23/11, slice 5). A speaking rehearsal is a Course Studio block: at each
-- turn the learner picks a reply. Completing the lesson submits the rehearsal (attempt 1); it
-- counts for the Speaking skill only once the CLASS TEACHER approves it. The teacher may return it
-- with a note instead; the learner then tries again (attempt 2, …). Center staff see the queue but
-- do not review. SYNTHETIC content only.

-- The replies chosen in a completed lesson (speaking block id → option per turn). A completed
-- lesson stays insert-only; existing rows get '{}'.
alter table course_lesson_done add column speaking jsonb not null default '{}';

create table course_speaking_attempt (
  org_id      uuid not null,
  learner_id  text not null,
  course_ref  text not null,
  lesson_id   text not null,
  block_id    text not null check (length(block_id) between 1 and 64),
  attempt     integer not null check (attempt between 1 and 50),
  choices     jsonb not null,
  score       integer not null check (score between 0 and 100),
  submitted_at timestamptz not null,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'returned')),
  reviewed_at timestamptz,
  reviewed_by text,  -- display name, as the screens show it
  note        text check (length(note) between 3 and 300),
  primary key (org_id, learner_id, course_ref, lesson_id, block_id, attempt),
  check ((status = 'pending') = (reviewed_at is null)),
  check ((status = 'pending') = (reviewed_by is null)),
  check (status <> 'returned' or note is not null),
  foreign key (org_id, learner_id, course_ref, lesson_id)
    references course_lesson_done (org_id, learner_id, course_ref, lesson_id)
);
-- At most one rehearsal waiting per block.
create unique index course_speaking_attempt_one_pending
  on course_speaking_attempt (org_id, learner_id, course_ref, lesson_id, block_id)
  where status = 'pending';

-- A review is decided once: pending → approved | returned; nothing else ever changes.
create function ogc_speaking_review_once() returns trigger language plpgsql as $$
begin
  if old.status <> 'pending' or new.status not in ('approved', 'returned')
     or (new.org_id, new.learner_id, new.course_ref, new.lesson_id, new.block_id, new.attempt,
         new.choices, new.score, new.submitted_at)
        is distinct from
        (old.org_id, old.learner_id, old.course_ref, old.lesson_id, old.block_id, old.attempt,
         old.choices, old.score, old.submitted_at) then
    raise exception 'a speaking review is decided once';
  end if;
  return new;
end $$;
create trigger course_speaking_attempt_review_once before update on course_speaking_attempt
  for each row execute function ogc_speaking_review_once();

alter table course_speaking_attempt enable row level security;
alter table course_speaking_attempt force row level security;
create policy course_speaking_attempt_tenant on course_speaking_attempt
  using (org_id = ogc_current_org()) with check (org_id = ogc_current_org());
revoke all on course_speaking_attempt from public;
grant select, insert on course_speaking_attempt to ogc_app;
grant update (status, reviewed_at, reviewed_by, note) on course_speaking_attempt to ogc_app;
