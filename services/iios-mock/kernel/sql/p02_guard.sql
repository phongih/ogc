-- p02_guard.sql — admission guard v0.5 (IIOS-DAK-001 v0.5 §3: AZG1–AZG11). Bootstrap on db dak, AFTER schema and fixture.
-- Synthetic harness only. Superusers bypass (K5, out of scope). Global objects (roles, role grants) are covered by OB1–OB6, not here.
\set ON_ERROR_STOP on
CREATE SCHEMA guard;
REVOKE ALL ON SCHEMA guard FROM PUBLIC;
CREATE TABLE guard.governed_schemas (nspname name PRIMARY KEY);
INSERT INTO guard.governed_schemas VALUES ('app'), ('authz'), ('iios'), ('ext_crypto');

-- AZG1/AZG2 relation & column privilege allowlist (column NULL = table-level)
CREATE TABLE guard.priv_allow (rel text NOT NULL, grantee name NOT NULL, privilege text NOT NULL, col name, UNIQUE (rel, grantee, privilege, col));
INSERT INTO guard.priv_allow VALUES
 ('authz.staff_center_grants','iios_app','SELECT',NULL), ('authz.class_assignments','iios_app','SELECT',NULL),
 ('authz.guardian_links','iios_app','SELECT',NULL), ('authz.consents','iios_app','SELECT',NULL),
 ('app.enrollments','iios_app','SELECT',NULL), ('app.learning_evidence','iios_app','SELECT',NULL), ('app.learning_evidence','iios_app','INSERT',NULL),
 ('app.learning_evidence','iios_app','UPDATE','content'), ('app.learning_evidence','iios_app','UPDATE','score'),
 ('app.learners','iios_app','SELECT','org_id'), ('app.learners','iios_app','SELECT','learner_id'),
 ('app.learners','iios_app','SELECT','display_name'), ('app.learners','iios_app','SELECT','learner_code'),
 ('app.learner_profile_min','iios_app','SELECT',NULL),
 ('authz.audit_log','iios_auditor','SELECT',NULL),
 ('authz.tx_principal','iios_maint','SELECT',NULL), ('authz.tx_principal','iios_maint','DELETE',NULL);
-- AZG7 function EXECUTE allowlist
CREATE TABLE guard.exec_allow (fn text NOT NULL, grantee name NOT NULL, PRIMARY KEY (fn, grantee));
INSERT INTO guard.exec_allow VALUES
 ('iios.org_of_session()','iios_app'), ('iios.current_centers()','iios_app'), ('authz.current_principal()','iios_app'),
 ('authz.bind_principal(text,uuid,text,uuid,uuid,bigint,text,bytea)','iios_app'),
 ('authz.grant_center_capability(uuid,uuid,text,timestamp with time zone)','iios_app'), ('authz.assign_teacher(uuid,uuid)','iios_app'),
 ('authz.end_assignment(uuid)','iios_app'), ('authz.verify_guardian_link(uuid,uuid,text)','iios_app'),
 ('authz.revoke_guardian_link(uuid,uuid)','iios_app'), ('authz.record_consent(uuid,text,text[],text,text)','iios_app'),
 ('authz.revoke_consent(uuid)','iios_app'), ('authz.sweep_tx_principal()','iios_scheduler'),
 ('ext_crypto.hmac(bytea,bytea,text)','iios_owner');
-- AZG8 schema privilege allowlist
CREATE TABLE guard.schema_allow (nspname name NOT NULL, grantee name NOT NULL, privilege text NOT NULL, PRIMARY KEY (nspname, grantee, privilege));
INSERT INTO guard.schema_allow VALUES ('iios','iios_app','USAGE'), ('authz','iios_app','USAGE'), ('app','iios_app','USAGE'),
 ('authz','iios_auditor','USAGE'), ('authz','iios_maint','USAGE'), ('authz','iios_scheduler','USAGE');
