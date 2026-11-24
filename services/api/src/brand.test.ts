// Brand & provider profile on the Platform API (owner 24/11): the organization's public profile,
// teachers' own opt-in profiles, badges verified maker-checker (fake Credly register, certificates
// seen by hand); the public sees only verified, unexpired badges and no contact details.
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { BrandAdmin, MyPublicProfile, PublicBrand, ShowcaseDetail } from "@ogc/contracts";
import { buildIiosMock, type IiosMockState } from "@ogc/iios-mock";
import { httpIiosClient } from "./iios.js";
import { buildApi } from "./server.js";
import { fakeCredly } from "./credentials.js";
import { hasContact } from "./domains/brand.js";
import { LUMEN, NOVA, seedDev } from "./seed.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const SECRET = "brand-test-secret-0123456789abcde";
const NOW = Date.parse("2026-11-24T05:00:00Z"); // Tue 12:00 center time
const SAM = "iios-principal-staff-1";
const OLIVIA = "iios-principal-admin-1";
const TARA = "iios-principal-teacher-1";
const BEN = "iios-principal-teacher-2";
const LUMEN_STAFF = "iios-principal-staff-org2";
let seq = 0;
const key = () => `brand-${Date.now()}-${++seq}-abc`;

describe("fake Credly register (no network)", () => {
  it("the code alone decides: valid, revoked (-R), expired (-X), unknown", async () => {
    expect(await fakeCredly.check("MOCK-TARA-SAC1")).toBe("valid");
    expect(await fakeCredly.check("MOCK-TARA-YLM2-R")).toBe("revoked");
    expect(await fakeCredly.check("MOCK-OLD-X")).toBe("expired");
    expect(await fakeCredly.check("CRDL-1234")).toBe("unknown");
    expect(await fakeCredly.check("mock-lower")).toBe("unknown");
    expect(fakeCredly.source).toBe("credly_mock");
  });
  it("contact details are spotted; years are not", () => {
    expect(hasContact("Teaching since 2015")).toBe(false);
    expect(hasContact("Call 0903 123 456")).toBe(true);
    expect(hasContact("tara@nova.test")).toBe(true);
    expect(hasContact("see https://x.test")).toBe(true);
    expect(hasContact("www.nova.test")).toBe(true);
  });
});

