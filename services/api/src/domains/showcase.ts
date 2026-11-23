/*
 * Public course showcase on the Platform API (owner 23/11; contracts/showcase.ts). SYNTHETIC:
 *  - staff with courses:author turn a course's showcase on / off outside its versions; the public
 *    always sees the LATEST PUBLISHED version (immutable content);
 *  - the public page (no grant) ranks courses by fit for what the visitor chose — level, needs,
 *    center — with the reasons; never by price or commission; nothing the visitor chose is stored;
 *  - the enquiry form takes a display name, a center, needs and the kind (consultation / trial
 *    lesson, trial only for a Trial course) — no contact details — and creates an Admissions lead
 *    (source "website") with its origin; rate-limited like /join. Partners get nothing from here.
 */
import { authorize, LEARNING_NEEDS, SHOWCASE_OFFERS } from "@ogc/contracts";
import type {
  LearningNeed,
  ShowcaseCard,
  ShowcaseDetail,
  ShowcaseEnquiry,
  ShowcaseOffer,
  ShowcaseOrg,
  ShowcasePage,
  ShowcaseSettings,
} from "@ogc/contracts";
import { sql } from "kysely";
import { withTenant, type Db, type TenantTx } from "../db.js";
import { audit } from "../audit.js";
import type { Api, Caller } from "../server.js";
import { latest, load as loadCourses } from "./courses.js";
import { createWebsiteLead } from "./admissions.js";
import { LIMITS, rateLimiter } from "./growth.js";

const NEED_LABEL: Record<LearningNeed, string> = {
  exam_prep: "Exam preparation",
  speaking_confidence: "Speaking confidence",
  school_support: "School support",
  work_english: "English for work",
  travel: "Travel",
  young_learner: "Young learners",
};
const OFFER_LABEL: Record<ShowcaseOffer, string> = { free: "Free", trial: "Trial", paid: "Paid" };
/** Fit points per thing the visitor chose (price and commission are never part of it). */
export const FIT = { level: 40, needs: 30, center: 30 } as const;

const centerToday = (now: number) => new Date(now + 7 * 3_600_000).toISOString().slice(0, 10);
const isNeed = (x: unknown): x is LearningNeed =>
  typeof x === "string" && (LEARNING_NEEDS as readonly string[]).includes(x);

interface Row {
  ref: string;
  isPublic: boolean;
  offer: ShowcaseOffer;
  catalogCode: string | null;
  needs: LearningNeed[];
  updatedBy: string | null;
  updatedAt: string | null;
}

async function settingsOf(tx: TenantTx): Promise<Map<string, Row>> {
  const rows = await tx.selectFrom("course_showcase").selectAll().execute();
  return new Map(
    rows.map((r) => [
      r.course_ref,
      {
        ref: r.course_ref,
        isPublic: r.is_public,
        offer: r.offer as ShowcaseOffer,
        catalogCode: r.catalog_code,
        needs: (r.needs as string[]).filter(isNeed),
        updatedBy: r.updated_by,
        updatedAt: new Date(r.updated_at).toISOString(),
      },
    ]),
  );
}

/** The public cards of the organization in scope (published + shown), unranked. */
async function cardsOf(tx: TenantTx, now: number) {
  const [settings, courses, centers, classes, tuition] = await Promise.all([
    settingsOf(tx),
    loadCourses(tx),
    tx.selectFrom("center").select(["id", "name"]).orderBy("name").execute(),
    sql<{ center_id: string; code: string }>`
      select k.center_id, co.code from class k join course co on co.id = k.course_id`.execute(tx),
    tx
      .selectFrom("fee_line")
      .select(["course_code", "amount_vnd"])
      .where("status", "=", "approved")
      .where("kind", "=", "tuition")
      .where("to_date", ">=", centerToday(now))
      .execute(),
  ]);
  const centerName = new Map(centers.map((c) => [c.id, c.name]));
  const out: (ShowcaseCard & { version: number; path: { title: string }[] })[] = [];
  for (const c of courses) {
    const s = settings.get(c.ref);
    const v = latest(c);
    if (!s?.isPublic || !v || !s.catalogCode) continue;
    const prices = tuition
      .filter((t) => t.course_code === s.catalogCode)
      .map((t) => Number(t.amount_vnd));
    out.push({
      ref: c.ref,
      title: v.content.title,
      level: v.content.level,
      summary: v.content.summary,
      lessons: v.content.lessons.length,
      offer: s.offer,
      priceFromVnd: s.offer === "free" || !prices.length ? null : Math.min(...prices),
      needs: s.needs,
      centers: [
        ...new Set(
          classes.rows
            .filter((k) => k.code === s.catalogCode)
            .map((k) => centerName.get(k.center_id) ?? ""),
        ),
      ]
        .filter(Boolean)
        .sort(),
      fit: { points: 0, reasons: [] },
      version: v.version,
      path: v.content.lessons.map((l) => ({ title: l.title })),
    });
  }
  return { cards: out, centers: centers.map((c) => c.name), centerByName: centers };
}