-- AD5b permissive policies for roles other than iios_app
CREATE TABLE guard.policy_allow (rel text NOT NULL, polname name NOT NULL, role name NOT NULL, PRIMARY KEY (rel, polname, role));
INSERT INTO guard.policy_allow VALUES ('iios.org_roles','owner_all','iios_owner'), ('authz.audit_log','auditor_read','iios_auditor'),
 ('authz.tx_principal','maint_read','iios_maint'), ('authz.tx_principal','maint_sweep','iios_maint');

-- registry (AZG9), keyed by OID
CREATE TABLE guard.reg_tables    (relid oid PRIMARY KEY, relname text NOT NULL, owner oid NOT NULL, acl text, rls bool, frc bool, npolicies int NOT NULL);
CREATE TABLE guard.reg_policies  (polid oid PRIMARY KEY, relid oid NOT NULL, polname name NOT NULL, permissive bool NOT NULL,
                                  cmd "char" NOT NULL, roles oid[] NOT NULL, qual text, withcheck text);
CREATE TABLE guard.reg_functions (fid oid PRIMARY KEY, sig text NOT NULL, src_md5 text NOT NULL, secdef bool NOT NULL,
                                  config text[], owner oid NOT NULL, acl text);
CREATE TABLE guard.reg_triggers  (tgid oid PRIMARY KEY, relid oid NOT NULL, tgname name NOT NULL);
CREATE TABLE guard.reg_schemas   (nspid oid PRIMARY KEY, nspname name NOT NULL, owner oid NOT NULL, acl text);

-- AZG10 TRUNCATE guard
CREATE FUNCTION guard.no_truncate() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'iios guard: TRUNCATE on tenant table % is forbidden', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION guard.no_truncate() FROM PUBLIC;
GRANT USAGE ON SCHEMA guard TO iios_owner;
GRANT EXECUTE ON FUNCTION guard.no_truncate() TO iios_owner;
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT c.oid::regclass AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname IN ('app','authz') AND c.relkind = 'r' AND NOT c.relispartition
              AND obj_description(c.oid, 'pg_class') = 'iios:class=tenant' LOOP
    EXECUTE format('CREATE TRIGGER zz_no_truncate BEFORE TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION guard.no_truncate()', r.t);
  END LOOP; END $$;