describe.skipIf(!hasPg)("brand & provider profile — API", () => {
  let t: TestDb;
  let iios: ReturnType<typeof buildIiosMock>["app"];
  let state: IiosMockState;
  let iiosUrl = "";
  let api: ReturnType<typeof buildApi>;
  let now = NOW;

  beforeAll(async () => {
    ({ app: iios, state } = buildIiosMock({
      key: randomBytes(32),
      clientId: "ogc",
      clientSecret: SECRET,
    }));
    await iios.listen({ host: "127.0.0.1", port: 0 });
    iiosUrl = `http://127.0.0.1:${(iios.server.address() as AddressInfo).port}`;
  });
  beforeEach(async () => {
    now = NOW;
    await api?.close();
    await t?.drop();
    t = await freshDb();
    await seedDev(t.ownerUrl, NOW);
    state.attachments.clear();
    api = buildApi({
      db: t.app,
      iios: httpIiosClient({ baseUrl: iiosUrl, clientSecret: SECRET }),
      now: () => now,
    });
    await api.ready();
  });
  afterAll(async () => {
    await api?.close();
    await iios?.close();
    await t?.drop();
  });

  const as = async (principalId: string, orgId = NOVA) => {
    const r = await fetch(`${iiosUrl}/v1/dev/grants`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ principalId, orgId }),
    });
    const g = ((await r.json()) as { grant: string }).grant;
    return (method: "GET" | "POST", url: string, body?: unknown) =>
      api.inject({
        method,
        url,
        headers: {
          authorization: `Bearer ${g}`,
          "x-ogc-org": orgId,
          ...(method !== "GET" ? { "idempotency-key": key() } : {}),
        },
        ...(body !== undefined ? { payload: body as object } : {}),
      });
  };
  type Call = Awaited<ReturnType<typeof as>>;
  const pub = (url: string) => api.inject({ method: "GET", url });
  const S = "/v1/public/showcase/nova-learning";
  const brand = async () => (await pub(`${S}/profile`)).json() as PublicBrand;
  const course = async (ref: string) => (await pub(`${S}/courses/${ref}`)).json() as ShowcaseDetail;
  const codes = (b: { badgeCode: string }[]) => b.map((x) => x.badgeCode);
  const names = (i: { displayName: string }[]) => i.map((x) => x.displayName);
  const claimBody = (over: object = {}) => ({
    title: "Blended Learning Design",
    issuer: "TESOL Practice Guild (synthetic)",
    source: "credly_mock",
    badgeCode: "MOCK-NOVA-BLD1",
    issuedOn: "2026-05-01",
    expiresOn: "2028-05-01",
    ...over,
  });
  const reason = (r: { json: () => unknown }) => (r.json() as { reason: string }).reason;
  const detailOf = (r: { json: () => unknown }) => (r.json() as { detail?: string }).detail ?? "";
  const myProfile = async (c: Call) =>
    (await c("GET", "/v1/me/public-profile")).json() as MyPublicProfile;
  const admin = async (c: Call) => (await c("GET", "/v1/brand")).json() as BrandAdmin;

  it("the public profile: tagline, colors, centers, verified unexpired badges, opted-in teachers", async () => {
    const b = await brand();
    expect(b).toMatchObject({
      org: { slug: "nova-learning", name: "Nova Learning" },
      tagline: "English that works — for school, work and travel",
      primaryColor: "#1f4e79",
      accentColor: "#e0a100",
      centers: ["Nova English — District 1", "Nova English — Thu Duc", "Nova Juniors — Cau Giay"],
      courses: 3,
    });
    // CR-1 verified; CR-2 only claimed
    expect(codes(b.badges)).toEqual(["MOCK-NOVA-QR26"]);
    expect(b.badges[0]).toEqual({
      title: "Quality-reviewed language centre 2026",
      issuer: "Saigon Learning Quality Circle (synthetic)",
      source: "credly_mock",
      badgeCode: "MOCK-NOVA-QR26",
      issuedOn: "2026-01-15",
      expiresOn: "2029-01-15",
    });
    // Tara opted in (CR-3 verified, CR-4 only claimed); Ben has a verified badge but did not opt in
    expect(b.instructors).toEqual([
      {
        displayName: "Tara",
        bio: "Teaches A2 and B1 classes. Focus: speaking confidence and clear, kind feedback.",
        badges: [expect.objectContaining({ badgeCode: "MOCK-TARA-SAC1" })],
      },
    ]);
    // never who claimed or verified, never the check note
    const raw = JSON.stringify(b);
    for (const s of ["Sam", "Olivia", "Ben", "valid on", "claimed", "principal"])
      expect(raw).not.toContain(s);
    expect((await pub("/v1/public/showcase/nope/profile")).statusCode).toBe(404);
    expect((await pub("/v1/public/showcase/NOT_A_SLUG!/profile")).statusCode).toBe(404);
    // Lumen: no profile yet — default colors, no badges, no teachers
    const l = (await pub("/v1/public/showcase/lumen-edu/profile")).json() as PublicBrand;
    expect(l).toMatchObject({ tagline: "", badges: [], instructors: [], courses: 0 });
  });

  it("a course page: the provider block and the opted-in teachers of its classes", async () => {
    const a2 = await course("CS-A2-EVERYDAY");
    expect(a2.brand).toMatchObject({ tagline: expect.stringContaining("English that works") });
    expect(codes(a2.brand.badges)).toEqual(["MOCK-NOVA-QR26"]);
    expect(names(a2.instructors)).toEqual(["Tara"]); // Ben teaches A2 Evening but is not public
    expect(names((await course("CS-B1-SPEAK")).instructors)).toEqual(["Tara"]);
    expect((await course("CS-IELTS-W1")).instructors).toEqual([]); // no class runs it

    const ben = await as(BEN);
    const r = await ben("POST", "/v1/me/public-profile", {
      isPublic: true,
      displayName: "Ben",
      bio: "Exam skills since 2019.",
    });
    expect(r.statusCode).toBe(200);
    expect(names((await course("CS-A2-EVERYDAY")).instructors)).toEqual(["Ben", "Tara"]);
    expect(names((await course("CS-B1-SPEAK")).instructors)).toEqual(["Tara"]); // Ben has no B1
    expect((await course("CS-A2-EVERYDAY")).instructors[0]!.badges.map((x) => x.badgeCode)).toEqual(
      ["MOCK-BEN-EST1"],
    );

    // turning it off removes it at once
    const tara = await as(TARA);
    const me = await myProfile(tara);
    expect(
      (
        await tara("POST", "/v1/me/public-profile", {
          isPublic: false,
          displayName: me.displayName,
          bio: me.bio,
        })
      ).statusCode,
    ).toBe(200);
    expect(names((await course("CS-A2-EVERYDAY")).instructors)).toEqual(["Ben"]);
    expect((await course("CS-B1-SPEAK")).instructors).toEqual([]);
    expect(names((await brand()).instructors)).toEqual(["Ben"]);
    // staff see the choice, not a hidden profile's name
    expect((await admin(await as(SAM))).teachers.find((x) => x.name === "Tara")).toEqual({
      name: "Tara",
      isPublic: false,
      displayName: null,
    });
  });

  it("staff with brand:manage edit the profile; others refused; nothing else changes", async () => {
    const sam = await as(SAM);
    const ok = {
      tagline: "  Small classes,   real progress ",
      about: "Two centers. Staging, synthetic.",
      primaryColor: "#0A3D62",
      accentColor: "#F6B93B",
    };
    expect((await sam("POST", "/v1/brand/profile", ok)).statusCode).toBe(200);
    const b = await brand();
    expect(b).toMatchObject({
      tagline: "Small classes, real progress",
      about: "Two centers. Staging, synthetic.",
      primaryColor: "#0a3d62",
      accentColor: "#f6b93b",
    });
    expect((await admin(sam)).profile.updatedBy).toBe("Sam (Org Staff)");
    for (const [body, detail] of [
      [{ ...ok, primaryColor: "blue" }, /#rrggbb/],
      [{ ...ok, accentColor: "#12345" }, /#rrggbb/],
      [{ ...ok, tagline: "x".repeat(121) }, /tagline/],
      [{ ...ok, about: "x".repeat(1201) }, /about/],
      [{ ...ok, tagline: 5 }, /tagline/],
      [{ ...ok, about: "Call us on 0903 123 456" }, /no phone numbers/],
      [{ ...ok, tagline: "hello@nova.test" }, /no phone numbers/],
      [{ ...ok, logo: "https://x" }, /unknown field/],
    ] as const) {
      const r = await sam("POST", "/v1/brand/profile", body);
      expect(r.statusCode, JSON.stringify(body)).toBe(422);
      expect(detailOf(r)).toMatch(detail);
    }
    expect((await brand()).tagline).toBe("Small classes, real progress");

    const tara = await as(TARA);
    expect(reason(await tara("POST", "/v1/brand/profile", ok))).toBe("not_staff");
    expect((await tara("GET", "/v1/brand")).statusCode).toBe(403);
    state.attachments.set(SAM, "policy-front-desk-d1"); // no brand:manage
    const r = await sam("POST", "/v1/brand/profile", { ...ok, tagline: "Changed" });
    expect(r.statusCode).toBe(403);
    expect(reason(r)).toBe("access_policy");
    expect((await admin(sam)).canManage).toBe(false);
    expect((await brand()).tagline).toBe("Small classes, real progress");

    // another organization's staff only touch their own profile
    const lumen = await as(LUMEN_STAFF, LUMEN);
    expect((await lumen("POST", "/v1/brand/profile", { ...ok, tagline: "Lumen" })).statusCode).toBe(
      200,
    );
    expect((await brand()).tagline).toBe("Small classes, real progress");
    expect(
      ((await pub("/v1/public/showcase/lumen-edu/profile")).json() as PublicBrand).tagline,
    ).toBe("Lumen");
  });

  it("the staff view: every badge with its state, teachers' choice read-only", async () => {
    const a = await admin(await as(SAM));
    expect(a.canManage).toBe(true);
    expect(a.org).toEqual({ slug: "nova-learning", name: "Nova Learning" });
    expect(a.credentials.map((c) => [c.id, c.holderName, c.status, c.mine])).toEqual([
      ["CR-2", "Nova Learning", "claimed", true],
      ["CR-4", "Tara", "claimed", false],
      ["CR-1", "Nova Learning", "verified", true],
      ["CR-5", "Ben", "verified", false],
      ["CR-3", "Tara", "verified", false],
    ]);
    expect(a.credentials.find((c) => c.id === "CR-1")).toMatchObject({
      claimedBy: "Sam (Org Staff)",
      decidedBy: "Olivia (Org Admin)",
      note: "Credly (mock): valid on 2026-01-20",
      expired: false,
    });
    expect(a.teachers).toEqual([
      { name: "Ben", isPublic: false, displayName: null },
      { name: "Khang", isPublic: false, displayName: null },
      { name: "Mia", isPublic: false, displayName: null },
      { name: "Tara", isPublic: true, displayName: "Tara" },
    ]);
    // staff have no way to publish a teacher
    expect(
      (
        await (
          await as(SAM)
        )("POST", "/v1/me/public-profile", { isPublic: true, displayName: "Ben", bio: "" })
      ).statusCode,
    ).toBe(403);
  });

  it("claim → verify by someone else (maker-checker); the fake Credly must say valid", async () => {
    const sam = await as(SAM);
    const olivia = await as(OLIVIA);
    const c = await sam("POST", "/v1/brand/credentials", claimBody());
    expect(c.statusCode).toBe(200);
    expect(c.json()).toEqual({ ok: true, id: "CR-6" });
    expect(codes((await brand()).badges)).toEqual(["MOCK-NOVA-QR26"]); // not before it is verified

    const own = await sam("POST", "/v1/brand/credentials/CR-6/verify", {});
    expect(own.statusCode).toBe(403);
    expect(reason(own)).toBe("maker_checker");
    expect((await olivia("POST", "/v1/brand/credentials/CR-6/verify", {})).statusCode).toBe(200);
    expect(codes((await brand()).badges).sort()).toEqual(["MOCK-NOVA-BLD1", "MOCK-NOVA-QR26"]);
    expect((await admin(sam)).credentials.find((x) => x.id === "CR-6")).toMatchObject({
      status: "verified",
      claimedBy: "Sam (Org Staff)",
      decidedBy: "Olivia (Org Admin)",
      note: "Credly (mock): valid on 2026-11-24",
    });
    const again = await olivia("POST", "/v1/brand/credentials/CR-6/verify", {});
    expect(again.statusCode).toBe(409);
    expect(reason(again)).toBe("invalid_step");

    // the register says revoked → refused; then rejected once with a reason
    const rev = await sam("POST", "/v1/brand/credentials/CR-4/verify", {});
    expect(rev.statusCode).toBe(409);
    expect(reason(rev)).toBe("credential_check");
    expect(detailOf(rev)).toBe("Credly (mock) says: revoked");
    expect(reason(await sam("POST", "/v1/brand/credentials/CR-4/reject", { reason: "x" }))).toBe(
      "invalid",
    );
    expect(
      (await sam("POST", "/v1/brand/credentials/CR-4/reject", { reason: "Revoked at the issuer" }))
        .statusCode,
    ).toBe(200);
    expect(
      reason(await sam("POST", "/v1/brand/credentials/CR-4/reject", { reason: "Again please" })),
    ).toBe("invalid_step");
    expect(reason(await sam("POST", "/v1/brand/credentials/CR-4/verify", {}))).toBe("invalid_step");
    expect(reason(await sam("POST", "/v1/brand/credentials/CR-99/verify", {}))).toBe("not_found");

    // the claimant cannot reject their own either
    expect(reason(await sam("POST", "/v1/brand/credentials/CR-2/reject", { reason: "Mine" }))).toBe(
      "maker_checker",
    );

    // expired at the register; unknown to it
    for (const [code, said] of [
      ["MOCK-OLD-BADGE-X", "expired"],
      ["CRDL-0001", "unknown"],
    ]) {
      const r = await sam("POST", "/v1/brand/credentials", claimBody({ badgeCode: code }));
      const id = (r.json() as { id: string }).id;
      const v = await olivia("POST", `/v1/brand/credentials/${id}/verify`, {});
      expect(v.statusCode).toBe(409);
      expect(detailOf(v)).toBe(`Credly (mock) says: ${said}`);
    }
  });

  it("a certificate is verified only when someone else confirms they saw it", async () => {
    const olivia = await as(OLIVIA);
    const r = await olivia("POST", "/v1/brand/credentials/CR-2/verify", {});
    expect(r.statusCode).toBe(422);
    expect(detailOf(r)).toMatch(/seen the certificate/);
    expect(reason(await olivia("POST", "/v1/brand/credentials/CR-2/verify", { seen: "yes" }))).toBe(
      "invalid",
    );
    expect(
      (await olivia("POST", "/v1/brand/credentials/CR-2/verify", { seen: true })).statusCode,
    ).toBe(200);
    expect((await admin(olivia)).credentials.find((x) => x.id === "CR-2")!.note).toBe(
      "Certificate seen by Olivia (Org Admin) on 2026-11-24",
    );
    expect(codes((await brand()).badges)).toContain("CERT-LSF-0042");
  });

  it("claims are checked: code, dates, source, duplicates, fields; policies and roles", async () => {
    const sam = await as(SAM);
    for (const [over, status, detail] of [
      [{ badgeCode: "ab" }, 422, /badge code/],
      [{ badgeCode: "MOCK NOVA" }, 422, /badge code/],
      [{ title: "ab" }, 422, /title/],
      [{ issuer: "x" }, 422, /issuer/],
      [{ issuer: "Guild — call 0903 123 456" }, 422, /no phone numbers/],
      [{ source: "linkedin" }, 422, /source/],
      [{ issuedOn: "2026-13-01" }, 422, /issue date/],
      [{ issuedOn: "2026-02-30" }, 422, /issue date/],
      [{ issuedOn: "2026-12-01" }, 422, /issue date/], // in the future
      [{ expiresOn: "2026-04-01" }, 422, /expiry date/], // before the issue date
      [{ issuedOn: "2024-01-01", expiresOn: "2026-11-23" }, 422, /already expired/],
      [{ holder: "Tara" }, 422, /unknown field/],
      [{ badgeCode: "MOCK-TARA-SAC1" }, 409, /already CR-3/],
    ] as const) {
      const r = await sam("POST", "/v1/brand/credentials", claimBody(over));
      expect(r.statusCode, JSON.stringify(over)).toBe(status);
      expect(detailOf(r)).toMatch(detail);
    }
    // a lower-case code is the same badge; no expiry is fine
    const ok = await sam(
      "POST",
      "/v1/brand/credentials",
      claimBody({ badgeCode: " mock-nova-bld1 ", expiresOn: null }),
    );
    expect(ok.json()).toEqual({ ok: true, id: "CR-6" });
    expect(
      (await sam("POST", "/v1/brand/credentials", claimBody({ badgeCode: "MOCK-NOVA-BLD1" })))
        .statusCode,
    ).toBe(409);
    // the same code from another source is another badge
    expect(
      (
        await sam(
          "POST",
          "/v1/brand/credentials",
          claimBody({ source: "certificate", badgeCode: "MOCK-NOVA-BLD1" }),
        )
      ).json(),
    ).toEqual({ ok: true, id: "CR-7" });

    state.attachments.set(SAM, "policy-front-desk-d1");
    expect(
      reason(await sam("POST", "/v1/brand/credentials", claimBody({ badgeCode: "MOCK-A1B2" }))),
    ).toBe("access_policy");
    expect(reason(await sam("POST", "/v1/brand/credentials/CR-2/withdraw", { reason: "No" }))).toBe(
      "access_policy",
    );
    const tara = await as(TARA);
    expect(reason(await tara("POST", "/v1/brand/credentials/CR-4/verify", {}))).toBe("not_staff");
    expect(
      reason(await tara("POST", "/v1/brand/credentials", claimBody({ badgeCode: "MOCK-ZZ12" }))),
    ).toBe("not_staff");
  });

  it("a teacher: their own profile and badges only; another person verifies", async () => {
    const tara = await as(TARA);
    const sam = await as(SAM);
    const me = await myProfile(tara);
    expect(me).toMatchObject({ name: "Tara", isPublic: true, displayName: "Tara" });
    expect(me.credentials.map((c) => [c.id, c.status, c.mine])).toEqual([
      ["CR-4", "claimed", true],
      ["CR-3", "verified", true],
    ]);
    for (const [body, detail] of [
      [{ isPublic: "yes", displayName: "Tara", bio: "" }, /on or off/],
      [{ isPublic: true, displayName: "T", bio: "" }, /display name/],
      [{ isPublic: true, displayName: "Tara", bio: "x".repeat(401) }, /bio/],
      [{ isPublic: true, displayName: "Tara", bio: "Zalo 0903123456" }, /no phone numbers/],
      [{ isPublic: true, displayName: "tara@nova.test", bio: "" }, /no phone numbers/],
      [{ isPublic: true, displayName: "Tara", bio: "", photo: "x.png" }, /unknown field/],
    ] as const) {
      const r = await tara("POST", "/v1/me/public-profile", body);
      expect(r.statusCode, JSON.stringify(body)).toBe(422);
      expect(detailOf(r)).toMatch(detail);
    }
    expect(
      (
        await tara("POST", "/v1/me/public-profile", {
          isPublic: true,
          displayName: "Ms Tara",
          bio: "  Speaking  coach. ",
        })
      ).statusCode,
    ).toBe(200);
    expect(names((await brand()).instructors)).toEqual(["Ms Tara"]);
    expect((await brand()).instructors[0]!.bio).toBe("Speaking coach.");

    // a teacher claims for themselves; staff verify; the teacher cannot
    const c = await tara(
      "POST",
      "/v1/me/public-profile/credentials",
      claimBody({ badgeCode: "MOCK-TARA-NEW9" }),
    );
    expect(c.json()).toEqual({ ok: true, id: "CR-6" });
    expect((await admin(sam)).credentials.find((x) => x.id === "CR-6")).toMatchObject({
      holder: "teacher",
      holderName: "Tara",
      claimedBy: "Tara",
      mine: false,
    });
    expect(reason(await tara("POST", "/v1/brand/credentials/CR-6/verify", {}))).toBe("not_staff");
    expect((await sam("POST", "/v1/brand/credentials/CR-6/verify", {})).statusCode).toBe(200);
    expect(codes((await brand()).instructors[0]!.badges).sort()).toEqual([
      "MOCK-TARA-NEW9",
      "MOCK-TARA-SAC1",
    ]);

    // withdraw: own badges only; a withdrawn badge leaves the public at once
    expect(
      reason(
        await tara("POST", "/v1/me/public-profile/credentials/CR-5/withdraw", {
          reason: "Not mine",
        }),
      ),
    ).toBe("not_found");
    expect(
      reason(await tara("POST", "/v1/me/public-profile/credentials/CR-3/withdraw", { reason: "" })),
    ).toBe("invalid");
    expect(
      (
        await tara("POST", "/v1/me/public-profile/credentials/CR-3/withdraw", {
          reason: "Out of date",
        })
      ).statusCode,
    ).toBe(200);
    expect(codes((await brand()).instructors[0]!.badges)).toEqual(["MOCK-TARA-NEW9"]);
    expect(
      reason(
        await tara("POST", "/v1/me/public-profile/credentials/CR-3/withdraw", { reason: "Again" }),
      ),
    ).toBe("invalid_step");
    const w = (await myProfile(tara)).credentials.find((x) => x.id === "CR-3")!;
    expect(w).toMatchObject({ status: "withdrawn", decidedBy: "Tara", note: "Out of date" });
    // a claimed one may be withdrawn too; staff may withdraw any
    expect(
      (await tara("POST", "/v1/me/public-profile/credentials/CR-4/withdraw", { reason: "Revoked" }))
        .statusCode,
    ).toBe(200);
    expect(
      (await sam("POST", "/v1/brand/credentials/CR-1/withdraw", { reason: "Renewal pending" }))
        .statusCode,
    ).toBe(200);
    expect((await brand()).badges).toEqual([]);
    expect(reason(await sam("POST", "/v1/brand/credentials/CR-1/verify", {}))).toBe("invalid_step");

    // staff and learners have no "my public profile"
    expect(reason(await sam("POST", "/v1/me/public-profile/credentials", claimBody()))).toBe(
      "not_teacher",
    );
    expect((await sam("GET", "/v1/me/public-profile")).statusCode).toBe(403);
  });

  it("a badge past its expiry date leaves the public page; it cannot be verified then", async () => {
    now = Date.parse("2029-02-01T05:00:00Z");
    expect((await brand()).badges).toEqual([]); // CR-1 expired 15/01/2029
    expect((await admin(await as(SAM))).credentials.find((x) => x.id === "CR-1")!.expired).toBe(
      true,
    );
    const sam = await as(SAM);
    await sam(
      "POST",
      "/v1/brand/credentials",
      claimBody({ issuedOn: "2025-01-01", expiresOn: "2029-03-01" }),
    );
    now = Date.parse("2029-03-05T05:00:00Z");
    const r = await (await as(OLIVIA))("POST", "/v1/brand/credentials/CR-6/verify", {});
    expect(r.statusCode).toBe(409);
    expect(detailOf(r)).toMatch(/expired/);
  });

  it("the database keeps decisions once, maker-checker, and each organization apart", async () => {
    const app = new pg.Client({ connectionString: t.appUrl });
    await app.connect();
    const inOrg = async (org: string, q: string, params: unknown[] = []) => {
      await app.query("begin");
      try {
        await app.query("select set_config('app.org_id', $1, true)", [org]);
        return await app.query(q, params);
      } finally {
        await app.query("rollback");
      }
    };
    try {
      await expect(
        inOrg(NOVA, "update credential set title = 'X' where id = 'CR-3'"),
      ).rejects.toThrow(/permission denied/);
      await expect(
        inOrg(NOVA, "update credential set claimed_by = 'x' where id = 'CR-3'"),
      ).rejects.toThrow(/permission denied/);
      await expect(inOrg(NOVA, "delete from credential")).rejects.toThrow(/permission denied/);
      await expect(inOrg(NOVA, "delete from teacher_profile")).rejects.toThrow(/permission denied/);
      await expect(
        inOrg(
          NOVA,
          "update credential set status = 'claimed', decided_by = null, decided_by_name = null, decided_at = null where id = 'CR-3'",
        ),
      ).rejects.toThrow(/already decided/);
      await expect(
        inOrg(NOVA, "update credential set note = 'changed' where id = 'CR-3'"),
      ).rejects.toThrow(/already decided/);
      // the claimant deciding their own badge
      await expect(
        inOrg(
          NOVA,
          "update credential set status = 'verified', decided_by = claimed_by, decided_by_name = 'Sam', decided_at = now(), note = 'own' where id = 'CR-2'",
        ),
      ).rejects.toThrow(/check constraint/);
      // a verified badge without a verifier
      await expect(
        inOrg(NOVA, "update credential set status = 'verified' where id = 'CR-2'"),
      ).rejects.toThrow(/check constraint/);
      // rejected stays rejected
      await expect(
        inOrg(
          NOVA,
          `update credential set status = 'rejected', decided_by = 'iios-principal-admin-1', decided_by_name = 'Olivia', decided_at = now(), note = 'nope' where id = 'CR-2';
           update credential set status = 'withdrawn', withdrawn_by_name = 'x', withdrawn_at = now(), withdraw_reason = 'xyz' where id = 'CR-2'`,
        ),
      ).rejects.toThrow(/cannot move from rejected/);
      await expect(
        inOrg(NOVA, "update credential set status = 'withdrawn' where id = 'CR-3'"),
      ).rejects.toThrow(/check constraint/); // a withdrawal names who and why
      expect((await inOrg(LUMEN, "select * from credential")).rows).toEqual([]);
      expect((await inOrg(LUMEN, "select * from teacher_profile")).rows).toEqual([]);
      expect((await inOrg(LUMEN, "select * from brand_profile")).rows).toEqual([]);
      await expect(
        inOrg(
          LUMEN,
          "insert into brand_profile (org_id, primary_color, accent_color, updated_by, updated_at) values ($1, '#000000', '#ffffff', 'x', now())",
          [NOVA],
        ),
      ).rejects.toThrow(/row-level security/);
    } finally {
      await app.end();
    }
  });
});
