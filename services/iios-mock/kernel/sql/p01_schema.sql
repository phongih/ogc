-- p01_schema.sql — P2 v0.3 sealed principal context (IIOS-AUTHZ-001 v0.3). Bootstrap on db dak. Synthetic harness only.
-- Reviewed artefact for SEC-REVIEW-33S-001; used unchanged by AUTHZ-RUN-002, INT-RUN-001 and PERF-RUN-001. Not OGC product code.
\set ON_ERROR_STOP on
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE TEMP, CREATE ON DATABASE dak FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE iios_owner REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE iios_maint REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- pgcrypto in a dedicated schema; only iios_owner may execute hmac()
CREATE SCHEMA ext_crypto AUTHORIZATION iios_owner;
REVOKE ALL ON SCHEMA ext_crypto FROM PUBLIC;
CREATE EXTENSION pgcrypto SCHEMA ext_crypto;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA ext_crypto FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ext_crypto.hmac(bytea, bytea, text) TO iios_owner;

SET ROLE iios_owner;
CREATE SCHEMA iios; CREATE SCHEMA authz; CREATE SCHEMA app;
GRANT USAGE ON SCHEMA iios, authz, app TO iios_app;
GRANT USAGE ON SCHEMA authz TO iios_auditor, iios_maint, iios_scheduler;

-- ── Organization layer (Option D) ───────────────────────────────────────────
CREATE TABLE iios.org_roles (role_name name PRIMARY KEY, org_id uuid NOT NULL UNIQUE);
COMMENT ON TABLE iios.org_roles IS 'iios:class=platform_registry';
CREATE FUNCTION iios.org_of_session() RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, iios, pg_temp AS $$
DECLARE o uuid;
BEGIN
  SELECT org_id INTO o FROM iios.org_roles WHERE role_name = session_user;
  IF o IS NULL THEN RAISE EXCEPTION 'iios: session role is not mapped' USING ERRCODE = '42501'; END IF;
  RETURN o;
END $$;
REVOKE ALL ON FUNCTION iios.org_of_session() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iios.org_of_session() TO iios_app;

CREATE FUNCTION iios.current_centers() RETURNS uuid[] LANGUAGE sql STABLE
AS $$ SELECT coalesce(nullif(current_setting('iios.center_scope', true), ''), '{}')::uuid[] $$;
REVOKE ALL ON FUNCTION iios.current_centers() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION iios.current_centers() TO iios_app;

-- ── app (tenant data) ───────────────────────────────────────────────────────
CREATE TABLE app.centers (org_id uuid NOT NULL, center_id uuid NOT NULL, name text NOT NULL, PRIMARY KEY (org_id, center_id));
CREATE TABLE app.classes (org_id uuid NOT NULL, class_id uuid NOT NULL, center_id uuid NOT NULL, name text NOT NULL,
  PRIMARY KEY (org_id, class_id), UNIQUE (org_id, class_id, center_id),
  FOREIGN KEY (org_id, center_id) REFERENCES app.centers (org_id, center_id));
CREATE TABLE app.learners (org_id uuid NOT NULL, learner_id uuid NOT NULL, display_name text NOT NULL, learner_code text NOT NULL,
  private_note text, PRIMARY KEY (org_id, learner_id));
CREATE TABLE app.enrollments (org_id uuid NOT NULL, enrollment_id uuid NOT NULL, learner_id uuid NOT NULL, class_id uuid NOT NULL, center_id uuid NOT NULL,
  PRIMARY KEY (org_id, enrollment_id), UNIQUE (org_id, enrollment_id, learner_id, class_id, center_id),
  FOREIGN KEY (org_id, learner_id) REFERENCES app.learners (org_id, learner_id),
  FOREIGN KEY (org_id, class_id, center_id) REFERENCES app.classes (org_id, class_id, center_id));
CREATE TABLE app.learning_evidence (org_id uuid NOT NULL DEFAULT iios.org_of_session(), evidence_id uuid NOT NULL DEFAULT gen_random_uuid(),
  learner_id uuid NOT NULL, enrollment_id uuid NOT NULL, class_id uuid NOT NULL, center_id uuid NOT NULL, content text NOT NULL, score int,
  PRIMARY KEY (org_id, evidence_id),
  FOREIGN KEY (org_id, enrollment_id, learner_id, class_id, center_id)
    REFERENCES app.enrollments (org_id, enrollment_id, learner_id, class_id, center_id));
CREATE TABLE app.evidence_archive (org_id uuid NOT NULL, evidence_id uuid NOT NULL, archived_on date NOT NULL, content text NOT NULL,
  PRIMARY KEY (org_id, evidence_id, archived_on)) PARTITION BY RANGE (archived_on);
CREATE TABLE app.evidence_archive_2026 PARTITION OF app.evidence_archive FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

-- ── authz: versioned catalogs (D7-1, D7-2) ──────────────────────────────────
CREATE TYPE authz.principal_ctx AS (principal_type text, principal_id uuid, purpose text, active_center uuid);
CREATE TABLE authz.catalog_versions (version text PRIMARY KEY, is_current boolean NOT NULL);
CREATE UNIQUE INDEX catalog_versions_one_current ON authz.catalog_versions (is_current) WHERE is_current;
CREATE TABLE authz.purposes (catalog_version text NOT NULL REFERENCES authz.catalog_versions, purpose text NOT NULL, PRIMARY KEY (catalog_version, purpose));
CREATE TABLE authz.scopes (catalog_version text NOT NULL REFERENCES authz.catalog_versions, scope text NOT NULL, PRIMARY KEY (catalog_version, scope));
CREATE TABLE authz.capabilities (catalog_version text NOT NULL REFERENCES authz.catalog_versions, capability text NOT NULL, grantable boolean NOT NULL,
  PRIMARY KEY (catalog_version, capability));