CREATE FUNCTION guard.snapshot() RETURNS void LANGUAGE plpgsql SET search_path = pg_catalog, guard, pg_temp AS $$
BEGIN
  TRUNCATE guard.reg_tables, guard.reg_policies, guard.reg_functions, guard.reg_triggers, guard.reg_schemas;
  INSERT INTO guard.reg_schemas SELECT oid, nspname, nspowner, coalesce(nspacl, acldefault('n', nspowner))::text
    FROM pg_namespace WHERE nspname IN (SELECT nspname FROM guard.governed_schemas);
  INSERT INTO guard.reg_tables
    SELECT c.oid, n.nspname||'.'||c.relname, c.relowner, coalesce(c.relacl, acldefault('r', c.relowner))::text, c.relrowsecurity, c.relforcerowsecurity,
           (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('app','authz','iios') AND c.relkind IN ('r','p');
  INSERT INTO guard.reg_policies
    SELECT p.oid, p.polrelid, p.polname, p.polpermissive, p.polcmd, p.polroles, pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
      FROM pg_policy p WHERE p.polrelid IN (SELECT relid FROM guard.reg_tables);
  INSERT INTO guard.reg_functions
    SELECT p.oid, p.oid::regprocedure::text, md5(p.prosrc), p.prosecdef, p.proconfig, p.proowner, coalesce(p.proacl, acldefault('f', p.proowner))::text
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('iios','authz');
  INSERT INTO guard.reg_triggers
    SELECT t.oid, t.tgrelid, t.tgname FROM pg_trigger t WHERE t.tgrelid IN (SELECT relid FROM guard.reg_tables) AND NOT t.tgisinternal;
END $$;

-- AZG9 drift against the registry
CREATE FUNCTION guard.violations() RETURNS text LANGUAGE plpgsql STABLE SET search_path = pg_catalog, guard, pg_temp AS $$
DECLARE v text;
BEGIN
  SELECT format('schema %s missing/owner/ACL changed', s.nspname) INTO v FROM guard.reg_schemas s LEFT JOIN pg_namespace n ON n.oid = s.nspid
   WHERE n.oid IS NULL OR n.nspowner <> s.owner OR coalesce(n.nspacl, acldefault('n', n.nspowner))::text IS DISTINCT FROM s.acl LIMIT 1;
  IF v IS NOT NULL THEN RETURN v; END IF;
  SELECT format('table %s: %s', t.relname,
           CASE WHEN c.oid IS NULL THEN 'missing' WHEN c.relrowsecurity IS DISTINCT FROM t.rls THEN 'RLS changed'
                WHEN c.relforcerowsecurity IS DISTINCT FROM t.frc THEN 'FORCE changed' WHEN c.relowner <> t.owner THEN 'owner changed'
                WHEN coalesce(c.relacl, acldefault('r', c.relowner))::text IS DISTINCT FROM t.acl THEN 'ACL changed'
                ELSE 'policy count changed' END) INTO v
    FROM guard.reg_tables t LEFT JOIN pg_class c ON c.oid = t.relid
   WHERE c.oid IS NULL OR c.relrowsecurity IS DISTINCT FROM t.rls OR c.relforcerowsecurity IS DISTINCT FROM t.frc OR c.relowner <> t.owner
      OR coalesce(c.relacl, acldefault('r', c.relowner))::text IS DISTINCT FROM t.acl
      OR (SELECT count(*) FROM pg_policy p WHERE p.polrelid = t.relid) <> t.npolicies
   LIMIT 1;
  IF v IS NOT NULL THEN RETURN v; END IF;
  SELECT format('policy %s: missing or altered', r.polname) INTO v
    FROM guard.reg_policies r LEFT JOIN pg_policy p ON p.oid = r.polid
   WHERE p.oid IS NULL OR p.polpermissive <> r.permissive OR p.polcmd <> r.cmd OR p.polroles <> r.roles
      OR pg_get_expr(p.polqual, p.polrelid) IS DISTINCT FROM r.qual OR pg_get_expr(p.polwithcheck, p.polrelid) IS DISTINCT FROM r.withcheck
   LIMIT 1;
  IF v IS NOT NULL THEN RETURN v; END IF;
  SELECT format('function %s: missing or altered', f.sig) INTO v
    FROM guard.reg_functions f LEFT JOIN pg_proc p ON p.oid = f.fid
   WHERE p.oid IS NULL OR md5(p.prosrc) <> f.src_md5 OR p.prosecdef <> f.secdef OR p.proconfig IS DISTINCT FROM f.config
      OR p.proowner <> f.owner OR coalesce(p.proacl, acldefault('f', p.proowner))::text IS DISTINCT FROM f.acl
   LIMIT 1;
  IF v IS NOT NULL THEN RETURN v; END IF;
  SELECT 'function count in iios/authz changed' INTO v
   WHERE (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname IN ('iios','authz'))
         <> (SELECT count(*) FROM guard.reg_functions);
  IF v IS NOT NULL THEN RETURN v; END IF;
  SELECT format('trigger %s: missing or disabled', r.tgname) INTO v
    FROM guard.reg_triggers r LEFT JOIN pg_trigger t ON t.oid = r.tgid WHERE t.oid IS NULL OR t.tgenabled <> 'O' LIMIT 1;
  RETURN v;
END $$;

-- AZG1–AZG8 + v0.3 AD rules: continuous catalog admission check (AZG11)
CREATE FUNCTION guard.admission_violations() RETURNS SETOF text LANGUAGE sql STABLE SET search_path = pg_catalog, guard, pg_temp AS $$
WITH rel AS (
  SELECT c.oid, n.nspname||'.'||c.relname AS name, n.nspname AS nsp, c.relkind, c.relispartition, c.relrowsecurity AS rls,
         c.relforcerowsecurity AS frc, c.reloptions, c.relowner, c.relacl, obj_description(c.oid, 'pg_class') AS label,
         EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped) AS has_org
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname IN (SELECT nspname FROM guard.governed_schemas) AND c.relkind IN ('r','p','v','m','f','S')),
g AS (
  SELECT r.oid, a.grantee, a.privilege_type, NULL::name AS col FROM rel r, aclexplode(coalesce(r.relacl, acldefault((CASE WHEN r.relkind = 'S' THEN 's' ELSE 'r' END)::"char", r.relowner))) a
   WHERE a.grantee <> r.relowner
  UNION ALL
  SELECT r.oid, a.grantee, a.privilege_type, at.attname FROM rel r JOIN pg_attribute at ON at.attrelid = r.oid AND at.attacl IS NOT NULL,
         aclexplode(at.attacl) a WHERE a.grantee <> r.relowner),