/** Fit for what the visitor chose — the only thing that ranks (owner 23/11). */
export function fitOf(
  c: Pick<ShowcaseCard, "level" | "needs" | "centers">,
  q: { level?: string; needs: LearningNeed[]; center?: string },
) {
  let points = 0;
  const reasons: string[] = [];
  if (q.level && c.level === q.level) {
    points += FIT.level;
    reasons.push(`Level ${c.level}, as you chose`);
  }
  const shared = q.needs.filter((n) => c.needs.includes(n));
  if (shared.length) {
    points += FIT.needs;
    reasons.push(`For ${shared.map((n) => NEED_LABEL[n].toLowerCase()).join(", ")}`);
  }
  if (q.center && c.centers.includes(q.center)) {
    points += FIT.center;
    reasons.push(`A class runs at ${q.center}`);
  }
  return { points, reasons };
}

export function registerShowcase(app: Api, db: Db, now: () => number): void {
  // ── staff: the showcase settings of a course ───────────────────────────────────────────────
  const mayAuthor = (c: Caller) =>
    c.ctx.role === "staff" && authorize(c.ctx, "courses:author", { orgId: c.ctx.orgId }).allow;

  app.secured("GET", "/v1/courses/:ref/showcase", async (caller, req, reply) => {
    if (caller.ctx.role !== "staff") return reply.code(403).send({ error: "not_staff" });
    const ref = (req.params as { ref: string }).ref;
    const out = await caller.tenant(async (tx): Promise<ShowcaseSettings | null> => {
      const [c] = await loadCourses(tx, ref);
      if (!c) return null;
      const s = (await settingsOf(tx)).get(ref);
      return {
        ref,
        isPublic: s?.isPublic ?? false,
        offer: s?.offer ?? "trial",
        catalogCode: s?.catalogCode ?? null,
        needs: s?.needs ?? [],
        updatedBy: s?.updatedBy ?? null,
        updatedAt: s?.updatedAt ?? null,
        publishedVersion: latest(c)?.version ?? null,
      };
    });
    return out ?? reply.code(404).send({ error: "not_found" });
  });

  type Result = { ok: true } | { ok: false; reason: string; detail?: string };
  const STATUS: Record<string, number> = {
    not_staff: 403,
    access_policy: 403,
    not_found: 404,
    invalid: 422,
    invalid_step: 409,
  };
  app.secured("POST", "/v1/courses/:ref/showcase", async (caller, req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const params = req.params as { ref: string };
    await caller.write<Result>("POST /v1/courses/:ref/showcase", { params, body }, async (tx) => {
      let r: Result;
      if (caller.ctx.role !== "staff") r = { ok: false, reason: "not_staff" };
      else if (!mayAuthor(caller)) r = { ok: false, reason: "access_policy" };
      else {
        await sql`select pg_advisory_xact_lock(hashtext('courses:' || ${caller.ctx.orgId}))`.execute(
          tx,
        );
        r = await save(tx, caller, params.ref, body);
      }
      return {
        status: r.ok ? 200 : STATUS[r.reason],
        body: r,
        audit: {
          action: "courses:author",
          resource: { ref: params.ref, step: "showcase" },
          outcome: r.ok ? ("allowed" as const) : ("denied" as const),
          ...(r.ok ? { after: body } : { reason: r.reason }),
        },
      };
    });
  });

  async function save(
    tx: TenantTx,
    caller: Caller,
    ref: string,
    d: Record<string, unknown>,
  ): Promise<Result> {
    const known = new Set(["isPublic", "offer", "catalogCode", "needs"]);
    if (Object.keys(d).some((k) => !known.has(k)))
      return { ok: false, reason: "invalid", detail: "unknown field" };
    const [c] = await loadCourses(tx, ref);
    if (!c) return { ok: false, reason: "not_found" };
    if (typeof d.isPublic !== "boolean")
      return { ok: false, reason: "invalid", detail: "public is on or off" };
    if (!SHOWCASE_OFFERS.includes(d.offer as ShowcaseOffer))
      return { ok: false, reason: "invalid", detail: "offer is free, trial or paid" };
    if (
      !Array.isArray(d.needs) ||
      !d.needs.every(isNeed) ||
      new Set(d.needs).size !== d.needs.length
    )
      return { ok: false, reason: "invalid", detail: "unknown or repeated learning need" };
    const code = d.catalogCode === null || d.catalogCode === undefined ? null : d.catalogCode;
    if (code !== null) {
      const known = await tx
        .selectFrom("course")
        .select("code")
        .where("code", "=", typeof code === "string" ? code : "")
        .executeTakeFirst();
      if (!known) return { ok: false, reason: "invalid", detail: "unknown catalog course" };
    }
    if (d.isPublic) {
      if (!latest(c))
        return {
          ok: false,
          reason: "invalid_step",
          detail: "only a course with a published version can be shown",
        };
      if (code === null)
        return {
          ok: false,
          reason: "invalid",
          detail: "choose the catalog course enquiries are for",
        };
    }
    const by =
      (
        await tx
          .selectFrom("staff_member")
          .select("display_name")
          .where("principal_id", "=", caller.ctx.principalId)
          .executeTakeFirst()
      )?.display_name ?? caller.ctx.principalId;
    const v = {
      is_public: d.isPublic,
      offer: d.offer as ShowcaseOffer,
      catalog_code: code as string | null,
      needs: d.needs as string[],
      updated_by: by,
      updated_at: new Date(caller.now()),
    };
    await tx
      .insertInto("course_showcase")
      .values({ org_id: caller.ctx.orgId, course_ref: ref, ...v })
      .onConflict((oc) => oc.columns(["org_id", "course_ref"]).doUpdateSet(v))
      .execute();
    return { ok: true };
  }

  // ── public (no grant) ──────────────────────────────────────────────────────────────────────
  const allow = rateLimiter(now);
  const orgOf = async (slug: string) =>
    /^[a-z0-9-]{1,40}$/.test(slug)
      ? ((await db
          .selectFrom("public_org")
          .select(["slug", "org_id", "name"])
          .where("slug", "=", slug)
          .executeTakeFirst()) ?? null)
      : null;
  const scope = (orgId: string, requestId: string) => ({
    orgId,
    principalId: "public",
    requestId,
  });

  app.get("/v1/public/showcase", { config: { public: true } }, async (req) => {
    const orgs = await db.selectFrom("public_org").select(["slug", "org_id", "name"]).execute();
    const out: ShowcaseOrg[] = [];
    for (const o of orgs) {
      const n = await withTenant(
        db,
        scope(o.org_id, req.id),
        async (tx) => (await cardsOf(tx, now())).cards.length,
      );
      if (n) out.push({ slug: o.slug, name: o.name, courses: n });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  });

  app.get("/v1/public/showcase/:slug", { config: { public: true } }, async (req, reply) => {
    const o = await orgOf((req.params as { slug: string }).slug);
    if (!o) return reply.code(404).send({ error: "not_found" });
    const q = (req.query ?? {}) as Record<string, string>;
    const needs = (q.needs ?? "").split(",").filter(isNeed);
    return withTenant(db, scope(o.org_id, req.id), async (tx): Promise<ShowcasePage> => {
      const { cards, centers } = await cardsOf(tx, now());
      const choice = {
        level: typeof q.level === "string" ? q.level : undefined,
        needs,
        center: typeof q.center === "string" && centers.includes(q.center) ? q.center : undefined,
      };
      const ranked = cards
        .map(({ version: _v, path: _p, ...c }) => ({ ...c, fit: fitOf(c, choice) }))
        .sort((a, b) => b.fit.points - a.fit.points || a.title.localeCompare(b.title));
      return {
        org: { slug: o.slug, name: o.name },
        levels: [...new Set(cards.map((c) => c.level))].sort(),
        centers,
        needs: [...new Set(cards.flatMap((c) => c.needs))].sort(
          (a, b) => LEARNING_NEEDS.indexOf(a) - LEARNING_NEEDS.indexOf(b),
        ),
        courses: ranked,
      };
    });
  });

  app.get(
    "/v1/public/showcase/:slug/courses/:ref",
    { config: { public: true } },
    async (req, reply) => {
      const p = req.params as { slug: string; ref: string };
      const o = await orgOf(p.slug);
      if (!o) return reply.code(404).send({ error: "not_found" });
      const out = await withTenant(
        db,
        scope(o.org_id, req.id),
        async (tx): Promise<ShowcaseDetail | null> => {
          const { cards, centers } = await cardsOf(tx, now());
          const c = cards.find((x) => x.ref === p.ref);
          if (!c) return null;
          return {
            ...c,
            fit: { points: 0, reasons: [] },
            org: { slug: o.slug, name: o.name },
            allCenters: centers,
          };
        },
      );
      return out ?? reply.code(404).send({ error: "not_found" });
    },
  );

  app.post(
    "/v1/public/showcase/:slug/courses/:ref/enquiries",
    { config: { public: true } },
    async (req, reply) => {
      const p = req.params as { slug: string; ref: string };
      const o = await orgOf(p.slug);
      if (!o) return reply.code(404).send({ ok: false, reason: "not_found" });
      if (
        !allow(`enquiry|${req.ip}`, LIMITS.leadsPerAddress) ||
        !allow(`enquiry-org|${o.org_id}`, LIMITS.leadsPerOrg)
      )
        return reply.code(429).send({ ok: false, reason: "too_many_requests" });
      const d = (req.body ?? {}) as Partial<ShowcaseEnquiry> & Record<string, unknown>;
      const r = await withTenant(db, scope(o.org_id, req.id), async (tx): Promise<Result> => {
        await sql`select pg_advisory_xact_lock(hashtext('admissions:' || ${o.org_id}))`.execute(tx);
        const { cards, centerByName } = await cardsOf(tx, now());
        const c = cards.find((x) => x.ref === p.ref);
        const name =
          typeof d.learnerName === "string" ? d.learnerName.trim().replace(/\s+/g, " ") : "";
        const center = centerByName.find((x) => x.name === d.centerName);
        const needs = Array.isArray(d.needs) ? d.needs : [];
        let out: Result;
        if (!c) out = { ok: false, reason: "not_found" };
        else if (name.length < 2 || name.length > 60)
          out = { ok: false, reason: "invalid", detail: "name must be 2–60 characters" };
        else if (/\d{3,}|@|https?:/i.test(name))
          out = {
            ok: false,
            reason: "invalid",
            detail: "a name only — no phone numbers, e-mail addresses or links",
          };
        else if (!center) out = { ok: false, reason: "invalid", detail: "unknown center" };
        else if (!needs.every(isNeed) || needs.length > LEARNING_NEEDS.length)
          out = { ok: false, reason: "invalid", detail: "unknown learning need" };
        else if (d.kind !== "consult" && d.kind !== "trial")
          out = { ok: false, reason: "invalid", detail: "consultation or trial lesson" };
        else if (d.kind === "trial" && c.offer !== "trial")
          out = { ok: false, reason: "invalid", detail: "this course has no trial lesson" };
        else {
          await createWebsiteLead(
            tx,
            o.org_id,
            {
              learnerName: name,
              courseCode: (await tx
                .selectFrom("course_showcase")
                .select("catalog_code")
                .where("course_ref", "=", c.ref)
                .executeTakeFirstOrThrow())!.catalog_code!,
              centerId: center.id,
              needs: [...new Set(needs as LearningNeed[])],
              origin: `Showcase · ${c.ref} v${c.version} · ${OFFER_LABEL[c.offer]} · ${d.kind === "trial" ? "trial lesson" : "consultation"}`,
            },
            new Date(now()),
          );
          out = { ok: true };
        }
        await audit(
          tx,
          { orgId: o.org_id, principalId: "public", requestId: null } as never,
          req.id,
          {
            action: "showcase:enquiry",
            resource: { ref: p.ref },
            outcome: out.ok ? "allowed" : "denied",
            ...(out.ok ? {} : { reason: out.reason }),
          },
        );
        return out;
      });
      return reply.code(r.ok ? 200 : (STATUS[r.reason] ?? 422)).send(r);
    },
  );
}
