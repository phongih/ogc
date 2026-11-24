/*
 * Public course showcase on the Platform (owner 23/11). Staff: a "Public showcase" card on a course
 * (on / off, offer, catalog course, learning needs — outside the immutable versions). Public (no
 * sign-in): the organizations with a showcase, an organization's courses ranked by fit for what
 * the visitor chooses (never by price), a course's page and a minimal enquiry form. Synthetic data.
 */
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  LEARNING_NEEDS,
  SHOWCASE_OFFERS,
  type LearningNeed,
  type ShowcaseCard,
  type ShowcaseEnquiryKind,
  type ShowcaseOffer,
  type ShowcaseSettings,
} from "@ogc/contracts";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../ui";
import { platformApi } from "./client";
import { useSession, useSignedIn } from "./App";
import { ProviderBlock } from "./brand";

const NEED_LABEL: Record<LearningNeed, string> = {
  exam_prep: "Exam preparation",
  speaking_confidence: "Speaking confidence",
  school_support: "School support",
  work_english: "English for work",
  travel: "Travel",
  young_learner: "Young learners",
};
const OFFER_LABEL: Record<ShowcaseOffer, string> = {
  free: "Free",
  trial: "Free trial lesson",
  paid: "Paid",
};
const vnd = (n: number) => `${new Intl.NumberFormat("vi-VN").format(n)} ₫`;
const field = "mt-1 block w-full rounded-ogc border border-border bg-surface p-2";

function OfferLine({ c }: { c: Pick<ShowcaseCard, "offer" | "priceFromVnd"> }) {
  return (
    <span>
      {OFFER_LABEL[c.offer]}
      {c.offer !== "free" && c.priceFromVnd !== null
        ? ` · ${c.offer === "trial" ? "then " : ""}from ${vnd(c.priceFromVnd)} / term`
        : ""}
    </span>
  );
}

// ── staff: the course's showcase settings ──────────────────────────────────────────────────
export function ShowcaseSettingsCard() {
  const { ref = "" } = useParams();
  const session = useSession().session;
  if (session?.role !== "staff") return null;
  return <SettingsLoader courseRef={ref} />;
}

function SettingsLoader({ courseRef }: { courseRef: string }) {
  const s = useSignedIn();
  const q = useQuery({
    queryKey: ["showcase-settings", s.principalId, courseRef],
    queryFn: () => platformApi.showcaseSettings(s, courseRef),
  });
  if (!q.data) return null;
  return <SettingsForm key={JSON.stringify(q.data)} v={q.data} />;
}