COMMENT ON TABLE authz.catalog_versions IS 'iios:class=global_catalog';
COMMENT ON TABLE authz.purposes IS 'iios:class=global_catalog';
COMMENT ON TABLE authz.scopes IS 'iios:class=global_catalog';
COMMENT ON TABLE authz.capabilities IS 'iios:class=global_catalog';

-- ── authz: org-scoped tables ────────────────────────────────────────────────
CREATE TABLE authz.principals (org_id uuid NOT NULL, principal_id uuid NOT NULL,
  principal_type text NOT NULL CHECK (principal_type IN ('staff','teacher','guardian','learner','service')), label text NOT NULL,
  PRIMARY KEY (org_id, principal_id));
CREATE TABLE authz.principal_keys (org_id uuid NOT NULL, key_id text NOT NULL, secret bytea NOT NULL CHECK (length(secret) = 32),
  not_before timestamptz NOT NULL, not_after timestamptz NOT NULL, revoked_at timestamptz, PRIMARY KEY (org_id, key_id));
-- F07-1: composite key (backend_pid, org_id)
CREATE UNLOGGED TABLE authz.tx_principal (backend_pid int NOT NULL, org_id uuid NOT NULL, xact_id xid8 NOT NULL,
  principal_type text NOT NULL, principal_id uuid NOT NULL, purpose text NOT NULL, active_center uuid, request_id uuid NOT NULL,
  bound_at timestamptz NOT NULL, PRIMARY KEY (backend_pid, org_id));
CREATE TABLE authz.consent_texts (org_id uuid NOT NULL, purpose text NOT NULL, version text NOT NULL, text_sha256 text NOT NULL,
  is_current boolean NOT NULL, PRIMARY KEY (org_id, purpose, version));
CREATE UNIQUE INDEX consent_texts_one_current ON authz.consent_texts (org_id, purpose) WHERE is_current;
CREATE TABLE authz.staff_center_grants (org_id uuid NOT NULL, grant_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), staff_id uuid NOT NULL,
  center_id uuid, capability text NOT NULL, catalog_version text NOT NULL, valid_from timestamptz NOT NULL DEFAULT now(), valid_to timestamptz,
  granted_by uuid, FOREIGN KEY (org_id, staff_id) REFERENCES authz.principals (org_id, principal_id),
  FOREIGN KEY (org_id, center_id) REFERENCES app.centers (org_id, center_id),
  FOREIGN KEY (catalog_version, capability) REFERENCES authz.capabilities (catalog_version, capability));
CREATE TABLE authz.class_assignments (org_id uuid NOT NULL, assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), teacher_id uuid NOT NULL,
  class_id uuid NOT NULL, center_id uuid NOT NULL, valid_from timestamptz NOT NULL DEFAULT now(), valid_to timestamptz, assigned_by uuid,
  FOREIGN KEY (org_id, teacher_id) REFERENCES authz.principals (org_id, principal_id),
  FOREIGN KEY (org_id, class_id, center_id) REFERENCES app.classes (org_id, class_id, center_id));
CREATE TABLE authz.guardian_links (org_id uuid NOT NULL, link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), guardian_id uuid NOT NULL, learner_id uuid NOT NULL,
  verified_at timestamptz, verified_by uuid, evidence_ref text, revoked_at timestamptz, revoked_by uuid, UNIQUE (org_id, guardian_id, learner_id),
  FOREIGN KEY (org_id, guardian_id) REFERENCES authz.principals (org_id, principal_id),
  FOREIGN KEY (org_id, learner_id) REFERENCES app.learners (org_id, learner_id));
-- D7-4: re-consent is a new row; at most one ACTIVE consent per (guardian, learner, purpose)
CREATE TABLE authz.consents (org_id uuid NOT NULL, consent_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), guardian_id uuid NOT NULL, learner_id uuid NOT NULL,
  purpose text NOT NULL, scope text[] NOT NULL, version text NOT NULL, text_sha256 text NOT NULL, catalog_version text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT clock_timestamp(), revoked_at timestamptz, revoked_by uuid,
  FOREIGN KEY (org_id, purpose, version) REFERENCES authz.consent_texts (org_id, purpose, version),
  FOREIGN KEY (org_id, guardian_id) REFERENCES authz.principals (org_id, principal_id),
  FOREIGN KEY (org_id, learner_id) REFERENCES app.learners (org_id, learner_id),
  FOREIGN KEY (catalog_version) REFERENCES authz.catalog_versions (version));
CREATE UNIQUE INDEX consents_one_active ON authz.consents (org_id, guardian_id, learner_id, purpose) WHERE revoked_at IS NULL;
CREATE TABLE authz.audit_log (org_id uuid NOT NULL, seq bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT clock_timestamp(),
  principal_type text, principal_id uuid, fn text NOT NULL, args_digest text NOT NULL, result text NOT NULL);

