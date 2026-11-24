-- p01c_r3_recovery.sql — RF-1 guardian-recovery ceremony + RF-2 identity onboarding governance (r3).
-- OGC-SEC-GOV-001 Track B. Applied AFTER p01 + p01b as bootstrap. Does NOT modify frozen r1/r2 files.
-- Synthetic harness only; NOT OGC product code; no real data. IIOS-owned.
--
-- Properties enforced:
--   * Dual control — a destructive recovery/onboarding needs TWO distinct operators AND two distinct
--     natural persons (maker != checker, principal- and person-level). Same person across principals
--     cannot satisfy both roles (AZ_DUAL_CONTROL).
--   * Fail-closed freeze — while a recovery case is open (proposed|approved), the guardian link is
--     treated as unusable by authz.guardian_link_usable() even though revoked_at IS NULL.
--   * Deterministic, owner-governed, not runtime-declarable — case tables carry NO runtime grant/policy.
--   * Immutable audit — every step appends to authz.audit_log (append-only for runtime; owner INSERT-only).
--   * Revocation propagation — apply revokes the link AND cascades active consents fail-closed.
--   * SoD (RF-2) — an operator cannot onboard/approve their own natural person as the subject.
\set ON_ERROR_STOP on
SET ROLE iios_owner;

-- NOTE: the two new capabilities (recovery.operate, identity.onboard) are seeded into the catalog
-- by the fixture (after catalog_versions exist), exactly as r1 capabilities are — not in this DDL
-- delta, which is applied before the fixture loads.

-- ── 1. _fail allowlist += recovery/onboarding deterministic codes ─────────────
-- Keeps every r1 + r2 code; adds AZ_DUAL_CONTROL, AZ_RECOVERY_STATE, AZ_NOT_APPROVED, AZ_SOD.
CREATE OR REPLACE FUNCTION authz._fail(p_code text, p_fn text, p_claimed_type text, p_claimed_id uuid, p_digest text)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE v_code text := CASE WHEN p_code IN ('AZ_DENIED','AZ_NO_PRINCIPAL','AZ_BIND_KEY','AZ_BIND_MAC','AZ_BIND_EXPIRED','AZ_BIND_EXP_RANGE',
                                            'AZ_BIND_REBIND','AZ_BIND_PURPOSE','AZ_BIND_CENTER','AZ_BIND_PRINCIPAL',
                                            'AZ_SELF_VERIFY','AZ_IDENTITY_UNKNOWN',
                                            'AZ_DUAL_CONTROL','AZ_RECOVERY_STATE','AZ_NOT_APPROVED','AZ_SOD') THEN p_code ELSE 'AZ_DENIED' END;
BEGIN
  PERFORM authz._security_event(v_code, p_fn, p_claimed_type, p_claimed_id, p_digest);
  RAISE EXCEPTION USING MESSAGE = v_code, ERRCODE = '42501';
END $$;

-- ── 2. Case tables (owner-governed, NOT runtime-declarable) ──────────────────
CREATE TABLE authz.recovery_cases (
  org_id       uuid NOT NULL,
  case_id      uuid NOT NULL DEFAULT gen_random_uuid(),
  guardian_id  uuid NOT NULL,
  learner_id   uuid NOT NULL,
  reason       text NOT NULL,
  state        text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed','approved','applied','aborted')),
  maker_id     uuid NOT NULL, maker_person   uuid NOT NULL,
  checker_id   uuid,          checker_person uuid,
  opened_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_at   timestamptz,
  applied_at   timestamptz,
  PRIMARY KEY (org_id, case_id)
);
COMMENT ON TABLE authz.recovery_cases IS 'iios:class=authz_identity';
-- At most one OPEN case per (guardian, learner).
CREATE UNIQUE INDEX recovery_one_open ON authz.recovery_cases (org_id, guardian_id, learner_id) WHERE state IN ('proposed','approved');

