/*
 * P2 · Set up a new center (staff). Owner decisions 21/11: a center inside an EXISTING
 * organization; staff = assign existing teachers; fees optional and mock-only. Same shape as the
 * EduOS campus wizard: steps on the left, the required checklist on the right, a draft kept in
 * this browser, a review step. Opening the center creates its classes and first sessions.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CenterSetupDraft, CenterSetupResult, SetupClass, SetupContext } from "@ogc/contracts";
import { centerSetupChecklist, classIssues, emptyCenterDraft, feeIssues } from "@ogc/contracts";
import { centerSetup } from "../../lib/api";
import { useSession } from "../../app/session";
import { refreshLearningState } from "../../lib/invalidate";
import { Button, Card, EmptyState, ErrorState, PageHeader, Spinner } from "../../ui";

const STEPS = [
  "Center info",
  "Courses",
  "Rooms & days",
  "Classes & teachers",
  "Fees (optional)",
  "Review & open",
];
const DAYS = [1, 2, 3, 4, 5, 6, 0];
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const draftKey = (viewer: string) => `ogc.centerSetup.draft.${viewer}`;

// Browser storage can be missing or throw (private mode); the wizard works without it.
function loadDraft(viewer: string): CenterSetupDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(viewer));
    return raw
      ? { ...emptyCenterDraft(), ...(JSON.parse(raw) as Partial<CenterSetupDraft>) }
      : null;
  } catch {
    return null;
  }
}
function saveDraft(viewer: string, d: CenterSetupDraft | null) {
  try {
    if (d) window.localStorage.setItem(draftKey(viewer), JSON.stringify(d));
    else window.localStorage.removeItem(draftKey(viewer));
  } catch {
    /* no storage — fine */
  }
}

const input = "mt-1 block w-full rounded-ogc border border-border bg-surface p-1.5 text-sm";

export function CenterSetupWizard() {
  const { session } = useSession();
  const viewer = session?.personaId ?? "";
  const ctx = useQuery({
    queryKey: ["center-setup-ctx", viewer],
    queryFn: () => centerSetup.getSetupContext(viewer),
    enabled: !!viewer,
  });
  if (ctx.isLoading) return <Spinner label="Loading center setup" />;
  if (ctx.isError)
    return <ErrorState message="Could not load center setup." onRetry={() => ctx.refetch()} />;
  if (!ctx.data) return <EmptyState title="Center setup is for center staff" />;
  return <Wizard viewer={viewer} ctx={ctx.data} />;
}