-- ── labels, RLS + FORCE ─────────────────────────────────────────────────────
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['app.centers','app.classes','app.learners','app.enrollments','app.learning_evidence','app.evidence_archive',
                           'app.evidence_archive_2026',
                           'authz.principals','authz.principal_keys','authz.tx_principal','authz.consent_texts','authz.staff_center_grants',
                           'authz.class_assignments','authz.guardian_links','authz.consents','authz.audit_log','iios.org_roles'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t);
    IF t <> 'iios.org_roles' THEN EXECUTE format('COMMENT ON TABLE %s IS %L', t, 'iios:class=tenant'); END IF;
  END LOOP; END $$;
CREATE POLICY owner_all ON iios.org_roles FOR SELECT TO iios_owner USING (true);

-- owner (definer) policies, org-bound to the session's Organization (O-1)
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['authz.principals','authz.principal_keys','authz.tx_principal','authz.consent_texts',
                           'authz.staff_center_grants','authz.class_assignments','authz.guardian_links','authz.consents'] LOOP
    EXECUTE format('CREATE POLICY owner_org ON %s FOR ALL TO iios_owner USING (org_id = (SELECT iios.org_of_session())) WITH CHECK (org_id = (SELECT iios.org_of_session()))', t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['app.centers','app.classes','app.learners'] LOOP
    EXECUTE format('CREATE POLICY owner_org ON %s FOR SELECT TO iios_owner USING (org_id = (SELECT iios.org_of_session()))', t);
  END LOOP; END $$;
CREATE POLICY owner_ins ON authz.audit_log FOR INSERT TO iios_owner WITH CHECK (org_id = (SELECT iios.org_of_session()));
CREATE POLICY auditor_read ON authz.audit_log FOR SELECT TO iios_auditor USING (true);
CREATE POLICY maint_read ON authz.tx_principal FOR SELECT TO iios_maint USING (true);
CREATE POLICY maint_sweep ON authz.tx_principal FOR DELETE TO iios_maint USING (true);
GRANT SELECT ON authz.audit_log TO iios_auditor;
GRANT SELECT, DELETE ON authz.tx_principal TO iios_maint;

-- runtime org policies: exactly one PERMISSIVE per command on every runtime-exposed table (AD5)
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['authz.staff_center_grants','authz.class_assignments','authz.guardian_links','authz.consents',
                           'app.enrollments','app.learners','app.learning_evidence'] LOOP
    EXECUTE format('CREATE POLICY org_sel ON %s AS PERMISSIVE FOR SELECT TO iios_app USING (org_id = (SELECT iios.org_of_session()))', t);
    EXECUTE format('CREATE POLICY org_ins ON %s AS PERMISSIVE FOR INSERT TO iios_app WITH CHECK (org_id = (SELECT iios.org_of_session()))', t);
    EXECUTE format('CREATE POLICY org_upd ON %s AS PERMISSIVE FOR UPDATE TO iios_app USING (org_id = (SELECT iios.org_of_session())) WITH CHECK (org_id = (SELECT iios.org_of_session()))', t);
    EXECUTE format('CREATE POLICY org_del ON %s AS PERMISSIVE FOR DELETE TO iios_app USING (org_id = (SELECT iios.org_of_session()))', t);
  END LOOP; END $$;
GRANT SELECT ON authz.staff_center_grants, authz.class_assignments, authz.guardian_links, authz.consents TO iios_app;
GRANT SELECT ON app.enrollments TO iios_app;
GRANT SELECT (org_id, learner_id, display_name, learner_code) ON app.learners TO iios_app;
GRANT SELECT, INSERT ON app.learning_evidence TO iios_app;
GRANT UPDATE (content, score) ON app.learning_evidence TO iios_app;

-- ── internal helpers (no EXECUTE for anyone; only reached inside definers, i.e. as iios_owner) ──
CREATE FUNCTION authz._security_event(p_code text, p_fn text, p_claimed_type text, p_claimed_id uuid, p_digest text)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE v_org uuid; v_pt text; v_pi uuid;
BEGIN
  BEGIN v_org := iios.org_of_session(); EXCEPTION WHEN others THEN v_org := NULL; END;
  SELECT t.principal_type, t.principal_id INTO v_pt, v_pi FROM authz.tx_principal t
   WHERE t.backend_pid = pg_backend_pid() AND t.xact_id = pg_current_xact_id_if_assigned() AND t.org_id = v_org;
  -- D7-6: independent server-log record; never contains MAC, key, consent text or learner data
  RAISE LOG 'IIOS_SECURITY_EVENT %', json_build_object('v', 1, 'code', p_code, 'fn', p_fn, 'org', v_org, 'session_user', session_user,
    'pid', pg_backend_pid(), 'principal_type', v_pt, 'principal_id', v_pi, 'claimed_type', p_claimed_type, 'claimed_id', p_claimed_id,
    'args_digest', p_digest)::text;
END $$;

CREATE FUNCTION authz._fail(p_code text, p_fn text, p_claimed_type text, p_claimed_id uuid, p_digest text)
RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE v_code text := CASE WHEN p_code IN ('AZ_DENIED', 'AZ_NO_PRINCIPAL', 'AZ_BIND_KEY', 'AZ_BIND_MAC', 'AZ_BIND_EXPIRED', 'AZ_BIND_EXP_RANGE',
                                            'AZ_BIND_REBIND', 'AZ_BIND_PURPOSE', 'AZ_BIND_CENTER', 'AZ_BIND_PRINCIPAL') THEN p_code ELSE 'AZ_DENIED' END;
BEGIN
  PERFORM authz._security_event(v_code, p_fn, p_claimed_type, p_claimed_id, p_digest);
  RAISE EXCEPTION USING MESSAGE = v_code, ERRCODE = '42501';    -- message is one of the fixed codes above, never caller text
END $$;

CREATE FUNCTION authz._require_principal(p_fn text) RETURNS authz.principal_ctx LANGUAGE plpgsql VOLATILE
SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE r authz.principal_ctx;
BEGIN
  SELECT t.principal_type, t.principal_id, t.purpose, t.active_center INTO r FROM authz.tx_principal t
   WHERE t.backend_pid = pg_backend_pid() AND t.xact_id = pg_current_xact_id_if_assigned() AND t.org_id = iios.org_of_session();
  IF NOT FOUND THEN PERFORM authz._fail('AZ_NO_PRINCIPAL', p_fn, NULL, NULL, NULL); END IF;
  RETURN r;
END $$;

CREATE FUNCTION authz._current_catalog() RETURNS text LANGUAGE sql STABLE SET search_path = pg_catalog, authz, pg_temp AS $$
  SELECT version FROM authz.catalog_versions WHERE is_current $$;

CREATE FUNCTION authz._holds(p_principal uuid, p_capability text, p_center uuid) RETURNS boolean LANGUAGE sql STABLE
SET search_path = pg_catalog, authz, iios, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM authz.staff_center_grants g
                  WHERE g.staff_id = p_principal AND g.capability = p_capability
                    AND (g.center_id IS NULL OR g.center_id = p_center) AND now() >= g.valid_from AND (g.valid_to IS NULL OR now() < g.valid_to)
                    AND EXISTS (SELECT 1 FROM authz.capabilities c WHERE c.catalog_version = authz._current_catalog() AND c.capability = g.capability)) $$;

