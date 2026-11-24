/*
 * Brand & provider profile on the Platform (owner 24/11). Public (no sign-in): the organization's
 * profile page and, on a course page, the provider block and its opted-in teachers — verified,
 * unexpired badges only. Staff (brand:manage): edit the profile, claim organization badges,
 * verify / reject / withdraw badges someone ELSE claimed. Teacher: their own public profile
 * (opt in / out) and their own badges. Synthetic data; the Credly check is a fake register.
 */
import { useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CREDENTIAL_SOURCE_LABEL,
  CREDENTIAL_SOURCES,
  type BrandAdmin,
  type BrandProfileInput,
  type BrandResult,
  type Credential,
  type CredentialClaim,
  type CredentialSource,
  type MyPublicProfile,
  type PublicBadge,
  type PublicInstructor,
} from "@ogc/contracts";
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../ui";
import { platformApi } from "./client";
import { useSignedIn } from "./App";

const field = "mt-1 block w-full rounded-ogc border border-border bg-surface p-2";
const STATUS_LABEL: Record<Credential["status"], string> = {
  claimed: "Waiting for verification",
  verified: "Verified",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};
/** Brand colors only frame the page (a top rule and a marker) — text keeps the theme's contrast. */
const frame = (primary: string): CSSProperties => ({ borderTop: `4px solid ${primary}` });

function Failure({ r }: { r: BrandResult | undefined }) {
  return r && !r.ok ? (
    <span role="alert" className="text-danger">
      {r.detail ?? r.reason}
    </span>
  ) : null;
}