CREATE TABLE authz.onboarding_cases (
  org_id       uuid NOT NULL,
  case_id      uuid NOT NULL DEFAULT gen_random_uuid(),
  principal_id uuid NOT NULL,        -- principal to be linked
  person_id    uuid NOT NULL,        -- natural person it maps to (the subject)
  source       text NOT NULL,
  reason       text NOT NULL,
  state        text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed','approved','applied','aborted')),
  maker_id     uuid NOT NULL, maker_person   uuid NOT NULL,
  checker_id   uuid,          checker_person uuid,
  opened_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  decided_at   timestamptz,
  applied_at   timestamptz,
  PRIMARY KEY (org_id, case_id)
);
COMMENT ON TABLE authz.onboarding_cases IS 'iios:class=authz_identity';
CREATE UNIQUE INDEX onboarding_one_open ON authz.onboarding_cases (org_id, principal_id) WHERE state IN ('proposed','approved');

-- RLS + FORCE. Owner may read+write its org's rows (definer fns run as iios_owner). Runtime gets
-- NO grant and NO policy → cannot read/write (not runtime-declarable).
ALTER TABLE authz.recovery_cases   ENABLE ROW LEVEL SECURITY; ALTER TABLE authz.recovery_cases   FORCE ROW LEVEL SECURITY;
ALTER TABLE authz.onboarding_cases ENABLE ROW LEVEL SECURITY; ALTER TABLE authz.onboarding_cases FORCE ROW LEVEL SECURITY;
CREATE POLICY owner_all ON authz.recovery_cases   FOR ALL TO iios_owner USING (org_id = (SELECT iios.org_of_session())) WITH CHECK (org_id = (SELECT iios.org_of_session()));
CREATE POLICY owner_all ON authz.onboarding_cases FOR ALL TO iios_owner USING (org_id = (SELECT iios.org_of_session())) WITH CHECK (org_id = (SELECT iios.org_of_session()));
REVOKE ALL ON authz.recovery_cases   FROM PUBLIC;
REVOKE ALL ON authz.onboarding_cases FROM PUBLIC;

-- Governed onboarding (onboard_apply, definer=iios_owner) must INSERT the identity rows. The r2
-- person tables carry only an owner SELECT policy; add an owner INSERT policy (org-scoped) so the
-- governed ceremony can write them. Runtime (iios_app) still has NO policy → still cannot write.
CREATE POLICY owner_ins ON authz.persons            FOR INSERT TO iios_owner WITH CHECK (org_id = (SELECT iios.org_of_session()));
CREATE POLICY owner_ins ON authz.principal_persons  FOR INSERT TO iios_owner WITH CHECK (org_id = (SELECT iios.org_of_session()));

-- ── 3. Recovery-aware guardian-link gate (fail-closed during an open case) ────
-- The production IIOS guardian-read path consults this instead of a raw revoked_at check.
CREATE FUNCTION authz.guardian_link_usable(p_guardian uuid, p_learner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, authz, iios, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM authz.guardian_links l
                  WHERE l.org_id = iios.org_of_session() AND l.guardian_id = p_guardian AND l.learner_id = p_learner
                    AND l.verified_at IS NOT NULL AND l.revoked_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM authz.recovery_cases rc
                      WHERE rc.org_id = iios.org_of_session() AND rc.guardian_id = p_guardian AND rc.learner_id = p_learner
                        AND rc.state IN ('proposed','approved')) $$;

-- helper: the natural person of a principal in this session org, or NULL (fail-closed upstream)
CREATE FUNCTION authz._person_of(p_principal uuid) RETURNS uuid LANGUAGE sql STABLE SET search_path = pg_catalog, authz, iios, pg_temp AS $$
  SELECT person_id FROM authz.principal_persons WHERE org_id = iios.org_of_session() AND principal_id = p_principal $$;

