/*
 * Brand & provider profile on the Platform API (owner 24/11; contracts/brand.ts). SYNTHETIC:
 *  - staff with brand:manage edit the organization's public profile and claim its badges;
 *  - a teacher opts in to their OWN public profile and claims their own badges — staff cannot
 *    publish a teacher or change a teacher's profile;
 *  - a claimed badge is verified or rejected ONCE by someone with brand:manage who did not claim
 *    it (maker-checker, also a check in the table). A Credly badge must check "valid" at the
 *    CredentialVerifier (fake in staging); a certificate must be confirmed as seen. The claimant
 *    (or staff with brand:manage) may withdraw it;
 *  - the public sees the profile, the centers, opted-in teachers who teach a shown course or have
 *    a profile, and only verified, unexpired badges — never who verified them, never contact
 *    details.
 */
import {
  authorize,
  CREDENTIAL_SOURCE_LABEL,
  CREDENTIAL_SOURCES,
  DEFAULT_BRAND_COLORS,
} from "@ogc/contracts";
import type {
  BrandAdmin,
  BrandProfile,
  BrandResult,
  Credential,
  CredentialSource,
  CredentialVerifier,
  MyPublicProfile,
  PublicBadge,
  PublicBrand,
  PublicInstructor,
} from "@ogc/contracts";
import { sql } from "kysely";
import type { Db, TenantTx } from "../db.js";
import { withTenant } from "../db.js";
import type { Api, Caller } from "../server.js";

export const centerToday = (now: number) =>
  new Date(now + 7 * 3_600_000).toISOString().slice(0, 10);
const HEX = /^#[0-9a-fA-F]{6}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CODE = /^[A-Z0-9][A-Z0-9-]{3,39}$/;
/** Contact goes through the enquiry form only: no phone numbers, e-mail addresses or links. */
export const hasContact = (s: string) =>
  /\d{3,}|@|https?:|www\./i.test(s.replace(/\b(19|20)\d{2}\b/g, ""));
const clean = (x: unknown) => (typeof x === "string" ? x.trim().replace(/\s+/g, " ") : "");
const isDate = (s: unknown): s is string =>
  typeof s === "string" &&
  DATE.test(s) &&
  !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
  new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

const STATUS: Record<string, number> = {
  not_staff: 403,
  not_teacher: 403,
  access_policy: 403,
  maker_checker: 403,
  not_found: 404,
  invalid: 422,
  duplicate: 409,
  invalid_step: 409,
  credential_check: 409,
};

interface CredRow {
  id: string;
  teacher_id: string | null;
  teacher_name: string | null;
  title: string;
  issuer: string;
  source: CredentialSource;
  badge_code: string;
  issued_on: string;
  expires_on: string | null;
  claimed_by: string;
  claimed_by_name: string;
  claimed_at: Date;
  status: Credential["status"];
  decided_by_name: string | null;
  decided_at: Date | null;
  note: string | null;
  withdrawn_by_name: string | null;
  withdrawn_at: Date | null;
  withdraw_reason: string | null;
}

async function credRows(tx: TenantTx, where = sql`true`): Promise<CredRow[]> {
  return (
    await sql<CredRow>`
      select c.id, c.teacher_id, t.name as teacher_name, c.title, c.issuer, c.source, c.badge_code,
             to_char(c.issued_on, 'YYYY-MM-DD') as issued_on,
             to_char(c.expires_on, 'YYYY-MM-DD') as expires_on,
             c.claimed_by, c.claimed_by_name, c.claimed_at, c.status, c.decided_by_name,
             c.decided_at, c.note, c.withdrawn_by_name, c.withdrawn_at, c.withdraw_reason
        from credential c left join teacher t on t.id = c.teacher_id and t.org_id = c.org_id
       where ${where}
       order by c.claimed_at desc, c.id desc`.execute(tx)
  ).rows;
}

const expiredOn = (r: { expires_on: string | null }, today: string) =>
  r.expires_on !== null && r.expires_on < today;