function SettingsForm({ v }: { v: ShowcaseSettings }) {
  const s = useSignedIn();
  const qc = useQueryClient();
  const [d, setD] = useState({
    isPublic: v.isPublic,
    offer: v.offer,
    catalogCode: v.catalogCode ?? "",
    needs: v.needs,
  });
  const options = useQuery({
    queryKey: ["billing-options", s.principalId],
    queryFn: () => platformApi.billingOptions(s),
  });
  const save = useMutation({
    mutationFn: () =>
      platformApi.saveShowcase(s, v.ref, { ...d, catalogCode: d.catalogCode || null }),
    onSuccess: (r) =>
      r.ok ? qc.invalidateQueries({ queryKey: ["showcase-settings"] }) : undefined,
  });
  const codes = options.data?.courseCodes ?? (v.catalogCode ? [v.catalogCode] : []);
  return (
    <Card className="mt-4">
      <section aria-label="Public showcase" className="space-y-3 text-sm">
        <h2 className="text-base font-medium">Public showcase</h2>
        <p className="text-muted">
          {v.publishedVersion
            ? `Visitors see the latest published version (v${v.publishedVersion}); its content never changes here.`
            : "Publish a version first — only published courses can be shown."}{" "}
          Courses are ranked for each visitor by what they choose, never by price.
          {v.updatedBy ? ` Last set by ${v.updatedBy}.` : ""}
        </p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={d.isPublic}
            onChange={(e) => setD({ ...d, isPublic: e.target.checked })}
          />
          Show on the public page
        </label>
        <label className="block">
          Offer
          <select
            className={field}
            value={d.offer}
            onChange={(e) => setD({ ...d, offer: e.target.value as ShowcaseOffer })}
          >
            {SHOWCASE_OFFERS.map((o) => (
              <option key={o} value={o}>
                {OFFER_LABEL[o]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          Catalog course (enquiries become Admissions leads for it)
          <select
            className={field}
            value={d.catalogCode}
            onChange={(e) => setD({ ...d, catalogCode: e.target.value })}
          >
            <option value="">—</option>
            {codes.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <fieldset>
          <legend>Serves these learning needs</legend>
          <div className="flex flex-wrap gap-3">
            {LEARNING_NEEDS.map((n) => (
              <label key={n} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={d.needs.includes(n)}
                  onChange={(e) =>
                    setD({
                      ...d,
                      needs: e.target.checked ? [...d.needs, n] : d.needs.filter((x) => x !== n),
                    })
                  }
                />
                {NEED_LABEL[n]}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex items-center gap-2">
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Save showcase
          </Button>
          {save.data?.ok === false ? (
            <span role="alert" className="text-danger">
              {save.data.detail ?? save.data.reason}
            </span>
          ) : null}
          {d.isPublic && v.publishedVersion ? (
            <Link className="text-brand underline" to="/showcase">
              Open the public page
            </Link>
          ) : null}
        </div>
      </section>
    </Card>
  );
}

// ── public pages ───────────────────────────────────────────────────────────────────────────
export function ShowcaseHomePage() {
  const q = useQuery({ queryKey: ["showcase-orgs"], queryFn: () => platformApi.showcaseOrgs() });
  if (q.isLoading) return <Spinner label="Loading courses" />;
  if (q.isError)
    return <ErrorState message="Could not load courses." onRetry={() => q.refetch()} />;
  return (
    <section className="space-y-4">
      <PageHeader title="Courses" subtitle="Find an English course · staging, synthetic data" />
      {q.data?.length ? (
        <ul className="space-y-2" aria-label="Organizations">
          {q.data.map((o) => (
            <li key={o.slug}>
              <Card>
                <Link className="font-medium text-brand underline" to={`/showcase/${o.slug}`}>
                  {o.name}
                </Link>{" "}
                <span className="text-sm text-muted">· {o.courses} courses</span>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No courses on show yet." />
      )}
    </section>
  );
}

export function ShowcaseOrgPage() {
  const { org = "" } = useParams();
  const [level, setLevel] = useState("");
  const [center, setCenter] = useState("");
  const [needs, setNeeds] = useState<LearningNeed[]>([]);
  const q = useQuery({
    queryKey: ["showcase", org, level, center, needs],
    queryFn: () => platformApi.showcasePage(org, { level, center, needs }),
  });
  if (q.isLoading && !q.data) return <Spinner label="Loading courses" />;
  if (q.isError)
    return <ErrorState message="Could not load courses." onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="Not found" hint="This organization has no public page." />;
  const p = q.data;
  return (
    <section className="space-y-4">
      <PageHeader title={`Courses at ${p.org.name}`} subtitle="Staging, synthetic data" />
      <Link to={`/showcase/${p.org.slug}/about`} className="text-sm text-brand underline">
        About {p.org.name} — centers, verified badges, teachers
      </Link>
      <Card>
        <section aria-label="What are you looking for?" className="space-y-2 text-sm">
          <p className="font-medium">What are you looking for?</p>
          <p className="text-muted">
            Courses are ordered by how well they fit your choices — never by price. Nothing you
            choose is stored.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              Level
              <select className={field} value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="">Any level</option>
                {p.levels.map((l) => (
                  <option key={l}>{l}</option>
                ))}
              </select>
            </label>
            <label className="block">
              Center
              <select className={field} value={center} onChange={(e) => setCenter(e.target.value)}>
                <option value="">Any center</option>
                {p.centers.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="flex flex-wrap gap-3">
            <legend className="sr-only">Learning needs</legend>
            {p.needs.map((n) => (
              <label key={n} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={needs.includes(n)}
                  onChange={(e) =>
                    setNeeds(e.target.checked ? [...needs, n] : needs.filter((x) => x !== n))
                  }
                />
                {NEED_LABEL[n]}
              </label>
            ))}
          </fieldset>
        </section>
      </Card>
      <ol className="grid gap-3 sm:grid-cols-2" aria-label="Courses">
        {p.courses.map((c) => (
          <li key={c.ref}>
            <Card className="h-full space-y-2">
              <Link
                to={`/showcase/${p.org.slug}/${c.ref}`}
                className="text-lg font-medium text-brand underline"
              >
                {c.title}
              </Link>
              <p className="text-sm text-muted">
                Level {c.level} · {c.lessons} lessons · <OfferLine c={c} />
              </p>
              <p className="text-sm">{c.summary}</p>
              <p className="text-xs text-muted">
                {c.centers.length ? c.centers.join(" · ") : "Self-study — no class needed"}
              </p>
              {c.fit.reasons.length ? (
                <ul className="text-xs text-brand" aria-label={`Why ${c.title} fits`}>
                  {c.fit.reasons.map((r) => (
                    <li key={r}>✓ {r}</li>
                  ))}
                </ul>
              ) : null}
            </Card>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ShowcaseCoursePage() {
  const { org = "", ref = "" } = useParams();
  const q = useQuery({
    queryKey: ["showcase-course", org, ref],
    queryFn: () => platformApi.showcaseCourse(org, ref),
  });
  if (q.isLoading) return <Spinner label="Loading the course" />;
  if (q.isError)
    return <ErrorState message="Could not load the course." onRetry={() => q.refetch()} />;
  if (!q.data) return <EmptyState title="Course not found" hint="It is not on show." />;
  const c = q.data;
  return (
    <section className="space-y-4">
      <PageHeader title={c.title} subtitle={`${c.org.name} · Level ${c.level}`} />
      <Card className="space-y-2">
        <p>{c.summary}</p>
        <p className="text-sm">
          <OfferLine c={c} />
        </p>
        {c.needs.length ? (
          <p className="text-sm text-muted">For: {c.needs.map((n) => NEED_LABEL[n]).join(", ")}</p>
        ) : null}
        <p className="text-sm text-muted">
          {c.centers.length
            ? `Classes at ${c.centers.join(" · ")}`
            : "Self-study — no class needed"}
        </p>
      </Card>
      <Card>
        <h2 className="mb-2 font-medium">Learning path</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm" aria-label="Learning path">
          {c.path.map((l, i) => (
            <li key={i}>{l.title}</li>
          ))}
        </ol>
      </Card>
      <ProviderBlock
        slug={c.org.slug}
        name={c.org.name}
        brand={c.brand}
        instructors={c.instructors}
      />
      <Enquiry slug={c.org.slug} courseRef={c.ref} offer={c.offer} centers={c.allCenters} />
      <Link to={`/showcase/${c.org.slug}`} className="text-sm text-brand">
        ← All courses at {c.org.name}
      </Link>
    </section>
  );
}

function Enquiry(props: {
  slug: string;
  courseRef: string;
  offer: ShowcaseOffer;
  centers: string[];
}) {
  const [name, setName] = useState("");
  const [center, setCenter] = useState(props.centers[0] ?? "");
  const [kind, setKind] = useState<ShowcaseEnquiryKind>(
    props.offer === "trial" ? "trial" : "consult",
  );
  const [needs, setNeeds] = useState<LearningNeed[]>([]);
  const send = useMutation({
    mutationFn: () =>
      platformApi.showcaseEnquire(props.slug, props.courseRef, {
        learnerName: name,
        centerName: center,
        kind,
        needs,
      }),
  });
  if (send.data?.ok)
    return (
      <Card>
        <p role="status" className="font-medium">
          Thank you — the center will be in touch.
        </p>
        <p className="text-sm text-muted">Staging, synthetic data: no message is sent.</p>
      </Card>
    );
  return (
    <Card>
      <section aria-label="Ask about this course" className="space-y-3 text-sm">
        <h2 className="text-base font-medium">
          {props.offer === "trial" ? "Book a trial lesson or ask us" : "Ask about this course"}
        </h2>
        <p className="text-muted">
          A name, a center and what you need — synthetic data only, please: no real names, phone
          numbers or e-mail addresses.
        </p>
        <label className="block">
          Learner&apos;s name (synthetic)
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          Center
          <select className={field} value={center} onChange={(e) => setCenter(e.target.value)}>
            {props.centers.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {props.offer === "trial" ? (
          <fieldset className="flex gap-4">
            <legend className="sr-only">What would you like?</legend>
            <label className="flex items-center gap-1">
              <input type="radio" checked={kind === "trial"} onChange={() => setKind("trial")} />A
              trial lesson
            </label>
            <label className="flex items-center gap-1">
              <input
                type="radio"
                checked={kind === "consult"}
                onChange={() => setKind("consult")}
              />
              A consultation
            </label>
          </fieldset>
        ) : null}
        <fieldset className="flex flex-wrap gap-3">
          <legend>What do you need? (optional)</legend>
          {LEARNING_NEEDS.map((n) => (
            <label key={n} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={needs.includes(n)}
                onChange={(e) =>
                  setNeeds(e.target.checked ? [...needs, n] : needs.filter((x) => x !== n))
                }
              />
              {NEED_LABEL[n]}
            </label>
          ))}
        </fieldset>
        <Button onClick={() => send.mutate()} disabled={send.isPending}>
          Send
        </Button>
        {send.data && !send.data.ok ? (
          <p role="alert" className="text-danger">
            Not sent: {send.data.detail ?? send.data.reason}
          </p>
        ) : null}
      </section>
    </Card>
  );
}
