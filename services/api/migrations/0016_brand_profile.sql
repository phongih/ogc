-- Brand & provider profile (owner 24/11): the organization's public profile, teachers' own opt-in
-- public profiles and badges verified maker-checker. SYNTHETIC data only — no real people, no
-- real Credly data (the Credly check is a fake that never calls the network).

create table brand_profile (
  org_id        uuid primary key,
  tagline       text not null default '' check (length(tagline) <= 120),
  about         text not null default '' check (length(about) <= 1200),
  primary_color text not null check (primary_color ~ '^#[0-9a-f]{6}$'),
  accent_color  text not null check (accent_color ~ '^#[0-9a-f]{6}$'),
  updated_by    text not null,
  updated_at    timestamptz not null
);
alter table brand_profile enable row level security;
alter table brand_profile force row level security;
create policy brand_profile_tenant on brand_profile
  using (org_id = ogc_current_org()) with check (org_id = ogc_current_org());
revoke all on brand_profile from public;
grant select, insert on brand_profile to ogc_app;
grant update (tagline, about, primary_color, accent_color, updated_by, updated_at) on brand_profile to ogc_app;

-- A teacher's own public profile: only the teacher writes it (API); off = gone from the public.
-- No photo, no contact details.
create table teacher_profile (
  org_id       uuid not null,
  teacher_id   text not null,
  is_public    boolean not null,
  display_name text not null check (length(display_name) between 2 and 40),
  bio          text not null default '' check (length(bio) <= 400),
  updated_at   timestamptz not null,
  primary key (org_id, teacher_id),
  foreign key (org_id, teacher_id) references teacher (org_id, id)
);
alter table teacher_profile enable row level security;
alter table teacher_profile force row level security;
create policy teacher_profile_tenant on teacher_profile
  using (org_id = ogc_current_org()) with check (org_id = ogc_current_org());
revoke all on teacher_profile from public;
grant select, insert on teacher_profile to ogc_app;
grant update (is_public, display_name, bio, updated_at) on teacher_profile to ogc_app;

-- A badge of the organization (teacher_id null) or of one teacher. Claimed once; then verified or
-- rejected ONCE by someone other than the claimant; a claimed or verified badge may be withdrawn.
create table credential (
  org_id          uuid not null,
  id              text not null check (id ~ '^CR-[0-9]{1,6}$'),
  teacher_id      text,
  title           text not null check (length(title) between 3 and 100),
  issuer          text not null check (length(issuer) between 2 and 80),
  source          text not null check (source in ('credly_mock', 'certificate')),
  badge_code      text not null check (badge_code ~ '^[A-Z0-9][A-Z0-9-]{3,39}$'),
  issued_on       date not null,
  expires_on      date check (expires_on > issued_on),
  claimed_by      text not null, -- principal id
  claimed_by_name text not null,
  claimed_at      timestamptz not null,
  status          text not null default 'claimed'
                  check (status in ('claimed', 'verified', 'rejected', 'withdrawn')),
  decided_by      text, -- principal id of the verifier / rejecter
  decided_by_name text,
  decided_at      timestamptz,
  note            text check (length(note) between 3 and 200), -- the check made / the reason
  withdrawn_by_name text,
  withdrawn_at    timestamptz,
  withdraw_reason text check (length(withdraw_reason) between 3 and 200),
  primary key (org_id, id),
  unique (org_id, source, badge_code),
  foreign key (org_id, teacher_id) references teacher (org_id, id),
  -- maker-checker: the claimant never verifies or rejects their own badge
  check (decided_by is null or decided_by <> claimed_by),
  check (status not in ('verified', 'rejected') or decided_by is not null),
  check (status <> 'claimed' or decided_by is null),
  check ((decided_by is null) = (decided_at is null) and (decided_by is null) = (decided_by_name is null)),
  check ((status = 'withdrawn') = (withdrawn_at is not null)
     and (withdrawn_at is null) = (withdrawn_by_name is null)
     and (withdrawn_at is null) = (withdraw_reason is null))
);
alter table credential enable row level security;
alter table credential force row level security;
create policy credential_tenant on credential
  using (org_id = ogc_current_org()) with check (org_id = ogc_current_org());
revoke all on credential from public;
grant select, insert on credential to ogc_app;
grant update (status, decided_by, decided_by_name, decided_at, note, withdrawn_by_name, withdrawn_at, withdraw_reason)
  on credential to ogc_app;

-- Only these moves: claimed → verified / rejected / withdrawn; verified → withdrawn. A decision is
-- made once (who verified stays when the badge is later withdrawn).
create function ogc_credential_move() returns trigger language plpgsql as $$
begin
  if old.decided_by is not null and (new.decided_by is distinct from old.decided_by
       or new.decided_at is distinct from old.decided_at or new.note is distinct from old.note) then
    raise exception 'credential % was already decided', old.id using errcode = 'check_violation';
  end if;
  if not ((old.status = 'claimed' and new.status in ('verified', 'rejected', 'withdrawn'))
       or (old.status = 'verified' and new.status = 'withdrawn')) then
    raise exception 'credential % cannot move from % to %', old.id, old.status, new.status
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger credential_move before update on credential
  for each row execute function ogc_credential_move();
