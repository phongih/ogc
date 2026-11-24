// Public course showcase on the Platform API (owner 23/11): staff choose what is shown (outside the
// immutable versions); the public page ranks by fit for what the visitor chose, never by price;
// a minimal enquiry becomes an Admissions lead with its origin (rate-limited).
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  Lead,
  ShowcaseDetail,
  ShowcaseOrg,
  ShowcasePage,
  ShowcaseSettings,
} from "@ogc/contracts";
import { buildIiosMock, type IiosMockState } from "@ogc/iios-mock";
import { httpIiosClient } from "./iios.js";
import { buildApi } from "./server.js";
import { LUMEN, NOVA, seedDev } from "./seed.js";
import { freshDb, hasPg, type TestDb } from "./test/pg.js";

const SECRET = "showc-test-secret-0123456789abcde";
const NOW = Date.parse("2026-11-23T05:00:00Z"); // Mon 12:00 center time; Term 1 ends 30/11
const SAM = "iios-principal-staff-1";
const TARA = "iios-principal-teacher-1";
let seq = 0;
const key = () => `show-${Date.now()}-${++seq}-abc`;

describe.skipIf(!hasPg)("public course showcase — API", () => {
  let t: TestDb;
  let iios: ReturnType<typeof buildIiosMock>["app"];
  let state: IiosMockState;
  let iiosUrl = "";
  let api: ReturnType<typeof buildApi>;

  beforeAll(async () => {
    ({ app: iios, state } = buildIiosMock({
      key: randomBytes(32),
      clientId: "ogc",
      clientSecret: SECRET,
    }));
    await iios.listen({ host: "127.0.0.1", port: 0 });
    iiosUrl = `http://127.0.0.1:${(iios.server.address() as AddressInfo).port}`;
  });
  let now = NOW;
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
    return (method: "GET" | "POST" | "PUT", url: string, body?: unknown) =>
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
  const ownerQuery = async (q: string, params: unknown[] = []) => {
    const c = new pg.Client({ connectionString: t.ownerUrl });
    await c.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.org_id', $1, true)", [NOVA]);
      const r = await c.query(q, params);
      await c.query("commit");
      return r;
    } finally {
      await c.end();
    }
  };
  const pub = (method: "GET" | "POST", url: string, body?: object, ip = "203.0.113.7") =>
    api.inject({
      method,
      url,
      remoteAddress: "127.0.0.1",
      headers: { "x-forwarded-for": ip },
      ...(body ? { payload: body } : {}),
    });
  const S = "/v1/public/showcase/nova-learning";
  const page = async (q = "") => (await pub("GET", `${S}${q}`)).json() as ShowcasePage;
  const detail = (ref: string) => pub("GET", `${S}/courses/${ref}`);
  const enquire = (ref: string, body: object, ip?: string) =>
    pub(
      "POST",
      `${S}/courses/${ref}/enquiries`,
      {
        learnerName: "Hien D.",
        centerName: "Nova English — District 1",
        kind: "consult",
        needs: [],
        ...body,
      },
      ip,
    );
  const setShow = (c: Call, ref: string, body: object) =>
    c("POST", `/v1/courses/${ref}/showcase`, body);
  const A2 = "CS-A2-EVERYDAY";
  const B1 = "CS-B1-SPEAK";
  const IELTS = "CS-IELTS-W1";

  it("the public page: published courses staff chose, with offer, price and centers", async () => {
    expect((await pub("GET", "/v1/public/showcase")).json() as ShowcaseOrg[]).toEqual([
      { slug: "nova-learning", name: "Nova Learning", courses: 3 },
    ]); // Lumen shows nothing yet
    const p = await page();
    expect(p).toMatchObject({
      org: { slug: "nova-learning", name: "Nova Learning" },
      levels: ["A2", "B1", "IELTS"],
      needs: ["exam_prep", "speaking_confidence", "work_english", "travel"],
    });
    expect(p.courses.map((c) => [c.ref, c.offer, c.priceFromVnd, c.centers, c.fit.points])).toEqual(
      [
        [A2, "trial", 6_900_000, ["Nova English — District 1"], 0],
        [B1, "paid", 8_400_000, ["Nova English — Thu Duc"], 0],
        [IELTS, "free", null, [], 0],
      ],
    );
    // the latest PUBLISHED version — never the draft (B1 has a third lesson in its draft)
    const b1 = (await detail(B1)).json() as ShowcaseDetail;
    expect([b1.version, b1.lessons, b1.path.map((l) => l.title)]).toEqual([
      1,
      2,
      ["Giving opinions", "Agreeing politely"],
    ]);
    expect(JSON.stringify(b1)).not.toMatch(/correct|options|blocks/); // lesson content stays for learners
    expect(b1.allCenters).toHaveLength(3);
    expect((await detail("CS-A2-PHONICS")).statusCode).toBe(404); // never published
    expect((await detail("CS-LUMEN-STARTER")).statusCode).toBe(404); // another organization
    expect((await pub("GET", "/v1/public/showcase/nobody")).statusCode).toBe(404);
    expect((await pub("GET", "/v1/public/showcase/lumen-edu")).json().courses).toEqual([]);
  });

  it("ranking: fit for what the visitor chose, with reasons — never price or offer", async () => {
    const p = await page(
      `?level=B1&needs=work_english,exam_prep&center=${encodeURIComponent("Nova English — Thu Duc")}`,
    );
    expect(p.courses.map((c) => [c.ref, c.fit.points])).toEqual([
      [B1, 100],
      [IELTS, 30],
      [A2, 0],
    ]);
    expect(p.courses[0].fit.reasons).toEqual([
      "Level B1, as you chose",
      "For english for work",
      "A class runs at Nova English — Thu Duc",
    ]);
    // unknown values are ignored, not trusted
    const odd = await page("?needs=cheap,<b>&center=Moon");
    expect(odd.courses.every((c) => c.fit.points === 0)).toBe(true);
    // making B1 free (and A2 paid) changes nothing in the order for the same choice
    const sam = await as(SAM);
    await setShow(sam, B1, {
      isPublic: true,
      offer: "free",
      catalogCode: "ENG-B1",
      needs: ["speaking_confidence", "work_english"],
    });
    await setShow(sam, A2, {
      isPublic: true,
      offer: "paid",
      catalogCode: "ENG-A2",
      needs: ["speaking_confidence", "travel"],
    });
    const again = await page("?needs=speaking_confidence");
    expect(again.courses.map((c) => c.ref)).toEqual([A2, B1, IELTS]); // ties → by title
  });

  it("staff with courses:author set the showcase outside the versions; teachers and policies refused", async () => {
    const sam = await as(SAM);
    const s = (await sam("GET", `/v1/courses/${IELTS}/showcase`)).json() as ShowcaseSettings;
    expect(s).toMatchObject({
      isPublic: true,
      offer: "free",
      catalogCode: "IELTS-B2",
      needs: ["exam_prep"],
      publishedVersion: 1,
      updatedBy: "Sam (Org Staff)",
    });
    for (const [body, status, detail] of [
      [{ isPublic: true, offer: "free", catalogCode: null, needs: [] }, 422, /catalog course/],
      [{ isPublic: true, offer: "free", catalogCode: "ENG-Z9", needs: [] }, 422, /unknown catalog/],
      [{ isPublic: true, offer: "cheap", catalogCode: "ENG-A2", needs: [] }, 422, /offer/],
      [
        { isPublic: true, offer: "free", catalogCode: "ENG-A2", needs: ["dating"] },
        422,
        /learning need/,
      ],
      [
        { isPublic: true, offer: "free", catalogCode: "ENG-A2", needs: ["travel", "travel"] },
        422,
        /repeated/,
      ],
      [{ isPublic: "yes", offer: "free", catalogCode: "ENG-A2", needs: [] }, 422, /on or off/],
      [
        { isPublic: false, offer: "free", catalogCode: "ENG-A2", needs: [], rank: 1 },
        422,
        /unknown field/,
      ],
    ] as const) {
      const r = await setShow(sam, IELTS, body);
      expect(r.statusCode).toBe(status);
      expect(r.json().detail).toMatch(detail);
    }
    const never = await setShow(sam, "CS-A2-PHONICS", {
      isPublic: true,
      offer: "trial",
      catalogCode: "ENG-A2",
      needs: [],
    });
    expect([never.statusCode, never.json().reason]).toEqual([409, "invalid_step"]);
    // hiding needs no catalog course
    expect(
      (
        await setShow(sam, "CS-A2-PHONICS", {
          isPublic: false,
          offer: "trial",
          catalogCode: null,
          needs: [],
        })
      ).json(),
    ).toEqual({ ok: true });
    const tara = await setShow(await as(TARA), IELTS, {
      isPublic: false,
      offer: "free",
      catalogCode: "IELTS-B2",
      needs: [],
    });
    expect([tara.statusCode, tara.json().reason]).toEqual([403, "not_staff"]);
    expect((await (await as(TARA))("GET", `/v1/courses/${IELTS}/showcase`)).statusCode).toBe(403);
    state.attachments.set(SAM, "policy-front-desk-d1"); // no courses:author
    const fd = await setShow(await as(SAM), IELTS, {
      isPublic: false,
      offer: "free",
      catalogCode: "IELTS-B2",
      needs: [],
    });
    expect([fd.statusCode, fd.json().reason]).toEqual([403, "access_policy"]);
    state.attachments.delete(SAM);
    expect(
      (
        await setShow(sam, IELTS, {
          isPublic: false,
          offer: "free",
          catalogCode: "IELTS-B2",
          needs: ["exam_prep"],
        })
      ).json(),
    ).toEqual({ ok: true });
    expect((await page()).courses.map((c) => c.ref)).toEqual([A2, B1]);
    expect((await detail(IELTS)).statusCode).toBe(404);
    // the published content itself never changed
    const v = await ownerQuery(
      "select count(*)::int as n from course_version where course_ref = $1",
      [IELTS],
    );
    expect(v.rows[0].n).toBe(1);
  });

  it("an enquiry: name, center, needs and kind only → an Admissions lead with its origin", async () => {
    for (const [body, detail] of [
      [{ learnerName: "H" }, /2–60/],
      [{ learnerName: "Hien 0912345678" }, /no phone numbers/],
      [{ learnerName: "hien@example.org" }, /no phone numbers/],
      [{ centerName: "Moon" }, /unknown center/],
      [{ needs: ["dating"] }, /learning need/],
      [{ kind: "buy" }, /consultation or trial/],
    ] as const) {
      const r = await enquire(A2, body, `198.51.100.${JSON.stringify(body).length}`);
      expect(r.statusCode).toBe(422);
      expect(r.json().detail).toMatch(detail);
    }
    const noTrial = await enquire(B1, { kind: "trial" }, "198.51.100.200");
    expect(noTrial.json().detail).toBe("this course has no trial lesson");
    expect((await enquire("CS-A2-PHONICS", {}, "198.51.100.201")).statusCode).toBe(404);
    const ok = await enquire(A2, {
      learnerName: " Hien  D. ",
      kind: "trial",
      needs: ["travel", "travel"],
    });
    expect(ok.json()).toEqual({ ok: true });
    const lead = ((await (await as(SAM))("GET", "/v1/admissions/leads")).json() as Lead[]).find(
      (l) => l.learnerName === "Hien D.",
    )!;
    expect(lead).toMatchObject({
      source: "website",
      courseCode: "ENG-A2",
      centerName: "Nova English — District 1",
      needs: ["travel"],
      stage: "new",
      referredBy: null,
      origin: "Showcase · CS-A2-EVERYDAY v2 · Trial · trial lesson",
    });
    expect(lead.stageHistory[0].by).toBe("Public showcase");
    const a = await ownerQuery(
      "select principal_id, outcome, resource from audit_event where action = 'showcase:enquiry' order by at desc limit 1",
    );
    expect(a.rows[0]).toMatchObject({
      principal_id: "public",
      outcome: "allowed",
      resource: { ref: A2 },
    });
    // nothing goes to a partner from here
    const refs = await ownerQuery(
      "select count(*)::int as n from commission_entry where learner_display_name = 'Hien D.'",
    );
    expect(refs.rows[0].n).toBe(0);
  });

  it("enquiries are rate-limited per address", async () => {
    for (let i = 0; i < 5; i++)
      expect(
        (await enquire(A2, { learnerName: `Guest ${String.fromCharCode(65 + i)}.` })).statusCode,
      ).toBe(200);
    const sixth = await enquire(A2, { learnerName: "Guest F." });
    expect([sixth.statusCode, sixth.json().reason]).toEqual([429, "too_many_requests"]);
    expect((await enquire(A2, { learnerName: "Guest G." }, "192.0.2.80")).statusCode).toBe(200);
  });

  it("the directory is read-only for the application; settings stay in their organization", async () => {
    const app = new pg.Client({ connectionString: t.appUrl });
    await app.connect();
    try {
      await expect(
        app.query("insert into public_org (slug, org_id, name) values ('x', $1, 'X')", [NOVA]),
      ).rejects.toThrow(/permission denied/);
      await expect(app.query("delete from course_showcase")).rejects.toThrow(/permission denied/);
      await app.query("begin");
      await app.query("select set_config('app.org_id', $1, true)", [LUMEN]);
      expect((await app.query("select * from course_showcase")).rows).toEqual([]);
      await app.query("rollback");
    } finally {
      await app.end();
    }
  });
});