-- ── 4. Guardian recovery ceremony (RF-1) ─────────────────────────────────────
CREATE FUNCTION authz.recovery_open(p_guardian uuid, p_learner uuid, p_reason text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE v_fn text := 'recovery_open'; v_org uuid := iios.org_of_session(); p authz.principal_ctx := authz._require_principal('recovery_open');
        v_dg text := md5(concat_ws('|', p_guardian, p_learner)); v_mp uuid; v_id uuid;
BEGIN
  IF p.principal_type <> 'staff' THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT authz._holds(p.principal_id, 'recovery.operate', NULL) THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  v_mp := authz._person_of(p.principal_id);
  IF v_mp IS NULL THEN PERFORM authz._fail('AZ_IDENTITY_UNKNOWN', v_fn, NULL, NULL, v_dg); END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT EXISTS (SELECT 1 FROM authz.guardian_links l WHERE l.org_id = v_org AND l.guardian_id = p_guardian AND l.learner_id = p_learner
                   AND l.verified_at IS NOT NULL AND l.revoked_at IS NULL) THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  BEGIN
    INSERT INTO authz.recovery_cases (org_id, guardian_id, learner_id, reason, maker_id, maker_person)
    VALUES (v_org, p_guardian, p_learner, p_reason, p.principal_id, v_mp) RETURNING case_id INTO v_id;
  EXCEPTION WHEN unique_violation THEN PERFORM authz._fail('AZ_RECOVERY_STATE', v_fn, NULL, NULL, v_dg); END;
  PERFORM authz._audit(p, v_fn, v_dg);     -- freeze is now in effect via guardian_link_usable()
  RETURN v_id;
END $$;

CREATE FUNCTION authz.recovery_approve(p_case uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE v_fn text := 'recovery_approve'; v_org uuid := iios.org_of_session(); p authz.principal_ctx := authz._require_principal('recovery_approve');
        v_dg text := md5(p_case::text); v_cp uuid; r authz.recovery_cases;
BEGIN
  IF p.principal_type <> 'staff' THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT authz._holds(p.principal_id, 'recovery.operate', NULL) THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  v_cp := authz._person_of(p.principal_id);
  IF v_cp IS NULL THEN PERFORM authz._fail('AZ_IDENTITY_UNKNOWN', v_fn, NULL, NULL, v_dg); END IF;
  SELECT * INTO r FROM authz.recovery_cases WHERE org_id = v_org AND case_id = p_case;
  IF r.case_id IS NULL OR r.state <> 'proposed' THEN PERFORM authz._fail('AZ_RECOVERY_STATE', v_fn, NULL, NULL, v_dg); END IF;
  -- Dual control: checker must differ from maker at BOTH principal and natural-person level.
  IF p.principal_id = r.maker_id OR v_cp = r.maker_person THEN PERFORM authz._fail('AZ_DUAL_CONTROL', v_fn, NULL, NULL, v_dg); END IF;
  UPDATE authz.recovery_cases SET state = 'approved', checker_id = p.principal_id, checker_person = v_cp, decided_at = clock_timestamp()
    WHERE org_id = v_org AND case_id = p_case;
  PERFORM authz._audit(p, v_fn, v_dg);
END $$;

CREATE FUNCTION authz.recovery_apply(p_case uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE v_fn text := 'recovery_apply'; v_org uuid := iios.org_of_session(); p authz.principal_ctx := authz._require_principal('recovery_apply');
        v_dg text := md5(p_case::text); r authz.recovery_cases;
BEGIN
  IF p.principal_type <> 'staff' THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT authz._holds(p.principal_id, 'recovery.operate', NULL) THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  SELECT * INTO r FROM authz.recovery_cases WHERE org_id = v_org AND case_id = p_case;
  IF r.case_id IS NULL THEN PERFORM authz._fail('AZ_RECOVERY_STATE', v_fn, NULL, NULL, v_dg); END IF;
  IF r.state <> 'approved' THEN PERFORM authz._fail('AZ_NOT_APPROVED', v_fn, NULL, NULL, v_dg); END IF;
  -- Invalidate the link (preserve history: set revoked_*; never delete).
  UPDATE authz.guardian_links SET revoked_at = clock_timestamp(), revoked_by = p.principal_id
    WHERE org_id = v_org AND guardian_id = r.guardian_id AND learner_id = r.learner_id AND revoked_at IS NULL;
  -- Revocation propagation: cascade active consents for this (guardian, learner).
  UPDATE authz.consents SET revoked_at = clock_timestamp(), revoked_by = p.principal_id
    WHERE org_id = v_org AND guardian_id = r.guardian_id AND learner_id = r.learner_id AND revoked_at IS NULL;
  UPDATE authz.recovery_cases SET state = 'applied', applied_at = clock_timestamp() WHERE org_id = v_org AND case_id = p_case;
  PERFORM authz._audit(p, v_fn, v_dg);
END $$;

CREATE FUNCTION authz.recovery_abort(p_case uuid, p_reason text)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE v_fn text := 'recovery_abort'; v_org uuid := iios.org_of_session(); p authz.principal_ctx := authz._require_principal('recovery_abort');
        v_dg text := md5(p_case::text); r authz.recovery_cases;
BEGIN
  IF p.principal_type <> 'staff' THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT authz._holds(p.principal_id, 'recovery.operate', NULL) THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  SELECT * INTO r FROM authz.recovery_cases WHERE org_id = v_org AND case_id = p_case;
  IF r.case_id IS NULL OR r.state NOT IN ('proposed','approved') THEN PERFORM authz._fail('AZ_RECOVERY_STATE', v_fn, NULL, NULL, v_dg); END IF;
  UPDATE authz.recovery_cases SET state = 'aborted', decided_at = clock_timestamp() WHERE org_id = v_org AND case_id = p_case;
  PERFORM authz._audit(p, v_fn, v_dg);     -- link returns to usable (no mutation performed)
END $$;

-- ── 5. Identity-source onboarding governance (RF-2) — dual control + SoD ──────
CREATE FUNCTION authz.onboard_propose(p_principal uuid, p_person uuid, p_source text, p_reason text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE v_fn text := 'onboard_propose'; v_org uuid := iios.org_of_session(); p authz.principal_ctx := authz._require_principal('onboard_propose');
        v_dg text := md5(concat_ws('|', p_principal, p_person)); v_mp uuid; v_id uuid;
BEGIN
  IF p.principal_type <> 'staff' THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT authz._holds(p.principal_id, 'identity.onboard', NULL) THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  v_mp := authz._person_of(p.principal_id);
  IF v_mp IS NULL THEN PERFORM authz._fail('AZ_IDENTITY_UNKNOWN', v_fn, NULL, NULL, v_dg); END IF;
  IF p_source IS NULL OR length(btrim(p_source)) = 0 OR p_reason IS NULL OR length(btrim(p_reason)) = 0 THEN
    PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  -- target principal must exist in org and NOT already be linked (principal_persons PK)
  IF NOT EXISTS (SELECT 1 FROM authz.principals pr WHERE pr.org_id = v_org AND pr.principal_id = p_principal) THEN
    PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF EXISTS (SELECT 1 FROM authz.principal_persons WHERE org_id = v_org AND principal_id = p_principal) THEN
    PERFORM authz._fail('AZ_RECOVERY_STATE', v_fn, NULL, NULL, v_dg); END IF;
  -- SoD: the operator cannot be the subject person being onboarded.
  IF v_mp = p_person THEN PERFORM authz._fail('AZ_SOD', v_fn, NULL, NULL, v_dg); END IF;
  BEGIN
    INSERT INTO authz.onboarding_cases (org_id, principal_id, person_id, source, reason, maker_id, maker_person)
    VALUES (v_org, p_principal, p_person, p_source, p_reason, p.principal_id, v_mp) RETURNING case_id INTO v_id;
  EXCEPTION WHEN unique_violation THEN PERFORM authz._fail('AZ_RECOVERY_STATE', v_fn, NULL, NULL, v_dg); END;
  PERFORM authz._audit(p, v_fn, v_dg);
  RETURN v_id;
END $$;

CREATE FUNCTION authz.onboard_approve(p_case uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE v_fn text := 'onboard_approve'; v_org uuid := iios.org_of_session(); p authz.principal_ctx := authz._require_principal('onboard_approve');
        v_dg text := md5(p_case::text); v_cp uuid; r authz.onboarding_cases;
BEGIN
  IF p.principal_type <> 'staff' THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT authz._holds(p.principal_id, 'identity.onboard', NULL) THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  v_cp := authz._person_of(p.principal_id);
  IF v_cp IS NULL THEN PERFORM authz._fail('AZ_IDENTITY_UNKNOWN', v_fn, NULL, NULL, v_dg); END IF;
  SELECT * INTO r FROM authz.onboarding_cases WHERE org_id = v_org AND case_id = p_case;
  IF r.case_id IS NULL OR r.state <> 'proposed' THEN PERFORM authz._fail('AZ_RECOVERY_STATE', v_fn, NULL, NULL, v_dg); END IF;
  IF p.principal_id = r.maker_id OR v_cp = r.maker_person THEN PERFORM authz._fail('AZ_DUAL_CONTROL', v_fn, NULL, NULL, v_dg); END IF;
  IF v_cp = r.person_id THEN PERFORM authz._fail('AZ_SOD', v_fn, NULL, NULL, v_dg); END IF;   -- checker cannot be the subject
  UPDATE authz.onboarding_cases SET state = 'approved', checker_id = p.principal_id, checker_person = v_cp, decided_at = clock_timestamp()
    WHERE org_id = v_org AND case_id = p_case;
  PERFORM authz._audit(p, v_fn, v_dg);
END $$;

CREATE FUNCTION authz.onboard_apply(p_case uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE v_fn text := 'onboard_apply'; v_org uuid := iios.org_of_session(); p authz.principal_ctx := authz._require_principal('onboard_apply');
        v_dg text := md5(p_case::text); r authz.onboarding_cases;
BEGIN
  IF p.principal_type <> 'staff' THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT authz._holds(p.principal_id, 'identity.onboard', NULL) THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  SELECT * INTO r FROM authz.onboarding_cases WHERE org_id = v_org AND case_id = p_case;
  IF r.case_id IS NULL THEN PERFORM authz._fail('AZ_RECOVERY_STATE', v_fn, NULL, NULL, v_dg); END IF;
  IF r.state <> 'approved' THEN PERFORM authz._fail('AZ_NOT_APPROVED', v_fn, NULL, NULL, v_dg); END IF;
  INSERT INTO authz.persons (org_id, person_id, source) VALUES (v_org, r.person_id, r.source) ON CONFLICT DO NOTHING;
  INSERT INTO authz.principal_persons (org_id, principal_id, person_id, linked_by) VALUES (v_org, r.principal_id, r.person_id, p.principal_id);
  UPDATE authz.onboarding_cases SET state = 'applied', applied_at = clock_timestamp() WHERE org_id = v_org AND case_id = p_case;
  PERFORM authz._audit(p, v_fn, v_dg);
END $$;

-- ── 6. Lock down EXECUTE (runtime may call only through sealed principal; PUBLIC none) ──
DO $$ DECLARE f regprocedure; BEGIN
  FOREACH f IN ARRAY ARRAY['authz.guardian_link_usable(uuid,uuid)','authz.recovery_open(uuid,uuid,text)','authz.recovery_approve(uuid)',
    'authz.recovery_apply(uuid)','authz.recovery_abort(uuid,text)','authz.onboard_propose(uuid,uuid,text,text)','authz.onboard_approve(uuid)',
    'authz.onboard_apply(uuid)']::regprocedure[] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO iios_app', f);
  END LOOP; END $$;
-- _person_of is an internal helper: no runtime EXECUTE.
REVOKE ALL ON FUNCTION authz._person_of(uuid) FROM PUBLIC;

RESET ROLE;
