-- Public course showcase (owner 23/11). Staff choose which Course Studio courses the public page
-- shows (outside the immutable versions); visitors enquire without signing in; an enquiry becomes
-- an Admissions lead with its origin. SYNTHETIC data only.

-- Organizations with a public page: a directory (slug → organization) anyone may read, so the
-- public page finds the organization without a grant. Set by the seed / operators only.
create table public_org (
  slug   text primary key check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 40),
  org_id uuid not null unique,
  name   text not null check (length(name) between 2 and 80)
);
alter table public_org enable row level security;
alter table public_org force row level security;
create policy public_org_lookup on public_org for select using (true);
-- written by the owner role only (seed / operators), within the organization in scope
create policy public_org_add on public_org for insert with check (org_id = ogc_current_org());
revoke all on public_org from public;
grant select on public_org to ogc_app;

create table course_showcase (
  org_id       uuid not null,
  course_ref   text not null,
  is_public    boolean not null,
  offer        text not null check (offer in ('free', 'trial', 'paid')),
  catalog_code text,
  needs        text[] not null default '{}',
  updated_by   text not null,
  updated_at   timestamptz not null,
  primary key (org_id, course_ref),
  check (not is_public or catalog_code is not null),
  check (needs <@ array['exam_prep', 'speaking_confidence', 'school_support', 'work_english',
                        'travel', 'young_learner']::text[]),
  foreign key (org_id, course_ref) references authored_course (org_id, ref),
  foreign key (org_id, catalog_code) references course (org_id, code)
);
alter table course_showcase enable row level security;
alter table course_showcase force row level security;
create policy course_showcase_tenant on course_showcase
  using (org_id = ogc_current_org()) with check (org_id = ogc_current_org());
revoke all on course_showcase from public;
grant select, insert on course_showcase to ogc_app;
grant update (is_public, offer, catalog_code, needs, updated_by, updated_at) on course_showcase to ogc_app;

-- Where a lead came from on the public page (null for every other lead).
alter table lead add column origin text check (length(origin) between 3 and 200);
