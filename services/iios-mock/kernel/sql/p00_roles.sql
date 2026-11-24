-- p00_roles.sql — AUTHZ-RUN-002 / INT-RUN-001 / PERF-RUN-001 (bootstrap superuser, db postgres). Synthetic harness only.
-- Org login passwords: scram transport for unix-socket harnesses; the integrated harness sets PASSWORD NULL (cert-only).
\set ON_ERROR_STOP on
CREATE ROLE iios_owner NOLOGIN;
CREATE ROLE iios_app   NOLOGIN;
CREATE ROLE iios_app_o_alpha LOGIN PASSWORD :'pw_alpha';
CREATE ROLE iios_app_o_beta  LOGIN PASSWORD :'pw_beta';
GRANT iios_app TO iios_app_o_alpha, iios_app_o_beta WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;
CREATE ROLE iios_auditor   LOGIN PASSWORD :'pw_auditor';
CREATE ROLE iios_migrate   LOGIN PASSWORD :'pw_migrate';
GRANT iios_owner TO iios_migrate WITH INHERIT FALSE, SET TRUE, ADMIN FALSE;
CREATE ROLE iios_scheduler LOGIN PASSWORD :'pw_scheduler';
CREATE ROLE iios_maint     NOLOGIN;
GRANT pg_read_all_stats TO iios_maint;
CREATE DATABASE dak OWNER iios_owner;
REVOKE ALL ON DATABASE dak FROM PUBLIC;
REVOKE ALL ON DATABASE postgres FROM PUBLIC;
GRANT CONNECT ON DATABASE dak TO iios_app, iios_auditor, iios_migrate, iios_scheduler;