CREATE FUNCTION authz._audit(p authz.principal_ctx, p_fn text, p_digest text) RETURNS void LANGUAGE sql VOLATILE
SET search_path = pg_catalog, authz, iios, pg_temp AS $$
  INSERT INTO authz.audit_log (org_id, principal_type, principal_id, fn, args_digest, result)
  VALUES (iios.org_of_session(), p.principal_type, p.principal_id, p_fn, p_digest, 'ok') $$;
REVOKE ALL ON FUNCTION authz._security_event(text, text, text, uuid, text), authz._fail(text, text, text, uuid, text),
  authz._require_principal(text), authz._current_catalog(), authz._holds(uuid, text, uuid),
  authz._audit(authz.principal_ctx, text, text) FROM PUBLIC;

-- ── privileged functions (contract v0.3 §4) ─────────────────────────────────
CREATE FUNCTION authz.current_principal() RETURNS authz.principal_ctx LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE r authz.principal_ctx;
BEGIN
  -- F07-2: pid AND current xid8 AND session org are all mandatory
  SELECT t.principal_type, t.principal_id, t.purpose, t.active_center INTO r
    FROM authz.tx_principal t
   WHERE t.backend_pid = pg_backend_pid() AND t.xact_id = pg_current_xact_id_if_assigned() AND t.org_id = iios.org_of_session();
  IF NOT FOUND THEN RAISE EXCEPTION 'AZ_NO_PRINCIPAL' USING ERRCODE = '42501'; END IF;
  RETURN r;
END $$;

CREATE FUNCTION authz.bind_principal(p_type text, p_id uuid, p_purpose text, p_center uuid, p_request uuid, p_exp bigint, p_key_id text, p_mac bytea)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE
  v_org uuid := iios.org_of_session();
  v_pid int := pg_backend_pid();
  v_x xid8 := pg_current_xact_id();
  v_dg text := md5(concat_ws('|', p_type, p_id, p_purpose, p_center, p_request, p_exp, p_key_id));
  v_key bytea; v_expect bytea; v_mac bytea; v_diff int; v_now numeric;
