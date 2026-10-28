import { useNavigate } from "react-router-dom";
import { useSession } from "../../app/session";
import { Button, Card, PageHeader } from "../../ui";
import type { MockPersona } from "@ogc/mock-authz";

// Synthetic demo personas. No passwords, no real identities (NON-PRODUCTION).
const personas: MockPersona[] = [
  { personaId: "demo-staff", displayName: "Sam (Org Staff)", role: "staff", orgId: "00000000-0000-4000-8000-000000000001" },
  { personaId: "demo-teacher", displayName: "Tara (Teacher)", role: "teacher", orgId: "00000000-0000-4000-8000-000000000001" },
  { personaId: "demo-learner", displayName: "Linh (Learner)", role: "learner", orgId: "00000000-0000-4000-8000-000000000001" },
];

export function MockLogin() {
  const { signIn } = useSession();
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
                  navigate("/app/orgs");
                }}
              >
                <span>{p.displayName}</span>
                <span className="text-xs text-muted">{p.role}</span>
              </Button>
            </li>
          ))}
        </ul>
      </Card>
      <p className="mt-4 text-xs text-muted">
        This mock sign-in performs no authentication and is not a security boundary.
      </p>
    </main>
  );
}