function toCredential(r: CredRow, orgName: string, today: string, me: string): Credential {
  const withdrawn = r.status === "withdrawn";
  return {
    id: r.id,
    holder: r.teacher_id ? "teacher" : "org",
    holderName: r.teacher_name ?? orgName,
    title: r.title,
    issuer: r.issuer,
    source: r.source,
    badgeCode: r.badge_code,
    issuedOn: r.issued_on,
    expiresOn: r.expires_on,
    status: r.status,
    expired: expiredOn(r, today),
    claimedBy: r.claimed_by_name,
    claimedAt: new Date(r.claimed_at).toISOString(),
    decidedBy: withdrawn ? r.withdrawn_by_name : r.decided_by_name,
    decidedAt: withdrawn
      ? new Date(r.withdrawn_at!).toISOString()
      : r.decided_at
        ? new Date(r.decided_at).toISOString()
        : null,
    note: withdrawn ? r.withdraw_reason : r.note,
    mine: r.claimed_by === me,
  };
}

const publicBadge = (r: CredRow): PublicBadge => ({
  title: r.title,
  issuer: r.issuer,
  source: r.source,
  badgeCode: r.badge_code,
  issuedOn: r.issued_on,
  expiresOn: r.expires_on,
});

/** Verified, unexpired badges — the only ones the public sees. */
async function shownBadges(tx: TenantTx, today: string) {
  return (await credRows(tx, sql`c.status = 'verified'`)).filter((r) => !expiredOn(r, today));
}

async function profileOf(tx: TenantTx): Promise<BrandProfile> {
  const p = await tx.selectFrom("brand_profile").selectAll().executeTakeFirst();
  return p
    ? {
        tagline: p.tagline,
        about: p.about,
        primaryColor: p.primary_color,
        accentColor: p.accent_color,
        updatedBy: p.updated_by,
        updatedAt: new Date(p.updated_at).toISOString(),
      }
    : { tagline: "", about: "", ...DEFAULT_BRAND_COLORS, updatedBy: null, updatedAt: null };
}

/** Opted-in teachers (optionally only those teaching a class of `catalogCode`), with badges. */
export async function publicInstructors(
  tx: TenantTx,
  today: string,
  catalogCode?: string,
): Promise<PublicInstructor[]> {
  const people = (
    await sql<{ teacher_id: string; display_name: string; bio: string }>`
      select p.teacher_id, p.display_name, p.bio from teacher_profile p
       where p.is_public
         and (${catalogCode ?? null}::text is null or exists (
               select 1 from class k join course co on co.id = k.course_id
                where k.teacher_id = p.teacher_id and co.code = ${catalogCode ?? null}::text))
       order by p.display_name`.execute(tx)
  ).rows;
  const badges = await shownBadges(tx, today);
  return people.map((p) => ({
    displayName: p.display_name,
    bio: p.bio,
    badges: badges.filter((b) => b.teacher_id === p.teacher_id).map(publicBadge),
  }));
}

/** The provider block of a public course page. */
export async function publicBrandBlock(tx: TenantTx, today: string) {
  const p = await profileOf(tx);
  return {
    tagline: p.tagline,
    primaryColor: p.primaryColor,
    accentColor: p.accentColor,
    badges: (await shownBadges(tx, today)).filter((b) => !b.teacher_id).map(publicBadge),
  };
}