BEGIN
  -- 1 key: belongs to the session's Organization, not revoked, inside its validity window
  SELECT k.secret INTO v_key FROM authz.principal_keys k
   WHERE k.org_id = v_org AND k.key_id = p_key_id AND k.revoked_at IS NULL
     AND k.not_before <= clock_timestamp() AND clock_timestamp() < k.not_after;
  IF v_key IS NULL THEN PERFORM authz._fail('AZ_BIND_KEY', 'bind_principal', p_type, p_id, v_dg); END IF;
  -- 2 MAC over the canonical message; org, pid and xact come from the server, never from the caller
  v_expect := ext_crypto.hmac(convert_to(
      'v1|' || v_org::text || '|' || coalesce(p_type, '') || '|' || coalesce(p_id::text, '') || '|' || coalesce(p_purpose, '') || '|'
      || coalesce(p_center::text, '-') || '|' || coalesce(p_request::text, '') || '|' || v_pid::text || '|' || v_x::text || '|'
      || coalesce(p_exp::text, ''), 'UTF8'), v_key, 'sha256');
  v_diff := CASE WHEN p_mac IS NULL OR length(p_mac) <> 32 THEN 1 ELSE 0 END;
  v_mac := substring(coalesce(p_mac, ''::bytea) || decode(repeat('00', 32), 'hex') FROM 1 FOR 32);
  FOR i IN 0..31 LOOP
    v_diff := v_diff | (get_byte(v_mac, i) # get_byte(v_expect, i));
  END LOOP;
  IF v_diff <> 0 THEN PERFORM authz._fail('AZ_BIND_MAC', 'bind_principal', p_type, p_id, v_dg); END IF;
  -- 3 expiry window (<= 60 s)
  v_now := extract(epoch FROM clock_timestamp());
  IF p_exp IS NULL OR p_exp <= v_now THEN PERFORM authz._fail('AZ_BIND_EXPIRED', 'bind_principal', p_type, p_id, v_dg); END IF;
  IF p_exp > v_now + 60 THEN PERFORM authz._fail('AZ_BIND_EXP_RANGE', 'bind_principal', p_type, p_id, v_dg); END IF;
  -- 4 no rebind inside the same transaction (F07-3)
  IF EXISTS (SELECT 1 FROM authz.tx_principal t WHERE t.backend_pid = v_pid AND t.org_id = v_org AND t.xact_id = v_x) THEN
    PERFORM authz._fail('AZ_BIND_REBIND', 'bind_principal', p_type, p_id, v_dg); END IF;
  -- 5 purpose in the CURRENT catalog (D7-1)
  IF NOT EXISTS (SELECT 1 FROM authz.purposes pp WHERE pp.catalog_version = authz._current_catalog() AND pp.purpose = p_purpose) THEN
    PERFORM authz._fail('AZ_BIND_PURPOSE', 'bind_principal', p_type, p_id, v_dg); END IF;
  -- 6 active center belongs to the Organization
  IF p_center IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app.centers c WHERE c.org_id = v_org AND c.center_id = p_center) THEN
    PERFORM authz._fail('AZ_BIND_CENTER', 'bind_principal', p_type, p_id, v_dg); END IF;
  -- 7 principal exists in the Organization with the claimed type
  IF NOT EXISTS (SELECT 1 FROM authz.principals pr WHERE pr.org_id = v_org AND pr.principal_id = p_id AND pr.principal_type = p_type) THEN
    PERFORM authz._fail('AZ_BIND_PRINCIPAL', 'bind_principal', p_type, p_id, v_dg); END IF;
  INSERT INTO authz.tx_principal (backend_pid, org_id, xact_id, principal_type, principal_id, purpose, active_center, request_id, bound_at)
  VALUES (v_pid, v_org, v_x, p_type, p_id, p_purpose, p_center, p_request, clock_timestamp())
  ON CONFLICT (backend_pid, org_id) DO UPDATE SET xact_id = EXCLUDED.xact_id, principal_type = EXCLUDED.principal_type,
    principal_id = EXCLUDED.principal_id, purpose = EXCLUDED.purpose, active_center = EXCLUDED.active_center,
    request_id = EXCLUDED.request_id, bound_at = EXCLUDED.bound_at;
  PERFORM authz._audit(ROW(p_type, p_id, p_purpose, p_center)::authz.principal_ctx, 'bind_principal',
                       md5(concat_ws('|', p_type, p_id, p_purpose, p_center, p_request)));
END $$;

CREATE FUNCTION authz.grant_center_capability(p_staff uuid, p_center uuid, p_capability text, p_valid_to timestamptz)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE v_fn text := 'grant_center_capability'; v_org uuid := iios.org_of_session(); p authz.principal_ctx := authz._require_principal('grant_center_capability');
        v_dg text := md5(concat_ws('|', p_staff, p_center, p_capability, p_valid_to)); v_id uuid;
BEGIN
  IF p.principal_type <> 'staff' THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF p_staff = p.principal_id THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT EXISTS (SELECT 1 FROM authz.capabilities c WHERE c.catalog_version = authz._current_catalog() AND c.capability = p_capability AND c.grantable) THEN
    PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF p_center IS NULL OR NOT EXISTS (SELECT 1 FROM app.centers c WHERE c.org_id = v_org AND c.center_id = p_center) THEN
    PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT authz._holds(p.principal_id, 'authz.grant', p_center) THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT authz._holds(p.principal_id, p_capability, p_center) THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT EXISTS (SELECT 1 FROM authz.principals pr WHERE pr.org_id = v_org AND pr.principal_id = p_staff AND pr.principal_type IN ('staff', 'teacher')) THEN
    PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  INSERT INTO authz.staff_center_grants (org_id, staff_id, center_id, capability, catalog_version, valid_to, granted_by)
  VALUES (v_org, p_staff, p_center, p_capability, authz._current_catalog(), p_valid_to, p.principal_id) RETURNING grant_id INTO v_id;
  PERFORM authz._audit(p, v_fn, v_dg);
  RETURN v_id;
END $$;

CREATE FUNCTION authz.assign_teacher(p_teacher uuid, p_class uuid)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE v_fn text := 'assign_teacher'; v_org uuid := iios.org_of_session(); p authz.principal_ctx := authz._require_principal('assign_teacher');
        v_dg text := md5(concat_ws('|', p_teacher, p_class)); v_center uuid; v_id uuid;
BEGIN
  IF p.principal_type <> 'staff' THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  SELECT k.center_id INTO v_center FROM app.classes k WHERE k.org_id = v_org AND k.class_id = p_class;
  IF v_center IS NULL THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT authz._holds(p.principal_id, 'class.assign', v_center) THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT EXISTS (SELECT 1 FROM authz.principals pr WHERE pr.org_id = v_org AND pr.principal_id = p_teacher AND pr.principal_type = 'teacher') THEN
    PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT authz._holds(p_teacher, 'teacher', v_center) THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  INSERT INTO authz.class_assignments (org_id, teacher_id, class_id, center_id, assigned_by)
  VALUES (v_org, p_teacher, p_class, v_center, p.principal_id) RETURNING assignment_id INTO v_id;
  PERFORM authz._audit(p, v_fn, v_dg);
  RETURN v_id;
END $$;

