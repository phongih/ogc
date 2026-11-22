/*
 * Public landing for a shared referral link (/join?ref=CODE&c=campaign). Records one click and
 * offers a SYNTHETIC enquiry form: a display name, a course and a center — no phone, e-mail or
 * other contact details (synthetic data only). Staff take it from there in Center operations.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { growth } from "../../lib/api";
import { saveDemoState } from "../../lib/adapters/persist";
import { Button, Card } from "../../ui";

type Info = Awaited<ReturnType<typeof growth.recordClick>>;

export function JoinPage() {
  const [params] = useSearchParams();
  const code = params.get("ref") ?? "";
  const campaignId = params.get("c");
  const [info, setInfo] = useState<Info | null>(null);
  const [name, setName] = useState("");
  const [course, setCourse] = useState("");
  const [center, setCenter] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const counted = useRef(false);

  useEffect(() => {
    if (counted.current) return; // one click per visit (StrictMode runs effects twice)
    counted.current = true;
    void growth.recordClick(code).then((i) => {
      saveDemoState(); // other open tabs (e.g. staff's Funnel) pick it up at once
      setInfo(i);
      setCourse(i.courses[0]?.code ?? "");
      setCenter(i.centerNames[0] ?? "");
    });
  }, [code]);

  const field = "mt-1 block w-full rounded-ogc border border-border bg-surface p-2";
  return (
    <main id="main" className="mx-auto max-w-lg px-4 py-12">
      <h1 className="text-3xl font-semibold">Join OGC English</h1>
      {!info ? (
        <p className="mt-4 text-muted">Checking the invitation…</p>
      ) : !info.valid ? (
        <p className="mt-4" role="alert">
          This referral link is not valid (or the program is paused).
        </p>
      ) : result === "ok" ? (
        <Card className="mt-6 space-y-2">
          <p className="font-medium" role="status">
            Thank you — the center will be in touch about a placement test.
          </p>
          <p className="text-sm text-muted">Synthetic demo: no message is sent.</p>
        </Card>
      ) : (
        <Card className="mt-6 space-y-4">
          <p className="text-sm text-muted">
            A friend invited you (code <strong>{code.toUpperCase()}</strong>). Tell us who would
            like to learn — synthetic demo data only, please: no real names or contact details.
          </p>
          <label className="block text-sm">
            Learner&apos;s name (synthetic)
            <input
              aria-label="Learner name"
              className={field}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Course
            <select
              aria-label="Course"
              className={field}
              value={course}
              onChange={(e) => setCourse(e.target.value)}
            >
              {info.courses.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.title}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Center
            <select
              aria-label="Center"
              className={field}
              value={center}
              onChange={(e) => setCenter(e.target.value)}
            >
              {info.centerNames.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <Button
            onClick={async () => {
              const r = await growth.submitLead(code, {
                learnerName: name,
                courseCode: course,
                centerName: center,
                campaignId,
              });
              if (r.ok) saveDemoState(); // save now — not only when this tab closes
              setResult(r.ok ? "ok" : (r.detail ?? r.reason));
            }}
          >
            Send enquiry
          </Button>
          {result && result !== "ok" ? (
            <p role="alert" className="text-sm text-danger">
              Not sent: {result}
            </p>
          ) : null}
        </Card>
      )}
      <p className="mt-6 text-sm">
        <Link to="/" className="text-brand">
          ← OGC Learning
        </Link>
      </p>
    </main>
  );
}