gn AS (SELECT g.*, r.name, CASE WHEN g.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(g.grantee) END AS gname FROM g JOIN rel r USING (oid)),
exposed_app AS (SELECT DISTINCT oid FROM g WHERE grantee = (SELECT oid FROM pg_roles WHERE rolname = 'iios_app')),
exposed AS (SELECT DISTINCT oid FROM g),
appr AS (SELECT oid FROM pg_roles WHERE rolname = 'iios_app'),
cmds AS (SELECT unnest(ARRAY['r','a','w','d'])::"char" AS cmd)
SELECT 'AZG1 '||name||' '||privilege_type||coalesce('('||col||')','')||' to '||gname FROM gn
 WHERE NOT EXISTS (SELECT 1 FROM guard.priv_allow p WHERE p.rel = gn.name AND p.grantee = gn.gname AND p.privilege = gn.privilege_type
                     AND p.col IS NOT DISTINCT FROM gn.col)
UNION ALL
SELECT 'AZG3 '||r.name||' view in authz must never be exposed' FROM rel r JOIN exposed USING (oid) WHERE r.relkind = 'v' AND r.nsp = 'authz'
UNION ALL
SELECT 'AZG3 '||r.name||' view requires label tenant_view + security_invoker' FROM rel r JOIN exposed USING (oid)
 WHERE r.relkind = 'v' AND (coalesce(r.label,'') <> 'iios:class=tenant_view' OR NOT coalesce(r.reloptions,'{}') @> ARRAY['security_invoker=true'])
UNION ALL
SELECT 'AZG4 '||r.name||' partition/matview/foreign must never be exposed' FROM rel r JOIN exposed USING (oid)
 WHERE r.relkind IN ('m','f') OR r.relispartition
UNION ALL
SELECT 'AZG4 '||r.name||' partition requires RLS + FORCE' FROM rel r WHERE r.relispartition AND r.nsp IN ('app','authz') AND NOT (r.rls AND r.frc)
UNION ALL
SELECT 'AD4 '||r.name||' runtime-exposed table requires label tenant + RLS + FORCE' FROM rel r JOIN exposed_app USING (oid)
 WHERE r.relkind IN ('r','p') AND (coalesce(r.label,'') <> 'iios:class=tenant' OR NOT r.rls OR NOT r.frc)
UNION ALL
SELECT 'AZG6 '||r.name||' org-scoped authz table requires RLS + FORCE' FROM rel r
 WHERE r.nsp = 'authz' AND r.relkind IN ('r','p') AND r.has_org AND NOT (r.rls AND r.frc)
UNION ALL
SELECT 'AZG6 '||r.name||' exposed table requires RLS + FORCE' FROM rel r JOIN exposed USING (oid)
 WHERE r.relkind IN ('r','p') AND NOT (r.rls AND r.frc)
