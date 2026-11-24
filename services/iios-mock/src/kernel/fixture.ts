// IIOS kernel synthetic fixture — faithful transcription of the reviewed harness
// `suite.mjs` exports makeFixture / loadFixture / uuid (source sha256 recorded in
// kernel/PROVENANCE.md). Synthetic data only; not production data, not product code.
//
// This is the r1/r2 authorization fixture: two organizations (alpha, beta), centers,
// classes, learners, enrollments, evidence, principals, per-center grants, class
// assignments, guardian links, consents and per-org signing keys. The kernel test
// stands this up in a throwaway database to exercise the sealed-principal, fail-closed
// read, authorization-read and D-14 (C14) invariants.
import crypto from "node:crypto";

export const uuid = (): string => crypto.randomUUID();
const sha256 = (s: string): string => crypto.createHash("sha256").update(s, "utf8").digest("hex");

/** Minimal shape of a node-postgres client/pool as the fixture uses it. */
export interface KernelDb {
  query(text: string, params?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface Principal {
  type: string;
  id: string;
  purpose: string;
  center?: string | null;
}

export interface Fixture {
  F: Record<string, string>;
  LBL: Map<string, string>;
  ENR: Record<string, string>;
  KEYS: Record<string, Buffer>;
  TEXT: Record<string, string>;
  HASH: Record<string, string>;
  P: Record<string, Principal>;
  FX: Record<string, unknown>;
}

export function makeFixture(): Fixture {
  const F: Record<string, string> = {};
  const LBL = new Map<string, string>();
  for (const n of ["c1", "c2", "cb", "K1", "K2", "KB", "L1", "L2", "L3", "LB", "T1", "T2", "T3", "S1", "S2", "S3", "SA", "SV", "PO",
                   "G1", "G2", "G3", "G4", "G5", "G6", "SVC", "SVC2"]) { F[n] = uuid(); LBL.set(F[n], n); }
  F.alpha = uuid(); F.beta = uuid();
  const ENR: Record<string, string> = { L1K1: uuid(), L1K2: uuid(), L2K1: uuid(), L3K2: uuid(), LBKB: uuid() };
  const KEYS: Record<string, Buffer> = { k1: crypto.randomBytes(32), k0: crypto.randomBytes(32), kf: crypto.randomBytes(32), kb: crypto.randomBytes(32) };
  const TEXT: Record<string, string> = { progress: "OGC synthetic consent text — progress — v1", messaging: "OGC synthetic consent text — messaging — v1" };
  const HASH: Record<string, string> = { progress: sha256(TEXT.progress), messaging: sha256(TEXT.messaging) };
  const P: Record<string, Principal> = {
    T1: { type: "teacher", id: F.T1, purpose: "teaching" }, T2: { type: "teacher", id: F.T2, purpose: "teaching" }, T3: { type: "teacher", id: F.T3, purpose: "teaching" },
    S1: { type: "staff", id: F.S1, purpose: "administration" }, S2: { type: "staff", id: F.S2, purpose: "administration" },
    S3: { type: "staff", id: F.S3, purpose: "administration" }, SA: { type: "staff", id: F.SA, purpose: "administration" },
    SV: { type: "staff", id: F.SV, purpose: "administration" }, PO: { type: "staff", id: F.PO, purpose: "administration" },
    L1: { type: "learner", id: F.L1, purpose: "progress" }, LB: { type: "learner", id: F.LB, purpose: "progress" },
    SVC: { type: "service", id: F.SVC, purpose: "report.weekly" }, SVC2: { type: "service", id: F.SVC2, purpose: "marketing" },
  };
  for (const g of ["G1", "G2", "G3", "G4", "G5", "G6"]) P[g] = { type: "guardian", id: F[g], purpose: "progress" };
  return { F, LBL, ENR, KEYS, TEXT, HASH, P, FX: {} };
}

export async function loadFixture(boot: KernelDb, X: Fixture): Promise<number> {
  const { F, ENR, KEYS, HASH, FX } = X; const a = F.alpha, b = F.beta;
  const q = (s: string, v?: unknown[]) => boot.query(s, v);
  await q("BEGIN");
  await q(`INSERT INTO iios.org_roles VALUES ('iios_app_o_alpha', $1), ('iios_app_o_beta', $2)`, [a, b]);
  await q(`INSERT INTO authz.catalog_versions VALUES ('cat-1', false), ('cat-2', true)`);
  const PURP = ["progress", "messaging", "teaching", "administration", "report.weekly", "marketing"];
  const CAPS: Array<[string, boolean]> = [["evidence.read", true], ["profile.read", true], ["authz.grant", true], ["class.assign", true], ["guardian.verify", true],
                ["privacy.officer", true], ["teacher", true], ["org.admin", false]];
  for (const v of ["cat-1", "cat-2"]) {
    for (const p of PURP) await q(`INSERT INTO authz.purposes VALUES ($1,$2)`, [v, p]);
    for (const s of ["evidence", "profile"]) await q(`INSERT INTO authz.scopes VALUES ($1,$2)`, [v, s]);
    for (const [c, g] of CAPS) await q(`INSERT INTO authz.capabilities VALUES ($1,$2,$3)`, [v, c, g]);
  }
  await q(`INSERT INTO authz.purposes VALUES ('cat-1','legacy.purpose')`);
  await q(`INSERT INTO authz.capabilities VALUES ('cat-1','legacy.cap',true)`);
  await q(`INSERT INTO app.centers VALUES ($1,$2,'c1'),($1,$3,'c2'),($4,$5,'cb')`, [a, F.c1, F.c2, b, F.cb]);
  await q(`INSERT INTO app.classes VALUES ($1,$2,$3,'K1'),($1,$4,$5,'K2'),($6,$7,$8,'KB')`, [a, F.K1, F.c1, F.K2, F.c2, b, F.KB, F.cb]);
  await q(`INSERT INTO app.learners VALUES ($1,$2,'Learner One','L-001','synthetic-private-1'),($1,$3,'Learner Two','L-002','synthetic-private-2'),
           ($1,$4,'Learner Three','L-003','synthetic-private-3'),($5,$6,'Learner Beta','B-001','synthetic-private-b')`, [a, F.L1, F.L2, F.L3, b, F.LB]);
  for (const e of [[a, ENR.L1K1, F.L1, F.K1, F.c1], [a, ENR.L1K2, F.L1, F.K2, F.c2], [a, ENR.L2K1, F.L2, F.K1, F.c1], [a, ENR.L3K2, F.L3, F.K2, F.c2], [b, ENR.LBKB, F.LB, F.KB, F.cb]]) {
    await q(`INSERT INTO app.enrollments VALUES ($1,$2,$3,$4,$5)`, e);
    await q(`INSERT INTO app.learning_evidence (org_id, learner_id, enrollment_id, class_id, center_id, content, score) VALUES ($1,$3,$2,$4,$5,'synthetic evidence',80)`, e);
  }
  const prin: Array<[string, string]> = [["T1", "teacher"], ["T2", "teacher"], ["T3", "teacher"], ["S1", "staff"], ["S2", "staff"], ["S3", "staff"], ["SA", "staff"], ["SV", "staff"], ["PO", "staff"],
    ["G1", "guardian"], ["G2", "guardian"], ["G3", "guardian"], ["G4", "guardian"], ["G5", "guardian"], ["G6", "guardian"],
    ["L1", "learner"], ["L2", "learner"], ["L3", "learner"], ["SVC", "service"], ["SVC2", "service"]];
  for (const [n, t] of prin) await q(`INSERT INTO authz.principals VALUES ($1,$2,$3,$4)`, [a, F[n], t, n]);
  await q(`INSERT INTO authz.principals VALUES ($1,$2,'learner','LB')`, [b, F.LB]);
  const g = (who: string, center: string | null, cap: string) => q(`INSERT INTO authz.staff_center_grants (org_id, staff_id, center_id, capability, catalog_version, valid_from)
      VALUES ($1,$2,$3,$4,'cat-2', now() - interval '10 days')`, [a, F[who], center, cap]);
  await g("T1", F.c1, "teacher"); await g("T3", F.c1, "teacher"); await g("T2", F.c2, "teacher");
  await g("S1", F.c1, "evidence.read"); await g("S2", F.c2, "evidence.read"); await g("S3", F.c1, "evidence.read"); await g("S3", F.c2, "evidence.read");
  for (const cap of ["org.admin", "authz.grant", "class.assign", "evidence.read"]) await g("SA", null, cap);
  await g("SV", null, "guardian.verify"); await g("PO", null, "privacy.officer");
  const asg = async (t: string, k: string, c: string, from: string, to: string | null) => (await q(`INSERT INTO authz.class_assignments (org_id, teacher_id, class_id, center_id, valid_from, valid_to)
      VALUES ($1,$2,$3,$4, now() - $5::interval, now() - $6::interval) RETURNING assignment_id`, [a, F[t], F[k], c, from, to])).rows[0].assignment_id;
  FX.asgT1K1 = await asg("T1", "K1", F.c1, "10 days", null); await asg("T2", "K2", F.c2, "10 days", null); await asg("T3", "K1", F.c1, "30 days", "1 day");
  const link = (gd: string, l: string, verified: boolean) => q(`INSERT INTO authz.guardian_links (org_id, guardian_id, learner_id, verified_at, verified_by, evidence_ref)
      VALUES ($1,$2,$3, CASE WHEN $4 THEN now() - interval '5 days' END, CASE WHEN $4 THEN $5::uuid END, 'synthetic-doc')`, [a, F[gd], F[l], verified, F.SV]);
  await link("G1", "L1", true); await link("G2", "L2", false); await link("G3", "L3", true); await link("G4", "L1", true); await link("G5", "L1", true); await link("G6", "L2", true);
  await q(`INSERT INTO authz.consent_texts VALUES ($1,'progress','v1',$3,true),($1,'messaging','v1',$4,true),($2,'progress','v1',$3,true)`, [a, b, HASH.progress, HASH.messaging]);
  const cons = async (gd: string, l: string, purpose: string, scope: string[], revoked: boolean) => (await q(`INSERT INTO authz.consents (org_id, guardian_id, learner_id, purpose, scope, version, text_sha256, catalog_version, revoked_at, revoked_by)
      VALUES ($1,$2,$3,$4,$5,'v1',$7,'cat-2', CASE WHEN $6 THEN now() - interval '1 day' END, CASE WHEN $6 THEN $2::uuid END) RETURNING consent_id`,
      [a, F[gd], F[l], purpose, scope, revoked, purpose === "messaging" ? HASH.messaging : HASH.progress])).rows[0].consent_id;
  FX.consG1 = await cons("G1", "L1", "progress", ["evidence", "profile"], false);
  FX.consG3 = await cons("G3", "L3", "progress", ["evidence"], true);
  FX.consG4 = await cons("G4", "L1", "messaging", ["evidence"], false);
  FX.consG5 = await cons("G5", "L1", "progress", ["profile"], false);
  FX.consG6 = await cons("G6", "L2", "progress", ["evidence", "profile"], false);
  const key = (org: string, id: string, nb: string, na: string, revoked: boolean) => q(`INSERT INTO authz.principal_keys VALUES ($1,$2,$3, now() + $4::interval, now() + $5::interval, CASE WHEN $6 THEN now() END)`,
    [org, id, KEYS[id], nb, na, revoked]);
  await key(a, "k1", "-1 hour", "1 day", false); await key(a, "k0", "-1 hour", "1 day", true); await key(a, "kf", "1 hour", "2 days", false);
  await key(b, "kb", "-1 hour", "1 day", false);
  await q("COMMIT");
  return prin.length + 1;
}