function Wizard({ viewer, ctx }: { viewer: string; ctx: SetupContext }) {
  const qc = useQueryClient();
  const restored = useMemo(() => loadDraft(viewer), [viewer]);
  const [draft, setDraft] = useState<CenterSetupDraft>(
    () => restored ?? { ...emptyCenterDraft(), brandId: ctx.brands[0]?.id ?? "" },
  );
  const [showRestored, setShowRestored] = useState(!!restored);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState<Extract<CenterSetupResult, { ok: true }> | null>(null);
  useEffect(() => {
    if (!done) saveDraft(viewer, draft);
  }, [viewer, draft, done]);

  const checks = centerSetupChecklist(draft, ctx.takenCodes);
  const required = checks.every((c) => c.ok);
  const feesOk = draft.fees.every((f) => feeIssues(f).length === 0);
  const set = (patch: Partial<CenterSetupDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const open = useMutation({
    mutationFn: () => centerSetup.createCenter(viewer, draft),
    onSuccess: (r) => {
      if (r.ok) {
        saveDraft(viewer, null);
        setDone(r);
      }
      return refreshLearningState(qc);
    },
  });

  if (done)
    return (
      <section className="space-y-4">
        <PageHeader title={`${draft.name} is open`} subtitle={`${ctx.orgName} · synthetic demo`} />
        <Card>
          <p role="status" className="text-sm">
            Center opened · {done.classIds.length}{" "}
            {done.classIds.length === 1 ? "class" : "classes"} · {done.sessionsCreated} sessions
            scheduled for the first 4 weeks.
          </p>
        </Card>
        <Link to="/app/operations" className="inline-block text-sm text-brand">
          → Center operations
        </Link>
      </section>
    );

  return (
    <section className="space-y-4">
      <PageHeader
        title="Set up a new center"
        subtitle={`${ctx.orgName} · center time · synthetic demo`}
      />
      {showRestored ? (
        <p className="text-xs text-muted" role="status">
          Unsaved progress restored from this browser ·{" "}
          <button
            type="button"
            className="text-brand underline"
            onClick={() => {
              setDraft({ ...emptyCenterDraft(), brandId: ctx.brands[0]?.id ?? "" });
              setShowRestored(false);
              setStep(0);
            }}
          >
            discard
          </button>
        </p>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[200px_1fr_220px]">
        <nav aria-label="Setup steps">
          <ol className="space-y-1 text-sm">
            {STEPS.map((s, i) => (
              <li key={s}>
                <button
                  type="button"
                  aria-current={i === step ? "step" : undefined}
                  className={`w-full rounded-ogc px-2 py-1.5 text-left ${i === step ? "bg-surface font-medium text-brand" : ""}`}
                  onClick={() => setStep(i)}
                >
                  {i + 1}. {s}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <Card className="space-y-4">
          <h2 className="text-lg font-medium">
            {step + 1}. {STEPS[step]}
          </h2>
          {step === 0 ? <InfoStep draft={draft} set={set} ctx={ctx} /> : null}
          {step === 1 ? <CoursesStep draft={draft} set={set} ctx={ctx} /> : null}
          {step === 2 ? <RoomsStep draft={draft} set={set} /> : null}
          {step === 3 ? <ClassesStep draft={draft} set={set} ctx={ctx} /> : null}
          {step === 4 ? <FeesStep draft={draft} set={set} ctx={ctx} /> : null}
          {step === 5 ? (
            <ReviewStep
              draft={draft}
              ctx={ctx}
              canOpen={required && feesOk}
              result={open.data}
              pending={open.isPending}
              onOpen={() => open.mutate()}
            />
          ) : null}
          <div className="flex justify-between border-t border-border pt-3">
            <Button variant="ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
              ← Back
            </Button>
            {step < STEPS.length - 1 ? (
              <Button onClick={() => setStep((s) => s + 1)}>Next →</Button>
            ) : null}
          </div>
        </Card>

        <aside aria-label="Checklist" className="space-y-2 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Checklist · {checks.filter((c) => c.ok).length}/{checks.length}
          </p>
          <ul className="space-y-1">
            {checks.map((c) => (
              <li key={c.key} data-ok={c.ok}>
                <span aria-hidden>{c.ok ? "✓" : "○"}</span> {c.label}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted">Optional: fee schedule ({draft.fees.length})</p>
        </aside>
      </div>
      <Link to="/app/operations" className="inline-block text-sm text-brand">
        ← Back to center operations (the draft stays in this browser)
      </Link>
    </section>
  );
}

type StepProps = {
  draft: CenterSetupDraft;
  set: (p: Partial<CenterSetupDraft>) => void;
  ctx: SetupContext;
};

function InfoStep({ draft, set, ctx }: StepProps) {
  const code = draft.code.trim().toUpperCase();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">
        <span className="text-muted">Center name</span>
        <input
          className={input}
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
        />
      </label>
      <label className="text-sm">
        <span className="text-muted">Center code (2–12: A–Z, 0–9, -)</span>
        <input
          className={input}
          value={draft.code}
          onChange={(e) => set({ code: e.target.value.toUpperCase() })}
        />
        {ctx.takenCodes.includes(code) ? (
          <span className="text-xs text-danger">Code already used in {ctx.orgName}</span>
        ) : null}
      </label>
      <label className="text-sm">
        <span className="text-muted">Brand</span>
        <select
          className={input}
          value={draft.brandId}
          onChange={(e) => set({ brandId: e.target.value })}
        >
          {ctx.brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="text-muted">City</span>
        <input
          className={input}
          value={draft.city}
          onChange={(e) => set({ city: e.target.value })}
        />
      </label>
      <label className="text-sm sm:col-span-2">
        <span className="text-muted">Address</span>
        <input
          className={input}
          value={draft.addressLine}
          onChange={(e) => set({ addressLine: e.target.value })}
        />
      </label>
      <p className="text-xs text-muted sm:col-span-2">
        Opens inside {ctx.orgName}. New organizations come from the EduOS / IIOS side, not from
        here.
      </p>
    </div>
  );
}

function CoursesStep({ draft, set, ctx }: StepProps) {
  const toggle = (id: string) =>
    set({
      courseIds: draft.courseIds.includes(id)
        ? draft.courseIds.filter((x) => x !== id)
        : [...draft.courseIds, id],
      // Dropping a course drops its fees; classes on it will show as needing a fix.
      fees: draft.courseIds.includes(id) ? draft.fees.filter((f) => f.courseId !== id) : draft.fees,
    });
  return (
    <ul className="space-y-2">
      {ctx.courses.map((c) => (
        <li key={c.id}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.courseIds.includes(c.id)}
              onChange={() => toggle(c.id)}
            />
            <span className="font-medium">{c.code}</span> {c.title}{" "}
            <span className="text-muted">· {c.level}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

function RoomsStep({ draft, set }: Omit<StepProps, "ctx">) {
  const rooms = draft.rooms;
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Rooms</h3>
        {rooms.map((r, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              <span className="text-muted">Room name</span>
              <input
                aria-label={`Room ${i + 1} name`}
                className={input}
                value={r.name}
                onChange={(e) =>
                  set({
                    rooms: rooms.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                  })
                }
              />
            </label>
            <label className="text-sm">
              <span className="text-muted">Seats</span>
              <input
                aria-label={`Room ${i + 1} seats`}
                type="number"
                min={1}
                max={60}
                className={input}
                value={r.capacity}
                onChange={(e) =>
                  set({
                    rooms: rooms.map((x, j) =>
                      j === i ? { ...x, capacity: Number(e.target.value) } : x,
                    ),
                  })
                }
              />
            </label>
            <Button variant="ghost" onClick={() => set({ rooms: rooms.filter((_, j) => j !== i) })}>
              Remove room {i + 1}
            </Button>
          </div>
        ))}
        <Button
          variant="ghost"
          onClick={() =>
            set({ rooms: [...rooms, { name: `Room ${rooms.length + 1}`, capacity: 12 }] })
          }
        >
          + Add room
        </Button>
      </div>
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Opening days and hours (center time)</h3>
        <div className="flex flex-wrap gap-3 text-sm">
          {DAYS.map((d) => (
            <label key={d} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={draft.openDays.includes(d)}
                onChange={() =>
                  set({
                    openDays: draft.openDays.includes(d)
                      ? draft.openDays.filter((x) => x !== d)
                      : [...draft.openDays, d],
                  })
                }
              />
              {DAY[d]}
            </label>
          ))}
        </div>
        <div className="flex gap-2">
          <label className="text-sm">
            <span className="text-muted">Opens</span>
            <input
              type="time"
              className={input}
              value={draft.openFrom}
              onChange={(e) => set({ openFrom: e.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="text-muted">Closes</span>
            <input
              type="time"
              className={input}
              value={draft.openTo}
              onChange={(e) => set({ openTo: e.target.value })}
            />
          </label>
        </div>
      </div>
    </div>
  );
}

function ClassesStep({ draft, set, ctx }: StepProps) {
  const update = (i: number, patch: Partial<SetupClass>) =>
    set({ classes: draft.classes.map((c, j) => (j === i ? { ...c, ...patch } : c)) });
  const add = () =>
    set({
      classes: [
        ...draft.classes,
        {
          name: `Class ${draft.classes.length + 1}`,
          courseId: draft.courseIds[0] ?? "",
          room: draft.rooms[0]?.name ?? "",
          weekdays: [],
          time: "18:00",
          durationMin: 90,
          teacherId: "",
        },
      ],
    });
  return (
    <div className="space-y-3">
      {draft.classes.length === 0 ? <p className="text-sm text-muted">No classes yet.</p> : null}
      {draft.classes.map((c, i) => {
        const issues = classIssues(draft, c);
        return (
          <fieldset
            key={i}
            aria-label={`Class ${i + 1}`}
            className="space-y-2 rounded-ogc border border-border p-3"
          >
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="text-sm">
                <span className="text-muted">Class name</span>
                <input
                  aria-label={`Class ${i + 1} name`}
                  className={input}
                  value={c.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <span className="text-muted">Course</span>
                <select
                  aria-label={`Class ${i + 1} course`}
                  className={input}
                  value={c.courseId}
                  onChange={(e) => update(i, { courseId: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {ctx.courses
                    .filter((x) => draft.courseIds.includes(x.id))
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.code} · {x.title}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="text-muted">Room</span>
                <select
                  aria-label={`Class ${i + 1} room`}
                  className={input}
                  value={c.room}
                  onChange={(e) => update(i, { room: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {draft.rooms.map((r) => (
                    <option key={r.name} value={r.name}>
                      {r.name} · {r.capacity} seats
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="text-muted">Starts (center time)</span>
                <input
                  aria-label={`Class ${i + 1} time`}
                  type="time"
                  className={input}
                  value={c.time}
                  onChange={(e) => update(i, { time: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <span className="text-muted">Minutes</span>
                <input
                  aria-label={`Class ${i + 1} minutes`}
                  type="number"
                  className={input}
                  value={c.durationMin}
                  onChange={(e) => update(i, { durationMin: Number(e.target.value) })}
                />
              </label>
              <label className="text-sm">
                <span className="text-muted">Teacher</span>
                <select
                  aria-label={`Class ${i + 1} teacher`}
                  className={input}
                  value={c.teacherId}
                  onChange={(e) => update(i, { teacherId: e.target.value })}
                >
                  <option value="">Choose…</option>
                  {ctx.teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div
              className="flex flex-wrap gap-3 text-sm"
              role="group"
              aria-label={`Class ${i + 1} days`}
            >
              {DAYS.map((d) => (
                <label key={d} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={c.weekdays.includes(d)}
                    onChange={() =>
                      update(i, {
                        weekdays: c.weekdays.includes(d)
                          ? c.weekdays.filter((x) => x !== d)
                          : [...c.weekdays, d],
                      })
                    }
                  />
                  {DAY[d]}
                </label>
              ))}
            </div>
            {issues.length ? (
              <p className="text-xs text-danger">This class {issues.join(", ")}.</p>
            ) : null}
            <Button
              variant="ghost"
              onClick={() => set({ classes: draft.classes.filter((_, j) => j !== i) })}
            >
              Remove class {i + 1}
            </Button>
          </fieldset>
        );
      })}
      <Button
        variant="ghost"
        onClick={add}
        disabled={draft.courseIds.length === 0 || draft.rooms.length === 0}
      >
        + Add class
      </Button>
      <p className="text-xs text-muted">
        Teachers are the center&apos;s existing teachers — no accounts or access are created here.
      </p>
    </div>
  );
}

function FeesStep({ draft, set, ctx }: StepProps) {
  const feeFor = (courseId: string) => draft.fees.find((f) => f.courseId === courseId);
  const put = (
    courseId: string,
    patch: { amountVnd?: number; per?: "course" | "month" } | null,
  ) => {
    const rest = draft.fees.filter((f) => f.courseId !== courseId);
    if (!patch) return set({ fees: rest });
    const cur = feeFor(courseId) ?? { courseId, amountVnd: 0, per: "course" as const };
    set({ fees: [...rest, { ...cur, ...patch }] });
  };
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        Optional · a price list for this demo only — nothing is charged or invoiced.
      </p>
      {ctx.courses
        .filter((c) => draft.courseIds.includes(c.id))
        .map((c) => {
          const f = feeFor(c.id);
          return (
            <div key={c.id} className="flex flex-wrap items-end gap-2">
              <span className="w-40 text-sm">{c.code}</span>
              {f ? (
                <>
                  <label className="text-sm">
                    <span className="text-muted">VND</span>
                    <input
                      aria-label={`Fee for ${c.code}`}
                      type="number"
                      className={input}
                      value={f.amountVnd}
                      onChange={(e) => put(c.id, { amountVnd: Number(e.target.value) })}
                    />
                  </label>
                  <label className="text-sm">
                    <span className="text-muted">per</span>
                    <select
                      className={input}
                      value={f.per}
                      onChange={(e) => put(c.id, { per: e.target.value as "course" | "month" })}
                    >
                      <option value="course">course</option>
                      <option value="month">month</option>
                    </select>
                  </label>
                  <Button variant="ghost" onClick={() => put(c.id, null)}>
                    Remove fee
                  </Button>
                  {feeIssues(f).length ? (
                    <span className="text-xs text-danger">{feeIssues(f)[0]}</span>
                  ) : null}
                </>
              ) : (
                <Button variant="ghost" onClick={() => put(c.id, { amountVnd: 0 })}>
                  + Fee for {c.code}
                </Button>
              )}
            </div>
          );
        })}
    </div>
  );
}

function ReviewStep({
  draft,
  ctx,
  canOpen,
  result,
  pending,
  onOpen,
}: {
  draft: CenterSetupDraft;
  ctx: SetupContext;
  canOpen: boolean;
  result: CenterSetupResult | undefined;
  pending: boolean;
  onOpen: () => void;
}) {
  const course = (id: string) => ctx.courses.find((c) => c.id === id);
  return (
    <div className="space-y-3 text-sm">
      <p>
        <span className="font-medium">{draft.name || "—"}</span> ({draft.code || "no code"}) ·{" "}
        {ctx.brands.find((b) => b.id === draft.brandId)?.name} · {draft.city || "—"}
      </p>
      <p>Courses: {draft.courseIds.map((id) => course(id)?.code).join(", ") || "—"}</p>
      <p>
        Rooms: {draft.rooms.map((r) => `${r.name} (${r.capacity})`).join(", ") || "—"} · open{" "}
        {DAYS.filter((d) => draft.openDays.includes(d))
          .map((d) => DAY[d])
          .join(" ")}{" "}
        {draft.openFrom}–{draft.openTo}
      </p>
      <ul className="list-disc pl-5">
        {draft.classes.map((c, i) => (
          <li key={i}>
            {c.name} · {course(c.courseId)?.code} ·{" "}
            {DAYS.filter((d) => c.weekdays.includes(d))
              .map((d) => DAY[d])
              .join("/")}{" "}
            {c.time} · {c.room} ·{" "}
            {ctx.teachers.find((t) => t.id === c.teacherId)?.name ?? "no teacher"}
          </li>
        ))}
      </ul>
      <p>
        Fees (mock):{" "}
        {draft.fees.length
          ? draft.fees
              .map(
                (f) =>
                  `${course(f.courseId)?.code} ${f.amountVnd.toLocaleString("en-US")} VND/${f.per}`,
              )
              .join(", ")
          : "none"}
      </p>
      <Button disabled={!canOpen || pending} onClick={onOpen}>
        Open {draft.name || "the center"}
      </Button>
      {!canOpen ? (
        <p className="text-xs text-muted">Finish the checklist to open the center.</p>
      ) : null}
      {result && !result.ok ? (
        <p role="alert" className="text-danger">
          Could not open the center ({result.reason}: {result.failed.join(", ") || "—"}).
        </p>
      ) : null}
    </div>
  );
}