// ── public ────────────────────────────────────────────────────────────────────────────────
export function BadgeList({ badges, label }: { badges: PublicBadge[]; label: string }) {
  if (!badges.length) return <p className="text-sm text-muted">No verified badges yet.</p>;
  return (
    <ul aria-label={label} className="space-y-2">
      {badges.map((b) => (
        <li
          key={`${b.source}-${b.badgeCode}`}
          data-testid={`badge-${b.badgeCode}`}
          className="text-sm"
        >
          <span className="font-medium">✓ {b.title}</span> · {b.issuer}
          <span className="block text-xs text-muted">
            Verified · {CREDENTIAL_SOURCE_LABEL[b.source]} · {b.badgeCode} · issued {b.issuedOn}
            {b.expiresOn ? ` · valid until ${b.expiresOn}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function Instructors({ people }: { people: PublicInstructor[] }) {
  return (
    <section aria-label="Teachers" className="space-y-3">
      <h2 className="font-medium">Teachers</h2>
      {people.length ? (
        people.map((p) => (
          <div
            key={p.displayName}
            data-testid={`instructor-${p.displayName}`}
            className="space-y-1"
          >
            <p className="font-medium">{p.displayName}</p>
            {p.bio ? <p className="text-sm">{p.bio}</p> : null}
            <BadgeList badges={p.badges} label={`Badges of ${p.displayName}`} />
          </div>
        ))
      ) : (
        <p className="text-sm text-muted">Teachers choose whether to show a public profile.</p>
      )}
    </section>
  );
}

/** The provider block on a public course page. */
export function ProviderBlock(props: {
  slug: string;
  name: string;
  brand: { tagline: string; primaryColor: string; badges: PublicBadge[] };
  instructors: PublicInstructor[];
}) {
  return (
    <Card className="space-y-4">
      <section
        aria-label="Provider"
        style={frame(props.brand.primaryColor)}
        className="space-y-2 pt-3"
      >
        <h2 className="font-medium">About the provider</h2>
        <p className="text-sm">
          <span className="font-medium">{props.name}</span>
          {props.brand.tagline ? ` — ${props.brand.tagline}` : ""}
        </p>
        <BadgeList badges={props.brand.badges} label="Provider badges" />
        <Link to={`/showcase/${props.slug}/about`} className="text-sm text-brand underline">
          About {props.name}
        </Link>
      </section>
      <Instructors people={props.instructors} />
    </Card>
  );
}

export function ShowcaseBrandPage() {
  const { org = "" } = useParams();
  const q = useQuery({
    queryKey: ["brand-public", org],
    queryFn: () => platformApi.publicBrand(org),
  });
  if (q.isLoading) return <Spinner label="Loading the profile" />;
  if (q.isError)
    return <ErrorState message="Could not load the profile." onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="Not found" hint="This organization has no public page." />;
  const b = q.data;
  return (
    <section className="space-y-4">
      <div style={frame(b.primaryColor)} className="pt-3">
        <PageHeader title={b.org.name} subtitle={b.tagline || "Staging, synthetic data"} />
      </div>
      {b.about ? (
        <Card>
          <p className="whitespace-pre-line">{b.about}</p>
        </Card>
      ) : null}
      <Card className="space-y-2">
        <h2 className="font-medium">Centers</h2>
        <ul aria-label="Centers" className="text-sm">
          {b.centers.map((c) => (
            <li key={c}>
              <span aria-hidden style={{ color: b.accentColor }}>
                ●
              </span>{" "}
              {c}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="space-y-2">
        <h2 className="font-medium">Verified badges</h2>
        <p className="text-xs text-muted">
          Checked by someone at the organization other than the person who added it — against the
          issuer's register (Credly — a mock in staging) or by seeing the certificate.
        </p>
        <BadgeList badges={b.badges} label="Organization badges" />
      </Card>
      <Card>
        <Instructors people={b.instructors} />
      </Card>
      <Link to={`/showcase/${b.org.slug}`} className="text-sm text-brand">
        {b.courses
          ? `See the ${b.courses} courses at ${b.org.name} →`
          : `Courses at ${b.org.name} →`}
      </Link>
    </section>
  );
}

// ── shared: claim a badge ──────────────────────────────────────────────────────────────────
function ClaimForm(props: { onClaim: (c: CredentialClaim) => Promise<BrandResult>; who: string }) {
  const qc = useQueryClient();
  const empty: CredentialClaim = {
    title: "",
    issuer: "",
    source: "credly_mock",
    badgeCode: "",
    issuedOn: "",
    expiresOn: null,
  };
  const [d, setD] = useState(empty);
  const claim = useMutation({
    mutationFn: () => props.onClaim(d),
    onSuccess: (r) => {
      if (r.ok) {
        setD(empty);
        void qc.invalidateQueries({ queryKey: ["brand"] });
      }
    },
  });
  return (
    <section aria-label="Add a badge" className="space-y-2 text-sm">
      <h2 className="text-base font-medium">Add a badge {props.who}</h2>
      <p className="text-muted">
        Someone else with brand access verifies it before it is shown. Staging: synthetic badges
        only — the Credly check is a mock register (codes MOCK-…).
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          Title
          <input
            className={field}
            value={d.title}
            onChange={(e) => setD({ ...d, title: e.target.value })}
          />
        </label>
        <label className="block">
          Issuer
          <input
            className={field}
            value={d.issuer}
            onChange={(e) => setD({ ...d, issuer: e.target.value })}
          />
        </label>
        <label className="block">
          Source
          <select
            className={field}
            value={d.source}
            onChange={(e) => setD({ ...d, source: e.target.value as CredentialSource })}
          >
            {CREDENTIAL_SOURCES.map((s) => (
              <option key={s} value={s}>
                {CREDENTIAL_SOURCE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          Badge code
          <input
            className={field}
            value={d.badgeCode}
            onChange={(e) => setD({ ...d, badgeCode: e.target.value })}
          />
        </label>
        <label className="block">
          Issued on
          <input
            type="date"
            className={field}
            value={d.issuedOn}
            onChange={(e) => setD({ ...d, issuedOn: e.target.value })}
          />
        </label>
        <label className="block">
          Valid until (optional)
          <input
            type="date"
            className={field}
            value={d.expiresOn ?? ""}
            onChange={(e) => setD({ ...d, expiresOn: e.target.value || null })}
          />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={() => claim.mutate()} disabled={claim.isPending}>
          Add badge
        </Button>
        <Failure r={claim.data} />
        {claim.data?.ok ? (
          <span role="status">Added {claim.data.id} — waiting for verification.</span>
        ) : null}
      </div>
    </section>
  );
}

function CredentialLine({ c }: { c: Credential }) {
  return (
    <>
      <span className="font-medium">
        {c.id} · {c.title}
      </span>{" "}
      · {c.issuer}{" "}
      <Badge>{c.expired && c.status === "verified" ? "Expired" : STATUS_LABEL[c.status]}</Badge>
      <span className="block text-xs text-muted">
        {CREDENTIAL_SOURCE_LABEL[c.source]} · {c.badgeCode} · issued {c.issuedOn}
        {c.expiresOn ? ` · valid until ${c.expiresOn}` : ""} · added by {c.claimedBy}
        {c.decidedBy ? ` · ${c.status} by ${c.decidedBy}` : ""}
        {c.note ? ` · ${c.note}` : ""}
      </span>
    </>
  );
}

// ── staff: the brand page ──────────────────────────────────────────────────────────────────
export function BrandPage() {
  const s = useSignedIn();
  const q = useQuery({
    queryKey: ["brand", "admin", s.principalId],
    queryFn: () => platformApi.brandAdmin(s),
  });
  if (q.isLoading) return <Spinner label="Loading the brand profile" />;
  if (q.isError)
    return <ErrorState message="Could not load the brand profile." onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="Staff only" />;
  const a = q.data;
  return (
    <section className="space-y-4">
      <PageHeader
        title="Brand profile"
        subtitle={`${a.org.name} · public page, badges and teachers`}
      />
      {a.org.slug ? (
        <Link to={`/showcase/${a.org.slug}/about`} className="text-sm text-brand underline">
          Open the public profile
        </Link>
      ) : null}
      {!a.canManage ? (
        <p role="note" className="text-sm text-muted">
          Read-only: your access policy does not include brand:manage.
        </p>
      ) : null}
      <ProfileForm a={a} />
      <Card className="space-y-3">
        <h2 className="text-base font-medium">Badges</h2>
        <ul aria-label="Badges" className="space-y-3">
          {a.credentials.map((c) => (
            <li key={c.id} data-testid={`cred-${c.id}`} className="text-sm">
              <span className="text-xs text-muted">
                {c.holder === "org" ? "Organization" : `Teacher · ${c.holderName}`}
              </span>
              <br />
              <CredentialLine c={c} />
              {a.canManage ? <Decide c={c} /> : null}
            </li>
          ))}
        </ul>
      </Card>
      {a.canManage ? (
        <Card>
          <ClaimForm
            who="for the organization"
            onClaim={(c) => platformApi.claimOrgCredential(s, c)}
          />
        </Card>
      ) : null}
      <Card className="space-y-2">
        <h2 className="text-base font-medium">Teachers on the public page</h2>
        <p className="text-sm text-muted">
          Each teacher decides for themselves (Public profile); staff cannot publish a teacher.
        </p>
        <ul aria-label="Teachers' choice" className="text-sm">
          {a.teachers.map((t) => (
            <li key={t.name}>
              {t.name}: {t.isPublic ? `public as “${t.displayName}”` : "not public"}
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function ProfileForm({ a }: { a: BrandAdmin }) {
  const s = useSignedIn();
  const qc = useQueryClient();
  const [d, setD] = useState<BrandProfileInput>({
    tagline: a.profile.tagline,
    about: a.profile.about,
    primaryColor: a.profile.primaryColor,
    accentColor: a.profile.accentColor,
  });
  const save = useMutation({
    mutationFn: () => platformApi.saveBrandProfile(s, d),
    onSuccess: (r) => (r.ok ? qc.invalidateQueries({ queryKey: ["brand"] }) : undefined),
  });
  const color = (k: "primaryColor" | "accentColor", label: string) => (
    <label className="block">
      {label}
      <span className="mt-1 flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} picker`}
          value={/^#[0-9a-f]{6}$/i.test(d[k]) ? d[k] : "#000000"}
          onChange={(e) => setD({ ...d, [k]: e.target.value })}
          disabled={!a.canManage}
        />
        <input
          className={field}
          value={d[k]}
          onChange={(e) => setD({ ...d, [k]: e.target.value })}
          disabled={!a.canManage}
        />
      </span>
    </label>
  );
  return (
    <Card>
      <section aria-label="Public profile" className="space-y-3 text-sm">
        <h2 className="text-base font-medium">Public profile</h2>
        <p className="text-muted">
          No phone numbers, e-mail addresses or links: visitors enquire through the course form and
          leads go to Admissions.
          {a.profile.updatedBy ? ` Last saved by ${a.profile.updatedBy}.` : ""}
        </p>
        <label className="block">
          Tagline
          <input
            className={field}
            value={d.tagline}
            onChange={(e) => setD({ ...d, tagline: e.target.value })}
            disabled={!a.canManage}
          />
        </label>
        <label className="block">
          About
          <textarea
            className={field}
            rows={4}
            value={d.about}
            onChange={(e) => setD({ ...d, about: e.target.value })}
            disabled={!a.canManage}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {color("primaryColor", "Primary color")}
          {color("accentColor", "Accent color")}
        </div>
        {a.canManage ? (
          <div className="flex items-center gap-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              Save profile
            </Button>
            <Failure r={save.data} />
            {save.data?.ok ? <span role="status">Saved.</span> : null}
          </div>
        ) : null}
      </section>
    </Card>
  );
}

function Decide({ c }: { c: Credential }) {
  const s = useSignedIn();
  const qc = useQueryClient();
  const [seen, setSeen] = useState(false);
  const [why, setWhy] = useState("");
  const act = useMutation({
    mutationFn: (verb: "verify" | "reject" | "withdraw") =>
      platformApi.decideCredential(s, c.id, verb, verb === "verify" ? { seen } : { reason: why }),
    onSuccess: (r) => (r.ok ? qc.invalidateQueries({ queryKey: ["brand"] }) : undefined),
  });
  if (c.status !== "claimed" && c.status !== "verified") return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      {c.status === "claimed" && c.mine ? (
        <span className="text-xs text-muted">You added it — someone else verifies it.</span>
      ) : null}
      {c.status === "claimed" && !c.mine && c.source === "certificate" ? (
        <label className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={seen} onChange={(e) => setSeen(e.target.checked)} />I have
          seen the certificate
        </label>
      ) : null}
      {c.status === "claimed" && !c.mine ? (
        <Button variant="ghost" onClick={() => act.mutate("verify")} disabled={act.isPending}>
          {c.source === "credly_mock" ? "Check & verify" : "Verify"}
        </Button>
      ) : null}
      <input
        aria-label={`Reason for ${c.id}`}
        placeholder="Reason (reject / withdraw)"
        className="rounded-ogc border border-border bg-surface p-1 text-xs"
        value={why}
        onChange={(e) => setWhy(e.target.value)}
      />
      {c.status === "claimed" && !c.mine ? (
        <Button variant="ghost" onClick={() => act.mutate("reject")} disabled={act.isPending}>
          Reject
        </Button>
      ) : null}
      <Button variant="ghost" onClick={() => act.mutate("withdraw")} disabled={act.isPending}>
        Withdraw
      </Button>
      <Failure r={act.data} />
    </div>
  );
}

// ── teacher: my public profile ─────────────────────────────────────────────────────────────
export function MyPublicProfilePage() {
  const s = useSignedIn();
  const q = useQuery({
    queryKey: ["brand", "me", s.principalId],
    queryFn: () => platformApi.myPublicProfile(s),
  });
  if (q.isLoading) return <Spinner label="Loading your profile" />;
  if (q.isError)
    return <ErrorState message="Could not load your profile." onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="Teachers only" />;
  return <MyProfile p={q.data} />;
}

function MyProfile({ p }: { p: MyPublicProfile }) {
  const s = useSignedIn();
  const qc = useQueryClient();
  const [d, setD] = useState({ isPublic: p.isPublic, displayName: p.displayName, bio: p.bio });
  const [why, setWhy] = useState("");
  const save = useMutation({
    mutationFn: () => platformApi.saveMyPublicProfile(s, d),
    onSuccess: (r) => (r.ok ? qc.invalidateQueries({ queryKey: ["brand"] }) : undefined),
  });
  const withdraw = useMutation({
    mutationFn: (id: string) => platformApi.withdrawMyCredential(s, id, why),
    onSuccess: (r) => (r.ok ? qc.invalidateQueries({ queryKey: ["brand"] }) : undefined),
  });
  return (
    <section className="space-y-4">
      <PageHeader title="My public profile" subtitle={`${p.name} · you decide what visitors see`} />
      <Card>
        <section aria-label="Profile" className="space-y-3 text-sm">
          <p className="text-muted">
            When on, visitors of the public course pages see your display name, this short bio and
            your verified badges — on the courses whose classes you teach. No photo, no contact
            details. Turning it off removes it at once. Staff cannot turn it on for you.
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={d.isPublic}
              onChange={(e) => setD({ ...d, isPublic: e.target.checked })}
            />
            Show my profile on the public pages
          </label>
          <label className="block">
            Display name
            <input
              className={field}
              value={d.displayName}
              onChange={(e) => setD({ ...d, displayName: e.target.value })}
            />
          </label>
          <label className="block">
            Short bio (up to 400 characters)
            <textarea
              className={field}
              rows={3}
              value={d.bio}
              onChange={(e) => setD({ ...d, bio: e.target.value })}
            />
          </label>
          <div className="flex items-center gap-2">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              Save my profile
            </Button>
            <Failure r={save.data} />
            {save.data?.ok ? <span role="status">Saved.</span> : null}
          </div>
        </section>
      </Card>
      <Card className="space-y-3">
        <h2 className="text-base font-medium">My badges</h2>
        {p.credentials.length ? (
          <ul aria-label="My badges" className="space-y-3">
            {p.credentials.map((c) => (
              <li key={c.id} data-testid={`cred-${c.id}`} className="text-sm">
                <CredentialLine c={c} />
                {c.status === "claimed" || c.status === "verified" ? (
                  <div className="mt-1 flex items-center gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => withdraw.mutate(c.id)}
                      disabled={withdraw.isPending}
                    >
                      Withdraw
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No badges yet.</p>
        )}
        <label className="block text-sm">
          Reason to withdraw
          <input className={field} value={why} onChange={(e) => setWhy(e.target.value)} />
        </label>
        <Failure r={withdraw.data} />
      </Card>
      <Card>
        <ClaimForm who="of yours" onClaim={(c) => platformApi.claimMyCredential(s, c)} />
      </Card>
    </section>
  );
}
