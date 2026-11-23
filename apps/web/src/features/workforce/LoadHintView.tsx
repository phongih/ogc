/*
 * "Who has room?" — load suggestions next to a teacher choice (owner 22/11: suggest only, people
 * decide; going over target only warns). Collapsed by default; lists candidates with load
 * before → after and any clash. Never assigns.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { LoadCandidate } from "@ogc/contracts";
import { useWorkforceApi, type LoadTarget } from "./workforceApi";

type Target = LoadTarget;

export const pctText = (p: number | null) => (p === null ? "—" : `${p}%`);

export function LoadHintView({ target, label }: { target: Target; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-xs">
      <button
        type="button"
        className="text-brand underline"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "Hide" : "Who has room?"} · {label}
      </button>
      {open ? <Candidates target={target} label={label} /> : null}
    </div>
  );
}

function Candidates({ target, label }: { target: Target; label: string }) {
  const api = useWorkforceApi();
  const q = useQuery({
    queryKey: [...api.key, "workforce-suggest", target],
    queryFn: () => api.suggest(target),
  });
  if (!q.data) return <p className="text-muted">Checking teachers’ load…</p>;
  return (
    <ul className="mt-1 space-y-0.5" aria-label={`Load suggestions for ${label}`}>
      {q.data.map((c: LoadCandidate) => (
        <li
          key={c.teacherId}
          className={c.clashes.length || c.after.band === "over" ? "text-danger" : ""}
        >
          <span className="font-medium">{c.name}</span> {c.before.hours} → {c.after.hours} h this
          week ({pctText(c.after.pct)}) · {c.note}
          {c.clashes.length ? `: ${c.clashes[0]}` : ""}
        </li>
      ))}
      <li className="text-muted">Suggestions only — choose the teacher yourself.</li>
    </ul>
  );
}
