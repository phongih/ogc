-- Skill profile on the Platform (owner 23/11, slice "skill profile + Current Students", PR A). A
-- learner's profile starts from a SYNTHETIC placement result (the demo's seed per learner,
-- labelled "placement test only" wherever it is shown) and moves with assessed evidence — on the
-- Platform today, the quiz scores of class-course lessons (Use of English). The mastery fold is
-- the shared, pure one in @ogc/contracts (mastery.ts); nothing is stored but the placement.
-- Loaded by the owner role (seed); the application only reads it.

create table placement_result (
  org_id         uuid not null,
  learner_id     text not null,
  cefr_band      text not null check (cefr_band in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
  reading        integer not null check (reading between 0 and 100),
  use_of_english integer not null check (use_of_english between 0 and 100),
  speaking       integer not null check (speaking between 0 and 100),
  primary key (org_id, learner_id),
  foreign key (org_id, learner_id) references learner (org_id, id)
);

alter table placement_result enable row level security;
alter table placement_result force row level security;
create policy placement_result_tenant on placement_result
  using (org_id = ogc_current_org()) with check (org_id = ogc_current_org());
revoke all on placement_result from public;
grant select on placement_result to ogc_app;
