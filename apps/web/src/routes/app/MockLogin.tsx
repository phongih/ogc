import { useNavigate } from "react-router-dom";
import { useSession } from "../../app/session";
import { Button, Card, PageHeader } from "../../ui";
import type { MockPersona } from "@ogc/mock-authz";
import { IIOS_SCENARIOS, useIiosScenario, type IiosScenario } from "../../app/iiosGate";

// Synthetic demo personas. No passwords, no real identities (NON-PRODUCTION).
const ORG = "00000000-0000-4000-8000-000000000001";
const personas: MockPersona[] = [
  { personaId: "demo-staff", displayName: "Sam (Org Staff)", role: "staff", orgId: ORG },
  { personaId: "demo-teacher", displayName: "Tara (Teacher)", role: "teacher", orgId: ORG },
  { personaId: "demo-teacher-2", displayName: "Ben (Teacher)", role: "teacher", orgId: ORG },
  { personaId: "demo-learner", displayName: "Linh (Learner)", role: "learner", orgId: ORG },
  { personaId: "demo-guardian", displayName: "Mai (Guardian)", role: "guardian", orgId: ORG },
];

export function MockLogin() {
  const { signIn } = useSession();
  const { scenario, setScenario } = useIiosScenario();
  const navigate = useNavigate();
  return (
    <main id="main" className="mx-auto max-w-md px-4 py-16">
      <PageHeader title="Choose a demo persona" subtitle="Mock sign-in — no credentials, synthetic data only." />
      <Card>
        <ul className="space-y-2">
          {personas.map((p) => (
            <li key={p.personaId}>
              <Button
                variant="ghost"
                className="w-full justify-between"
                onClick={() => {
                  signIn(p);
                  navigate("/app");
                }}
              >
                <span>{p.displayName}</span>
                <span className="text-xs text-muted">{p.role}</span>
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <details className="mt-4 text-sm">
        <summary className="cursor-pointer text-muted">Simulate the IIOS access decision</summary>
        <label className="mt-2 block">
          <span className="text-xs text-muted">Decision IIOS returns for this session (synthetic)</span>
          <select
            className="mt-1 block w-full rounded-ogc border border-border bg-surface px-2 py-1.5"
            value={scenario}
            onChange={(e) => setScenario(e.target.value as IiosScenario)}
          >
            {IIOS_SCENARIOS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </details>
      <p className="mt-4 text-xs text-muted">
        This mock sign-in performs no authentication and is not a security boundary.
      </p>
    </main>
  );
}
