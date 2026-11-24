-- p01b_r2_person.sql — C14/D-14 remediation (r2). Applied AFTER p01 as bootstrap.
-- Does NOT modify frozen r1 files. Synthetic harness only; not OGC product code.
-- Scope: add organization-scoped natural-person identity + principal→person linkage,
-- extend _fail allowlist with two deterministic codes, and enforce person-level
-- self-verification prohibition in authz.verify_guardian_link (D-14).
\set ON_ERROR_STOP on
SET ROLE iios_owner;   -- keep r1 ownership: all objects owned by iios_owner

-- ── 1. Person identity (authoritative, owner-written, NOT runtime-declarable) ──
-- person_id is organization-scoped. principal_persons maps each principal to exactly
-- one natural person (PK on principal_id). A person may own several principals.
CREATE TABLE authz.persons (
  org_id     uuid NOT NULL,
  person_id  uuid NOT NULL,
  source     text NOT NULL,          -- trusted identity source (onboarding ceremony)
  source_ref text,                   -- reconciliation ref; no free PII
  PRIMARY KEY (org_id, person_id)
);
COMMENT ON TABLE authz.persons IS 'iios:class=authz_identity';

CREATE TABLE authz.principal_persons (
  org_id       uuid NOT NULL,
  principal_id uuid NOT NULL,
  person_id    uuid NOT NULL,
  linked_by    uuid NOT NULL,                       -- principal that performed the link (ceremony)
  linked_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (org_id, principal_id),               -- each principal belongs to ONE person
  FOREIGN KEY (org_id, principal_id) REFERENCES authz.principals (org_id, principal_id),
  FOREIGN KEY (org_id, person_id)    REFERENCES authz.persons (org_id, person_id)
);
COMMENT ON TABLE authz.principal_persons IS 'iios:class=authz_identity';

-- RLS + FORCE, consistent with every org-scoped authz table. Owner may read its own
-- org's rows (definer functions run as iios_owner). Runtime (iios_app) receives NO
-- grant and NO policy, so it can neither read nor write these tables — a person link
-- is therefore NOT runtime-declarable. Writes happen only via the owner (onboarding).
ALTER TABLE authz.persons            ENABLE ROW LEVEL SECURITY; ALTER TABLE authz.persons            FORCE ROW LEVEL SECURITY;
ALTER TABLE authz.principal_persons  ENABLE ROW LEVEL SECURITY; ALTER TABLE authz.principal_persons  FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_org ON authz.persons           FOR SELECT TO iios_owner USING (org_id = (SELECT iios.org_of_session()));
CREATE POLICY owner_org ON authz.principal_persons FOR SELECT TO iios_owner USING (org_id = (SELECT iios.org_of_session()));
REVOKE ALL ON authz.persons           FROM PUBLIC;
REVOKE ALL ON authz.principal_persons FROM PUBLIC;

-- ── 2. Extend _fail allowlist with the two new deterministic codes ─────────────
-- Identical to r1 _fail except the code allowlist gains AZ_SELF_VERIFY and
-- AZ_IDENTITY_UNKNOWN. Message is still one of the fixed codes, never caller text.
CREATE OR REPLACE FUNCTION authz._fail(p_code text, p_fn text, p_claimed_type text, p_claimed_id uuid, p_digest text)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE v_code text := CASE WHEN p_code IN ('AZ_DENIED', 'AZ_NO_PRINCIPAL', 'AZ_BIND_KEY', 'AZ_BIND_MAC', 'AZ_BIND_EXPIRED', 'AZ_BIND_EXP_RANGE',
                                            'AZ_BIND_REBIND', 'AZ_BIND_PURPOSE', 'AZ_BIND_CENTER', 'AZ_BIND_PRINCIPAL',
                                            'AZ_SELF_VERIFY', 'AZ_IDENTITY_UNKNOWN') THEN p_code ELSE 'AZ_DENIED' END;
BEGIN
  PERFORM authz._security_event(v_code, p_fn, p_claimed_type, p_claimed_id, p_digest);
  RAISE EXCEPTION USING MESSAGE = v_code, ERRCODE = '42501';
END $$;

-- ── 3. verify_guardian_link with person-level self-verification prohibition ────
-- r1 checks preserved verbatim; adds, before writing the link:
--   * both actor and target principals must resolve to a known person → else AZ_IDENTITY_UNKNOWN (fail-closed)
--   * actor's person must differ from target guardian's person → else AZ_SELF_VERIFY (D-14)
CREATE OR REPLACE FUNCTION authz.verify_guardian_link(p_guardian uuid, p_learner uuid, p_evidence_ref text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE v_fn text := 'verify_guardian_link'; v_org uuid := iios.org_of_session(); p authz.principal_ctx := authz._require_principal('verify_guardian_link');
        v_dg text := md5(concat_ws('|', p_guardian, p_learner)); v_id uuid;
        v_actor_person uuid; v_guardian_person uuid;
BEGIN
  IF p.principal_type <> 'staff' THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT authz._holds(p.principal_id, 'guardian.verify', NULL) THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF p.principal_id = p_guardian THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;   -- principal-level (subsumed by type)
  IF NOT EXISTS (SELECT 1 FROM authz.principals pr WHERE pr.org_id = v_org AND pr.principal_id = p_guardian AND pr.principal_type = 'guardian') THEN
    PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT EXISTS (SELECT 1 FROM app.learners l WHERE l.org_id = v_org AND l.learner_id = p_learner) THEN
    PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  -- D-14 person-level: resolve both sides within the session org (cross-org rows invisible).
  SELECT person_id INTO v_actor_person    FROM authz.principal_persons WHERE org_id = v_org AND principal_id = p.principal_id;
  SELECT person_id INTO v_guardian_person FROM authz.principal_persons WHERE org_id = v_org AND principal_id = p_guardian;
  IF v_actor_person IS NULL OR v_guardian_person IS NULL THEN
    PERFORM authz._fail('AZ_IDENTITY_UNKNOWN', v_fn, NULL, NULL, v_dg); END IF;     -- fail-closed
  IF v_actor_person = v_guardian_person THEN
    PERFORM authz._fail('AZ_SELF_VERIFY', v_fn, NULL, NULL, v_dg); END IF;          -- same natural person
  INSERT INTO authz.guardian_links (org_id, guardian_id, learner_id, verified_at, verified_by, evidence_ref)
  VALUES (v_org, p_guardian, p_learner, clock_timestamp(), p.principal_id, p_evidence_ref)
  ON CONFLICT (org_id, guardian_id, learner_id) DO UPDATE SET verified_at = EXCLUDED.verified_at, verified_by = EXCLUDED.verified_by,
    evidence_ref = EXCLUDED.evidence_ref WHERE guardian_links.revoked_at IS NULL AND guardian_links.verified_at IS NULL
  RETURNING link_id INTO v_id;
  IF v_id IS NULL THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;   -- already verified or revoked
  PERFORM authz._audit(p, v_fn, v_dg);
  RETURN v_id;
END $$;

RESET ROLE;