CREATE FUNCTION authz.end_assignment(p_assignment uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE v_fn text := 'end_assignment'; v_org uuid := iios.org_of_session(); p authz.principal_ctx := authz._require_principal('end_assignment');
        v_dg text := md5(p_assignment::text); v_center uuid;
BEGIN
  IF p.principal_type <> 'staff' THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  SELECT a.center_id INTO v_center FROM authz.class_assignments a
   WHERE a.org_id = v_org AND a.assignment_id = p_assignment AND (a.valid_to IS NULL OR a.valid_to > now());
  IF v_center IS NULL THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT authz._holds(p.principal_id, 'class.assign', v_center) THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  UPDATE authz.class_assignments SET valid_to = now() WHERE org_id = v_org AND assignment_id = p_assignment;
  PERFORM authz._audit(p, v_fn, v_dg);
END $$;

CREATE FUNCTION authz.verify_guardian_link(p_guardian uuid, p_learner uuid, p_evidence_ref text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE v_fn text := 'verify_guardian_link'; v_org uuid := iios.org_of_session(); p authz.principal_ctx := authz._require_principal('verify_guardian_link');
        v_dg text := md5(concat_ws('|', p_guardian, p_learner)); v_id uuid;
BEGIN
  IF p.principal_type <> 'staff' THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT authz._holds(p.principal_id, 'guardian.verify', NULL) THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF p.principal_id = p_guardian THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;   -- subsumed by the type check (F08.06)
  IF NOT EXISTS (SELECT 1 FROM authz.principals pr WHERE pr.org_id = v_org AND pr.principal_id = p_guardian AND pr.principal_type = 'guardian') THEN
    PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT EXISTS (SELECT 1 FROM app.learners l WHERE l.org_id = v_org AND l.learner_id = p_learner) THEN
    PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  INSERT INTO authz.guardian_links (org_id, guardian_id, learner_id, verified_at, verified_by, evidence_ref)
  VALUES (v_org, p_guardian, p_learner, clock_timestamp(), p.principal_id, p_evidence_ref)
  ON CONFLICT (org_id, guardian_id, learner_id) DO UPDATE SET verified_at = EXCLUDED.verified_at, verified_by = EXCLUDED.verified_by,
    evidence_ref = EXCLUDED.evidence_ref WHERE guardian_links.revoked_at IS NULL AND guardian_links.verified_at IS NULL
  RETURNING link_id INTO v_id;
  IF v_id IS NULL THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;   -- already verified or revoked: no silent re-activation
  PERFORM authz._audit(p, v_fn, v_dg);
  RETURN v_id;
END $$;

CREATE FUNCTION authz.revoke_guardian_link(p_guardian uuid, p_learner uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE v_fn text := 'revoke_guardian_link'; v_org uuid := iios.org_of_session(); p authz.principal_ctx := authz._require_principal('revoke_guardian_link');
        v_dg text := md5(concat_ws('|', p_guardian, p_learner));
BEGIN
  IF p.principal_type <> 'staff' THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT authz._holds(p.principal_id, 'guardian.verify', NULL) THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  UPDATE authz.guardian_links SET revoked_at = clock_timestamp(), revoked_by = p.principal_id
   WHERE org_id = v_org AND guardian_id = p_guardian AND learner_id = p_learner AND revoked_at IS NULL;
  IF NOT FOUND THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  PERFORM authz._audit(p, v_fn, v_dg);
END $$;

CREATE FUNCTION authz.record_consent(p_learner uuid, p_purpose text, p_scope text[], p_version text, p_text_sha256 text)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE v_fn text := 'record_consent'; v_org uuid := iios.org_of_session(); p authz.principal_ctx := authz._require_principal('record_consent');
        v_cat text := authz._current_catalog(); v_dg text := md5(concat_ws('|', p_learner, p_purpose, p_scope::text, p_version)); v_id uuid;
BEGIN
  IF p.principal_type <> 'guardian' THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT EXISTS (SELECT 1 FROM authz.guardian_links l WHERE l.org_id = v_org AND l.guardian_id = p.principal_id AND l.learner_id = p_learner
                   AND l.verified_at IS NOT NULL AND l.revoked_at IS NULL) THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT EXISTS (SELECT 1 FROM authz.purposes pp WHERE pp.catalog_version = v_cat AND pp.purpose = p_purpose) THEN
    PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF p_scope IS NULL OR cardinality(p_scope) = 0
     OR NOT (p_scope <@ ARRAY(SELECT s.scope FROM authz.scopes s WHERE s.catalog_version = v_cat)) THEN
    PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT EXISTS (SELECT 1 FROM authz.consent_texts t WHERE t.org_id = v_org AND t.purpose = p_purpose AND t.version = p_version AND t.is_current) THEN
    PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  -- D7-3 explicit consent: the guardian must present the hash of the exact text shown
  IF p_text_sha256 IS NULL OR NOT EXISTS (SELECT 1 FROM authz.consent_texts t WHERE t.org_id = v_org AND t.purpose = p_purpose
                   AND t.version = p_version AND t.text_sha256 = p_text_sha256) THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  -- D7-4 at most one ACTIVE consent per (guardian, learner, purpose); re-consent after revocation is a new row
  IF EXISTS (SELECT 1 FROM authz.consents c WHERE c.org_id = v_org AND c.guardian_id = p.principal_id AND c.learner_id = p_learner
               AND c.purpose = p_purpose AND c.revoked_at IS NULL) THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  INSERT INTO authz.consents (org_id, guardian_id, learner_id, purpose, scope, version, text_sha256, catalog_version)
  VALUES (v_org, p.principal_id, p_learner, p_purpose, p_scope, p_version, p_text_sha256, v_cat) RETURNING consent_id INTO v_id;
  PERFORM authz._audit(p, v_fn, v_dg);
  RETURN v_id;
END $$;

CREATE FUNCTION authz.revoke_consent(p_consent uuid)
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, iios, pg_temp AS $$
DECLARE v_fn text := 'revoke_consent'; v_org uuid := iios.org_of_session(); p authz.principal_ctx := authz._require_principal('revoke_consent');
        v_dg text := md5(p_consent::text); v_g uuid;
BEGIN
  SELECT c.guardian_id INTO v_g FROM authz.consents c WHERE c.org_id = v_org AND c.consent_id = p_consent AND c.revoked_at IS NULL;
  IF v_g IS NULL THEN PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  IF NOT ((p.principal_type = 'guardian' AND p.principal_id = v_g)
          OR (p.principal_type = 'staff' AND authz._holds(p.principal_id, 'privacy.officer', NULL))) THEN
    PERFORM authz._fail('AZ_DENIED', v_fn, NULL, NULL, v_dg); END IF;
  UPDATE authz.consents SET revoked_at = clock_timestamp(), revoked_by = p.principal_id WHERE org_id = v_org AND consent_id = p_consent;
  PERFORM authz._audit(p, v_fn, v_dg);
END $$;

DO $$ DECLARE f regprocedure; BEGIN
  FOREACH f IN ARRAY ARRAY['authz.current_principal()', 'authz.bind_principal(text,uuid,text,uuid,uuid,bigint,text,bytea)',
    'authz.grant_center_capability(uuid,uuid,text,timestamptz)', 'authz.assign_teacher(uuid,uuid)', 'authz.end_assignment(uuid)',
    'authz.verify_guardian_link(uuid,uuid,text)', 'authz.revoke_guardian_link(uuid,uuid)', 'authz.record_consent(uuid,text,text[],text,text)',
    'authz.revoke_consent(uuid)']::regprocedure[] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO iios_app', f);
  END LOOP; END $$;

-- ── principal-derived RESTRICTIVE policies (unchanged from v0.2 harness) ────
CREATE POLICY authz_sel ON app.learning_evidence AS RESTRICTIVE FOR SELECT TO iios_app USING (
  ((SELECT p.active_center FROM authz.current_principal() p) IS NULL OR learning_evidence.center_id = (SELECT p.active_center FROM authz.current_principal() p))
  AND (coalesce(current_setting('iios.center_scope', true), '') IN ('', '{}') OR learning_evidence.center_id = ANY (iios.current_centers()))
  AND EXISTS (SELECT 1 FROM authz.current_principal() p WHERE
       (p.principal_type = 'staff' AND EXISTS (SELECT 1 FROM authz.staff_center_grants g WHERE g.staff_id = p.principal_id AND g.capability = 'evidence.read'
            AND (g.center_id IS NULL OR g.center_id = learning_evidence.center_id) AND now() >= g.valid_from AND (g.valid_to IS NULL OR now() < g.valid_to)))
    OR (p.principal_type = 'teacher' AND EXISTS (SELECT 1 FROM authz.class_assignments a WHERE a.teacher_id = p.principal_id
            AND a.class_id = learning_evidence.class_id AND now() >= a.valid_from AND (a.valid_to IS NULL OR now() < a.valid_to)))
    OR (p.principal_type = 'guardian'
        AND EXISTS (SELECT 1 FROM authz.guardian_links l WHERE l.guardian_id = p.principal_id AND l.learner_id = learning_evidence.learner_id
            AND l.verified_at IS NOT NULL AND l.revoked_at IS NULL)
        AND EXISTS (SELECT 1 FROM authz.consents c WHERE c.guardian_id = p.principal_id AND c.learner_id = learning_evidence.learner_id
            AND c.purpose = p.purpose AND 'evidence' = ANY (c.scope) AND c.revoked_at IS NULL))
    OR (p.principal_type = 'learner' AND p.principal_id = learning_evidence.learner_id)
    OR (p.principal_type = 'service' AND p.purpose = ANY ('{report.weekly}'::text[]))));

CREATE POLICY authz_ins ON app.learning_evidence AS RESTRICTIVE FOR INSERT TO iios_app WITH CHECK (
  ((SELECT p.active_center FROM authz.current_principal() p) IS NULL OR learning_evidence.center_id = (SELECT p.active_center FROM authz.current_principal() p))
  AND (coalesce(current_setting('iios.center_scope', true), '') IN ('', '{}') OR learning_evidence.center_id = ANY (iios.current_centers()))
  AND EXISTS (SELECT 1 FROM authz.current_principal() p WHERE p.principal_type = 'teacher'
       AND EXISTS (SELECT 1 FROM authz.class_assignments a WHERE a.teacher_id = p.principal_id AND a.class_id = learning_evidence.class_id
            AND a.center_id = learning_evidence.center_id AND now() >= a.valid_from AND (a.valid_to IS NULL OR now() < a.valid_to))));

CREATE POLICY authz_upd ON app.learning_evidence AS RESTRICTIVE FOR UPDATE TO iios_app
USING (
  ((SELECT p.active_center FROM authz.current_principal() p) IS NULL OR learning_evidence.center_id = (SELECT p.active_center FROM authz.current_principal() p))
  AND (coalesce(current_setting('iios.center_scope', true), '') IN ('', '{}') OR learning_evidence.center_id = ANY (iios.current_centers()))
  AND EXISTS (SELECT 1 FROM authz.current_principal() p WHERE p.principal_type = 'teacher'
       AND EXISTS (SELECT 1 FROM authz.class_assignments a WHERE a.teacher_id = p.principal_id AND a.class_id = learning_evidence.class_id
            AND a.center_id = learning_evidence.center_id AND now() >= a.valid_from AND (a.valid_to IS NULL OR now() < a.valid_to))))
WITH CHECK (
  ((SELECT p.active_center FROM authz.current_principal() p) IS NULL OR learning_evidence.center_id = (SELECT p.active_center FROM authz.current_principal() p))
  AND (coalesce(current_setting('iios.center_scope', true), '') IN ('', '{}') OR learning_evidence.center_id = ANY (iios.current_centers()))
  AND EXISTS (SELECT 1 FROM authz.current_principal() p WHERE p.principal_type = 'teacher'
       AND EXISTS (SELECT 1 FROM authz.class_assignments a WHERE a.teacher_id = p.principal_id AND a.class_id = learning_evidence.class_id
            AND a.center_id = learning_evidence.center_id AND now() >= a.valid_from AND (a.valid_to IS NULL OR now() < a.valid_to))));

CREATE POLICY authz_sel ON app.enrollments AS RESTRICTIVE FOR SELECT TO iios_app USING (
  ((SELECT p.active_center FROM authz.current_principal() p) IS NULL OR enrollments.center_id = (SELECT p.active_center FROM authz.current_principal() p))
  AND (coalesce(current_setting('iios.center_scope', true), '') IN ('', '{}') OR enrollments.center_id = ANY (iios.current_centers()))
  AND EXISTS (SELECT 1 FROM authz.current_principal() p WHERE
       (p.principal_type = 'staff' AND EXISTS (SELECT 1 FROM authz.staff_center_grants g WHERE g.staff_id = p.principal_id
            AND (g.center_id IS NULL OR g.center_id = enrollments.center_id) AND now() >= g.valid_from AND (g.valid_to IS NULL OR now() < g.valid_to)))
    OR (p.principal_type = 'teacher' AND EXISTS (SELECT 1 FROM authz.class_assignments a WHERE a.teacher_id = p.principal_id
            AND a.class_id = enrollments.class_id AND now() >= a.valid_from AND (a.valid_to IS NULL OR now() < a.valid_to)))
    OR (p.principal_type = 'guardian'
        AND EXISTS (SELECT 1 FROM authz.guardian_links l WHERE l.guardian_id = p.principal_id AND l.learner_id = enrollments.learner_id
            AND l.verified_at IS NOT NULL AND l.revoked_at IS NULL)
        AND EXISTS (SELECT 1 FROM authz.consents c WHERE c.guardian_id = p.principal_id AND c.learner_id = enrollments.learner_id AND c.revoked_at IS NULL))
    OR (p.principal_type = 'learner' AND p.principal_id = enrollments.learner_id)
    OR (p.principal_type = 'service' AND p.purpose = ANY ('{report.weekly}'::text[]))));

CREATE POLICY authz_sel ON app.learners AS RESTRICTIVE FOR SELECT TO iios_app USING (
  EXISTS (SELECT 1 FROM authz.current_principal() p WHERE
       (p.principal_type IN ('staff', 'teacher', 'service') AND EXISTS (SELECT 1 FROM app.enrollments e WHERE e.learner_id = learners.learner_id))
    OR (p.principal_type = 'learner' AND p.principal_id = learners.learner_id)
    OR (p.principal_type = 'guardian'
        AND EXISTS (SELECT 1 FROM authz.guardian_links l WHERE l.guardian_id = p.principal_id AND l.learner_id = learners.learner_id
            AND l.verified_at IS NOT NULL AND l.revoked_at IS NULL)
        AND EXISTS (SELECT 1 FROM authz.consents c WHERE c.guardian_id = p.principal_id AND c.learner_id = learners.learner_id
            AND c.purpose = p.purpose AND 'profile' = ANY (c.scope) AND c.revoked_at IS NULL))));

CREATE VIEW app.learner_profile_min WITH (security_invoker = true) AS SELECT learner_id, display_name, learner_code FROM app.learners;
COMMENT ON VIEW app.learner_profile_min IS 'iios:class=tenant_view';
GRANT SELECT ON app.learner_profile_min TO iios_app;
RESET ROLE;

-- ── F07-5 sweep: owned by iios_maint (bootstrap creates it as that role) ────
GRANT CREATE ON SCHEMA authz TO iios_maint;   -- temporary, revoked below
SET ROLE iios_maint;
CREATE FUNCTION authz.sweep_tx_principal() RETURNS bigint LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, authz, pg_temp AS $$
DECLARE n bigint;
BEGIN
  -- delete rows whose backend is gone, or whose pid now belongs to a backend started after the binding (pid reuse);
  -- rows of live backends that bound after they started (incl. an open transaction) are never touched
  DELETE FROM authz.tx_principal t
   WHERE NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.pid = t.backend_pid)
      OR EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.pid = t.backend_pid AND a.backend_start > t.bound_at);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION authz.sweep_tx_principal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION authz.sweep_tx_principal() TO iios_scheduler;
RESET ROLE;
REVOKE CREATE ON SCHEMA authz FROM iios_maint;
