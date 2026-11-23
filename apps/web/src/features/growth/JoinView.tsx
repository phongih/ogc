/*
 * Public landing for a shared referral link (/join?ref=CODE&c=campaign). Records one click and
 * offers a SYNTHETIC enquiry form: a display name, a course and a center — no phone, e-mail or
 * other contact details (synthetic data only). Staff take it from there in Admissions. Shared by
 * the demo and the Platform through JoinApi.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Button, Card } from "../../ui";
import { useJoinApi, type JoinInfo } from "./growthApi";

type Info = JoinInfo;

export function JoinView() {
  const api = useJoinApi();
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
    void api.recordClick(code).then((i) => {
      setInfo(i);
      setCourse(i.courses[0]?.code ?? "");
      setCenter(i.centerNames[0] ?? "");
    });
  }, [api, code]);

  const field = "mt-1 block w-full rounded-ogc border border-border bg-surface p-2";
  return (
    <section aria-label="Join" className="mx-auto max-w-lg px-4 py-12">
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
          <p className="text-sm text-muted">{api.note}</p>
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
              const r = await api.submitLead(code, {
                learnerName: name,
                courseCode: course,
                centerName: center,
                campaignId,
              });
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
        <Link to={api.home.to} className="text-brand">
          ← {api.home.label}
        </Link>
      </p>
    </section>
  );
}