export function registerBrand(
  app: Api,
  db: Db,
  now: () => number,
  verifiers: CredentialVerifier[],
  courseCount: (tx: TenantTx) => Promise<number>,
): void {
  const mayManage = (c: Caller) =>
    c.ctx.role === "staff" && authorize(c.ctx, "brand:manage", { orgId: c.ctx.orgId }).allow;
  const lock = (tx: TenantTx, org: string) =>
    sql`select pg_advisory_xact_lock(hashtext('brand:' || ${org}))`.execute(tx);
  const orgRow = (tx: TenantTx, orgId: string) =>
    tx
      .selectFrom("public_org")
      .select(["slug", "name"])
      .where("org_id", "=", orgId)
      .executeTakeFirst();
  const staffName = async (tx: TenantTx, c: Caller) =>
    (
      await tx
        .selectFrom("staff_member")
        .select("display_name")
        .where("principal_id", "=", c.ctx.principalId)
        .executeTakeFirst()
    )?.display_name ?? c.ctx.principalId;
  const myTeacher = (tx: TenantTx, c: Caller) =>
    tx
      .selectFrom("teacher")
      .select(["id", "name"])
      .where("principal_id", "=", c.ctx.principalId)
      .executeTakeFirst();

  // ── staff: the brand page ──────────────────────────────────────────────────────────────────
  app.secured("GET", "/v1/brand", async (caller, _req, reply) => {
    if (caller.ctx.role !== "staff") return reply.code(403).send({ error: "not_staff" });
    return caller.tenant(async (tx): Promise<BrandAdmin> => {
      const o = await orgRow(tx, caller.ctx.orgId);
      const name = o?.name ?? "This organization";
      const today = centerToday(caller.now());
      const teachers = await sql<{
        name: string;
        is_public: boolean | null;
        display_name: string | null;
      }>`
        select t.name, p.is_public, p.display_name from teacher t
          left join teacher_profile p on p.org_id = t.org_id and p.teacher_id = t.id
         order by t.name`.execute(tx);
      return {
        org: { slug: o?.slug ?? null, name },
        profile: await profileOf(tx),
        credentials: (await credRows(tx)).map((r) =>
          toCredential(r, name, today, caller.ctx.principalId),
        ),
        teachers: teachers.rows.map((t) => ({
          name: t.name,
          isPublic: t.is_public === true,
          displayName: t.is_public ? t.display_name : null,
        })),
        canManage: mayManage(caller),
      };
    });
  });

  /** A staff write gated by brand:manage, under the brand lock, audited. */
  const staffWrite = (
    route: string,
    step: string,
    work: (
      tx: TenantTx,
      caller: Caller,
      body: Record<string, unknown>,
      p: Record<string, string>,
    ) => Promise<BrandResult>,
  ) =>
    app.secured("POST", route, async (caller, req) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const params = (req.params ?? {}) as Record<string, string>;
      await caller.write<BrandResult>(`POST ${route}`, { params, body }, async (tx) => {
        let r: BrandResult;
        if (caller.ctx.role !== "staff") r = { ok: false, reason: "not_staff" };
        else if (!mayManage(caller)) r = { ok: false, reason: "access_policy" };
        else {
          await lock(tx, caller.ctx.orgId);
          r = await work(tx, caller, body, params);
        }
        return {
          status: r.ok ? 200 : STATUS[r.reason],
          body: r,
          audit: {
            action: "brand:manage",
            resource: { step, ...(params.id ? { id: params.id } : {}) },
            outcome: r.ok ? ("allowed" as const) : ("denied" as const),
            ...(r.ok ? { after: body } : { reason: r.reason }),
          },
        };
      });
    });

  staffWrite("/v1/brand/profile", "profile", async (tx, caller, d) => {
    const known = new Set(["tagline", "about", "primaryColor", "accentColor"]);
    if (Object.keys(d).some((k) => !known.has(k)))
      return { ok: false, reason: "invalid", detail: "unknown field" };
    const tagline = clean(d.tagline);
    const about = typeof d.about === "string" ? d.about.trim() : "";
    if (typeof d.tagline !== "string" || tagline.length > 120)
      return { ok: false, reason: "invalid", detail: "tagline: up to 120 characters" };
    if (typeof d.about !== "string" || about.length > 1200)
      return { ok: false, reason: "invalid", detail: "about: up to 1200 characters" };
    if (hasContact(tagline) || hasContact(about))
      return {
        ok: false,
        reason: "invalid",
        detail: "no phone numbers, e-mail addresses or links — visitors enquire through the form",
      };
    if (typeof d.primaryColor !== "string" || !HEX.test(d.primaryColor))
      return { ok: false, reason: "invalid", detail: "colors are #rrggbb" };
    if (typeof d.accentColor !== "string" || !HEX.test(d.accentColor))
      return { ok: false, reason: "invalid", detail: "colors are #rrggbb" };
    const v = {
      tagline,
      about,
      primary_color: d.primaryColor.toLowerCase(),
      accent_color: d.accentColor.toLowerCase(),
      updated_by: await staffName(tx, caller),
      updated_at: new Date(caller.now()),
    };
    await tx
      .insertInto("brand_profile")
      .values({ org_id: caller.ctx.orgId, ...v })
      .onConflict((oc) => oc.column("org_id").doUpdateSet(v))
      .execute();
    return { ok: true };
  });

  /** Checks shared by staff (organization badges) and teachers (their own). */
  async function claim(
    tx: TenantTx,
    caller: Caller,
    d: Record<string, unknown>,
    teacherId: string | null,
    by: string,
  ): Promise<BrandResult> {
    const known = new Set(["title", "issuer", "source", "badgeCode", "issuedOn", "expiresOn"]);
    if (Object.keys(d).some((k) => !known.has(k)))
      return { ok: false, reason: "invalid", detail: "unknown field" };
    const title = clean(d.title);
    const issuer = clean(d.issuer);
    const code = clean(d.badgeCode).toUpperCase();
    const today = centerToday(caller.now());
    if (title.length < 3 || title.length > 100)
      return { ok: false, reason: "invalid", detail: "title: 3–100 characters" };
    if (issuer.length < 2 || issuer.length > 80)
      return { ok: false, reason: "invalid", detail: "issuer: 2–80 characters" };
    if (hasContact(title) || hasContact(issuer))
      return {
        ok: false,
        reason: "invalid",
        detail: "no phone numbers, e-mail addresses or links",
      };
    if (!CREDENTIAL_SOURCES.includes(d.source as CredentialSource))
      return { ok: false, reason: "invalid", detail: "source is Credly (mock) or a certificate" };
    if (!CODE.test(code))
      return {
        ok: false,
        reason: "invalid",
        detail: "badge code: 4–40 letters, digits or dashes",
      };
    if (!isDate(d.issuedOn) || d.issuedOn > today)
      return { ok: false, reason: "invalid", detail: "issue date: a past date (YYYY-MM-DD)" };
    const expires =
      d.expiresOn === null || d.expiresOn === undefined || d.expiresOn === "" ? null : d.expiresOn;
    if (expires !== null && (!isDate(expires) || expires <= d.issuedOn))
      return { ok: false, reason: "invalid", detail: "expiry date: after the issue date, or none" };
    if (expires !== null && expires < today)
      return { ok: false, reason: "invalid", detail: "this badge has already expired" };
    const dup = await tx
      .selectFrom("credential")
      .select("id")
      .where("source", "=", d.source as CredentialSource)
      .where("badge_code", "=", code)
      .executeTakeFirst();
    if (dup) return { ok: false, reason: "duplicate", detail: `this badge is already ${dup.id}` };
    const n = await sql<{ n: number }>`
      select coalesce(max(substring(id from 4)::int), 0) + 1 as n from credential`.execute(tx);
    const id = `CR-${n.rows[0]!.n}`;
    await tx
      .insertInto("credential")
      .values({
        org_id: caller.ctx.orgId,
        id,
        teacher_id: teacherId,
        title,
        issuer,
        source: d.source as CredentialSource,
        badge_code: code,
        issued_on: d.issuedOn,
        expires_on: expires as string | null,
        claimed_by: caller.ctx.principalId,
        claimed_by_name: by,
        claimed_at: new Date(caller.now()),
      })
      .execute();
    return { ok: true, id };
  }

  staffWrite("/v1/brand/credentials", "claim", async (tx, caller, d) =>
    claim(tx, caller, d, null, await staffName(tx, caller)),
  );

  staffWrite("/v1/brand/credentials/:id/verify", "verify", async (tx, caller, d, p) => {
    const [r] = await credRows(tx, sql`c.id = ${p.id}`);
    if (!r) return { ok: false, reason: "not_found" };
    if (r.status !== "claimed")
      return { ok: false, reason: "invalid_step", detail: `already ${r.status}` };
    if (r.claimed_by === caller.ctx.principalId)
      return {
        ok: false,
        reason: "maker_checker",
        detail: "someone other than the claimant verifies a badge",
      };
    const today = centerToday(caller.now());
    if (expiredOn(r, today))
      return { ok: false, reason: "invalid_step", detail: "the badge has expired" };
    let note: string;
    const by = await staffName(tx, caller);
    if (r.source === "certificate") {
      if (d.seen !== true)
        return {
          ok: false,
          reason: "invalid",
          detail: "confirm you have seen the certificate",
        };
      note = `Certificate seen by ${by} on ${today}`;
    } else {
      const v = verifiers.find((x) => x.source === r.source);
      if (!v) return { ok: false, reason: "credential_check", detail: "no register to check" };
      const check = await v.check(r.badge_code);
      if (check !== "valid")
        return {
          ok: false,
          reason: "credential_check",
          detail: `${CREDENTIAL_SOURCE_LABEL[r.source]} says: ${check}`,
        };
      note = `${CREDENTIAL_SOURCE_LABEL[r.source]}: valid on ${today}`;
    }
    await tx
      .updateTable("credential")
      .set({
        status: "verified",
        decided_by: caller.ctx.principalId,
        decided_by_name: by,
        decided_at: new Date(caller.now()),
        note,
      })
      .where("id", "=", r.id)
      .execute();
    return { ok: true };
  });

  staffWrite("/v1/brand/credentials/:id/reject", "reject", async (tx, caller, d, p) => {
    const [r] = await credRows(tx, sql`c.id = ${p.id}`);
    const reason = clean(d.reason);
    if (!r) return { ok: false, reason: "not_found" };
    if (r.status !== "claimed")
      return { ok: false, reason: "invalid_step", detail: `already ${r.status}` };
    if (r.claimed_by === caller.ctx.principalId)
      return {
        ok: false,
        reason: "maker_checker",
        detail: "someone other than the claimant decides a badge",
      };
    if (reason.length < 3 || reason.length > 200)
      return { ok: false, reason: "invalid", detail: "a reason: 3–200 characters" };
    await tx
      .updateTable("credential")
      .set({
        status: "rejected",
        decided_by: caller.ctx.principalId,
        decided_by_name: await staffName(tx, caller),
        decided_at: new Date(caller.now()),
        note: reason,
      })
      .where("id", "=", r.id)
      .execute();
    return { ok: true };
  });

  async function withdraw(
    tx: TenantTx,
    caller: Caller,
    id: string,
    d: Record<string, unknown>,
    by: string,
    teacherId: string | null,
  ): Promise<BrandResult> {
    const [r] = await credRows(tx, sql`c.id = ${id}`);
    const reason = clean(d.reason);
    // a teacher sees only their own badges
    if (!r || (teacherId !== null && r.teacher_id !== teacherId))
      return { ok: false, reason: "not_found" };
    if (r.status !== "claimed" && r.status !== "verified")
      return { ok: false, reason: "invalid_step", detail: `already ${r.status}` };
    if (reason.length < 3 || reason.length > 200)
      return { ok: false, reason: "invalid", detail: "a reason: 3–200 characters" };
    await tx
      .updateTable("credential")
      .set({
        status: "withdrawn",
        withdrawn_by_name: by,
        withdrawn_at: new Date(caller.now()),
        withdraw_reason: reason,
      })
      .where("id", "=", r.id)
      .execute();
    return { ok: true };
  }

  staffWrite("/v1/brand/credentials/:id/withdraw", "withdraw", async (tx, caller, d, p) =>
    withdraw(tx, caller, p.id!, d, await staffName(tx, caller), null),
  );

  // ── teacher: my public profile ─────────────────────────────────────────────────────────────
  app.secured("GET", "/v1/me/public-profile", async (caller, _req, reply) => {
    if (caller.ctx.role !== "teacher") return reply.code(403).send({ error: "not_teacher" });
    const out = await caller.tenant(async (tx): Promise<MyPublicProfile | null> => {
      const t = await myTeacher(tx, caller);
      if (!t) return null;
      const p = await tx
        .selectFrom("teacher_profile")
        .selectAll()
        .where("teacher_id", "=", t.id)
        .executeTakeFirst();
      const today = centerToday(caller.now());
      return {
        name: t.name,
        isPublic: p?.is_public ?? false,
        displayName: p?.display_name ?? t.name,
        bio: p?.bio ?? "",
        credentials: (await credRows(tx, sql`c.teacher_id = ${t.id}`)).map((r) =>
          toCredential(r, "", today, caller.ctx.principalId),
        ),
      };
    });
    return out ?? reply.code(404).send({ error: "not_found" });
  });

  const teacherWrite = (
    route: string,
    step: string,
    work: (
      tx: TenantTx,
      caller: Caller,
      t: { id: string; name: string },
      body: Record<string, unknown>,
      p: Record<string, string>,
    ) => Promise<BrandResult>,
  ) =>
    app.secured("POST", route, async (caller, req) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const params = (req.params ?? {}) as Record<string, string>;
      await caller.write<BrandResult>(`POST ${route}`, { params, body }, async (tx) => {
        let r: BrandResult;
        const t = caller.ctx.role === "teacher" ? await myTeacher(tx, caller) : undefined;
        if (!t) r = { ok: false, reason: "not_teacher" };
        else {
          await lock(tx, caller.ctx.orgId);
          r = await work(tx, caller, t, body, params);
        }
        return {
          status: r.ok ? 200 : STATUS[r.reason],
          body: r,
          audit: {
            action: "brand:profile",
            resource: { step, ...(params.id ? { id: params.id } : {}) },
            outcome: r.ok ? ("allowed" as const) : ("denied" as const),
            ...(r.ok ? { after: body } : { reason: r.reason }),
          },
        };
      });
    });

  teacherWrite("/v1/me/public-profile", "profile", async (tx, caller, t, d) => {
    const known = new Set(["isPublic", "displayName", "bio"]);
    if (Object.keys(d).some((k) => !known.has(k)))
      return { ok: false, reason: "invalid", detail: "unknown field" };
    if (typeof d.isPublic !== "boolean")
      return { ok: false, reason: "invalid", detail: "public is on or off" };
    const name = clean(d.displayName);
    const bio = clean(d.bio);
    if (name.length < 2 || name.length > 40)
      return { ok: false, reason: "invalid", detail: "display name: 2–40 characters" };
    if (typeof d.bio !== "string" || bio.length > 400)
      return { ok: false, reason: "invalid", detail: "bio: up to 400 characters" };
    if (hasContact(name) || hasContact(bio))
      return {
        ok: false,
        reason: "invalid",
        detail: "no phone numbers, e-mail addresses or links on a public profile",
      };
    const v = {
      is_public: d.isPublic,
      display_name: name,
      bio,
      updated_at: new Date(caller.now()),
    };
    await tx
      .insertInto("teacher_profile")
      .values({ org_id: caller.ctx.orgId, teacher_id: t.id, ...v })
      .onConflict((oc) => oc.columns(["org_id", "teacher_id"]).doUpdateSet(v))
      .execute();
    return { ok: true };
  });

  teacherWrite("/v1/me/public-profile/credentials", "claim", async (tx, caller, t, d) =>
    claim(tx, caller, d, t.id, t.name),
  );
  teacherWrite(
    "/v1/me/public-profile/credentials/:id/withdraw",
    "withdraw",
    async (tx, caller, t, d, p) => withdraw(tx, caller, p.id!, d, t.name, t.id),
  );

  // ── public (no grant) ──────────────────────────────────────────────────────────────────────
  app.get("/v1/public/showcase/:slug/profile", { config: { public: true } }, async (req, reply) => {
    const slug = (req.params as { slug: string }).slug;
    const o = /^[a-z0-9-]{1,40}$/.test(slug)
      ? await db
          .selectFrom("public_org")
          .select(["slug", "org_id", "name"])
          .where("slug", "=", slug)
          .executeTakeFirst()
      : undefined;
    if (!o) return reply.code(404).send({ error: "not_found" });
    return withTenant(
      db,
      { orgId: o.org_id, principalId: "public", requestId: req.id },
      async (tx): Promise<PublicBrand> => {
        const today = centerToday(now());
        const p = await profileOf(tx);
        return {
          org: { slug: o.slug, name: o.name },
          tagline: p.tagline,
          about: p.about,
          primaryColor: p.primaryColor,
          accentColor: p.accentColor,
          centers: (await tx.selectFrom("center").select("name").orderBy("name").execute()).map(
            (c) => c.name,
          ),
          badges: (await shownBadges(tx, today)).filter((b) => !b.teacher_id).map(publicBadge),
          instructors: await publicInstructors(tx, today),
          courses: await courseCount(tx),
        };
      },
    );
  });
}