UNION ALL
SELECT 'AD5 '||r.name||' cmd='||cm.cmd::text||' iios_app permissive policies='||
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = r.oid AND p.polpermissive AND p.polcmd IN (cm.cmd,'*') AND (SELECT oid FROM appr) = ANY (p.polroles))
  FROM rel r JOIN exposed_app USING (oid) CROSS JOIN cmds cm
 WHERE r.relkind IN ('r','p')
   AND (SELECT count(*) FROM pg_policy p WHERE p.polrelid = r.oid AND p.polpermissive AND p.polcmd IN (cm.cmd,'*') AND (SELECT oid FROM appr) = ANY (p.polroles)) <> 1
UNION ALL
SELECT 'AD5 '||r.name||' permissive policy '||p.polname||' for iios_app must be TO iios_app only, org-bound, WITH CHECK on writes'
  FROM rel r JOIN pg_policy p ON p.polrelid = r.oid
 WHERE p.polpermissive AND (SELECT oid FROM appr) = ANY (p.polroles)
   AND (p.polroles <> ARRAY[(SELECT oid FROM appr)]
     OR (p.polqual IS NOT NULL AND pg_get_expr(p.polqual, p.polrelid) NOT LIKE '%SELECT iios.org_of_session()%')
     OR (p.polwithcheck IS NOT NULL AND pg_get_expr(p.polwithcheck, p.polrelid) NOT LIKE '%SELECT iios.org_of_session()%')
     OR (p.polcmd IN ('a','w') AND p.polwithcheck IS NULL))
UNION ALL
SELECT 'AD5b '||r.name||' permissive policy '||p.polname||' for role '||coalesce(pg_get_userbyid(ro), 'PUBLIC')||' not allowed'
  FROM rel r JOIN pg_policy p ON p.polrelid = r.oid, unnest(p.polroles) ro
 WHERE p.polpermissive AND ro <> (SELECT oid FROM appr)
   AND NOT (pg_get_userbyid(ro) = 'iios_owner' AND coalesce(pg_get_expr(p.polqual, p.polrelid), '')||coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') LIKE '%SELECT iios.org_of_session()%')
   AND NOT EXISTS (SELECT 1 FROM guard.policy_allow a WHERE a.rel = r.name AND a.polname = p.polname AND a.role = pg_get_userbyid(ro))
UNION ALL
SELECT 'AZG5 default ACL of '||pg_get_userbyid(d.defaclrole)||' grants '||a.privilege_type||' to '||CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
  FROM pg_default_acl d, aclexplode(d.defaclacl) a WHERE a.grantee <> d.defaclrole
UNION ALL
SELECT 'AZG7 EXECUTE '||p.oid::regprocedure::text||' to '||CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
 WHERE n.nspname IN (SELECT nspname FROM guard.governed_schemas) AND a.privilege_type = 'EXECUTE' AND a.grantee <> p.proowner
   AND NOT EXISTS (SELECT 1 FROM guard.exec_allow e WHERE e.fn = p.oid::regprocedure::text
                     AND e.grantee = CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)
UNION ALL
SELECT 'AZG8 schema '||n.nspname||' '||a.privilege_type||' to '||CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
  FROM pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
 WHERE n.nspname IN (SELECT nspname FROM guard.governed_schemas) AND a.grantee <> n.nspowner
   AND NOT EXISTS (SELECT 1 FROM guard.schema_allow s WHERE s.nspname = n.nspname AND s.privilege = a.privilege_type
                     AND s.grantee = CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END)
$$;

CREATE FUNCTION guard.onboarding_violations() RETURNS SETOF text LANGUAGE sql STABLE SET search_path = pg_catalog, guard, pg_temp AS $$
  SELECT 'OB1 privileged attribute on non-superuser '||rolname FROM pg_roles
   WHERE NOT rolsuper AND (rolcreaterole OR rolbypassrls OR rolcreatedb OR rolreplication) AND rolname NOT LIKE 'pg\_%'
  UNION ALL SELECT 'OB1 unexpected superuser '||rolname FROM pg_roles WHERE rolsuper AND rolname <> 'bootstrap'
  UNION ALL SELECT 'OB2 admin option: '||pg_get_userbyid(m.member)||' on '||pg_get_userbyid(m.roleid) FROM pg_auth_members m
   WHERE m.admin_option AND pg_get_userbyid(m.member) <> 'bootstrap'
     AND (pg_get_userbyid(m.roleid) IN ('iios_app','iios_owner') OR pg_get_userbyid(m.roleid) LIKE 'iios\_app\_o\_%')
  UNION ALL SELECT 'OB3 member of org login: '||pg_get_userbyid(m.member)||' in '||pg_get_userbyid(m.roleid) FROM pg_auth_members m
   WHERE pg_get_userbyid(m.roleid) LIKE 'iios\_app\_o\_%'
  UNION ALL SELECT 'OB4 org login membership not exactly iios_app(inherit,noset,noadmin): '||r.rolname FROM pg_roles r
   WHERE r.rolname LIKE 'iios\_app\_o\_%' AND ((SELECT count(*) FROM pg_auth_members m WHERE m.member = r.oid) <> 1
      OR NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid AND pg_get_userbyid(m.roleid) = 'iios_app'
                       AND m.inherit_option AND NOT m.set_option AND NOT m.admin_option))
  UNION ALL SELECT 'OB5 unmapped org login: '||r.rolname FROM pg_roles r
   WHERE r.rolname LIKE 'iios\_app\_o\_%' AND NOT EXISTS (SELECT 1 FROM iios.org_roles o WHERE o.role_name = r.rolname)
  UNION ALL SELECT 'OB6 provisioner-like role exists: '||rolname FROM pg_roles WHERE rolname ~* 'provision'
