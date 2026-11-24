-- Mission Box (owner 24/11, Course Studio blocks part B). A real-world task in a lesson: completing
-- the lesson confirms it with the learner's optional note (attempt 1, pending); the CLASS TEACHER
-- approves it or returns it with a note, and a returned mission may be sent again (attempt 2, …).
-- Like a speaking review — but a mission is never skill evidence: an approval earns XP only
-- (Rewards "Mission approved" + the "Explorer" badge). SYNTHETIC content only.

create table course_mission_attempt (
  org_id       uuid not null,
  learner_id   text not null,
  course_ref   text not null,
  lesson_id    text not null,
  block_id     text not null check (length(block_id) between 1 and 64),
  attempt      integer not null check (attempt between 1 and 50),
  note         text not null default '' check (length(note) <= 300),
  submitted_at timestamptz not null,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'returned')),
  reviewed_at  timestamptz,
  reviewed_by  text,  -- display name, as the screens show it
  review_note  text check (length(review_note) between 3 and 300),
  primary key (org_id, learner_id, course_ref, lesson_id, block_id, attempt),
  check ((status = 'pending') = (reviewed_at is null)),
  check ((status = 'pending') = (reviewed_by is null)),
  check (status <> 'returned' or review_note is not null),
  foreign key (org_id, learner_id, course_ref, lesson_id)
    references course_lesson_done (org_id, learner_id, course_ref, lesson_id)
);
-- At most one mission waiting per block.
create unique index course_mission_attempt_one_pending
  on course_mission_attempt (org_id, learner_id, course_ref, lesson_id, block_id)
  where status = 'pending';

-- A review is decided once: pending → approved | returned; nothing else ever changes.
create function ogc_mission_review_once() returns trigger language plpgsql as $$
begin
  if old.status <> 'pending' or new.status not in ('approved', 'returned')
     or (new.org_id, new.learner_id, new.course_ref, new.lesson_id, new.block_id, new.attempt,
         new.note, new.submitted_at)
        is distinct from
        (old.org_id, old.learner_id, old.course_ref, old.lesson_id, old.block_id, old.attempt,
         old.note, old.submitted_at) then
    raise exception 'a mission review is decided once';
  end if;
  return new;
end $$;
create trigger course_mission_attempt_review_once before update on course_mission_attempt
  for each row execute function ogc_mission_review_once();

alter table course_mission_attempt enable row level security;
alter table course_mission_attempt force row level security;
create policy course_mission_attempt_tenant on course_mission_attempt
  using (org_id = ogc_current_org()) with check (org_id = ogc_current_org());
revoke all on course_mission_attempt from public;
grant select, insert on course_mission_attempt to ogc_app;
grant update (status, reviewed_at, reviewed_by, review_note) on course_mission_attempt to ogc_app;

-- The closed Rewards catalog grows by one reward and one badge (staff tune them with rewards:manage).
alter table reward_rule drop constraint reward_rule_kind_check;
alter table reward_rule add constraint reward_rule_kind_check
  check (kind in ('activity_completed', 'practice_scored', 'speaking_approved', 'makeup_done', 'mission_approved'));
alter table badge_rule drop constraint badge_rule_kind_check;
alter table badge_rule add constraint badge_rule_kind_check
  check (kind in ('first_activity', 'perfect_score', 'speaking_approved', 'makeup_on_time', 'streak', 'level', 'explorer'));