$$;
REVOKE ALL ON FUNCTION guard.admission_violations(), guard.onboarding_violations(), guard.violations(), guard.snapshot() FROM PUBLIC;

CREATE FUNCTION guard.on_ddl_end() RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, guard, pg_temp AS $$
DECLARE v text;
BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = session_user) THEN RETURN; END IF;
  SELECT x INTO v FROM guard.admission_violations() x LIMIT 1;
  IF v IS NULL THEN v := guard.violations(); END IF;
  IF v IS NOT NULL THEN RAISE EXCEPTION 'iios guard (ddl_command_end/%): %', tg_tag, v USING ERRCODE = '42501'; END IF;
END $$;
CREATE FUNCTION guard.on_sql_drop() RETURNS event_trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, guard, pg_temp AS $$
DECLARE d record;
BEGIN
  IF (SELECT rolsuper FROM pg_roles WHERE rolname = session_user) THEN RETURN; END IF;
  FOR d IN SELECT * FROM pg_event_trigger_dropped_objects() LOOP
    IF d.objid IN (SELECT relid FROM guard.reg_tables UNION ALL SELECT polid FROM guard.reg_policies UNION ALL SELECT fid FROM guard.reg_functions
                   UNION ALL SELECT tgid FROM guard.reg_triggers UNION ALL SELECT nspid FROM guard.reg_schemas) THEN
      RAISE EXCEPTION 'iios guard (sql_drop/%): protected % % cannot be dropped', tg_tag, d.object_type, d.object_identity USING ERRCODE = '42501';
    END IF;
  END LOOP;
END $$;
CREATE EVENT TRIGGER iios_guard_ddl_end ON ddl_command_end EXECUTE FUNCTION guard.on_ddl_end();
CREATE EVENT TRIGGER iios_guard_sql_drop ON sql_drop EXECUTE FUNCTION guard.on_sql_drop();

SELECT guard.snapshot();
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM guard.admission_violations()) THEN
    RAISE EXCEPTION 'setup admission gate failed: %', (SELECT string_agg(x, '; ') FROM guard.admission_violations() x);
  END IF;
  IF EXISTS (SELECT 1 FROM guard.onboarding_violations()) THEN
    RAISE EXCEPTION 'setup onboarding gate failed: %', (SELECT string_agg(x, '; ') FROM guard.onboarding_violations() x);
  END IF;
END $$;
