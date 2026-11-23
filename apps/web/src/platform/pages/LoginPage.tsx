// Dev sign-in (staging): pick a synthetic persona; the API asks the mock IIOS for a grant.
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Button, Card, ErrorState, PageHeader, Spinner } from "../../ui";
import { platformApi, type Persona } from "../client";
import { homeFor, useSession } from "../App";

export function LoginPage() {
  const { setSession } = useSession();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["personas"], queryFn: platformApi.personas });
  const login = useMutation({
    mutationFn: async (p: Persona) => ({ p, g: await platformApi.login(p.principalId, p.orgId) }),
    onSuccess: ({ p, g }) => {
      setSession({
        grant: g.grant,
        expiresAt: g.expiresAt,
        orgId: g.orgId,
        orgName: p.orgName,
        principalId: p.principalId,
        displayName: p.displayName,
        role: p.role === "admin" ? "staff" : p.role,
        orgAdmin: p.role === "admin",
      });
      nav(homeFor(p.role === "admin" ? "staff" : p.role));
    },
  });
  if (q.isLoading) return <Spinner label="Loading personas" />;
  if (q.isError)
    return <ErrorState message="Could not reach the Platform API." onRetry={() => q.refetch()} />;
  const byOrg = new Map<string, Persona[]>();
  for (const p of q.data ?? []) byOrg.set(p.orgName, [...(byOrg.get(p.orgName) ?? []), p]);
  return (
    <section>
      <PageHeader
        title="Sign in (staging)"
        subtitle="Synthetic personas from the mock IIOS. The grant is issued by IIOS, not by this page."
      />
      {[...byOrg].map(([org, people]) => (
        <Card key={org} className="mb-4">
          <h2 className="mb-2 font-medium">{org}</h2>
          <ul className="flex flex-wrap gap-2">
            {people.map((p) => (
              <li key={p.principalId}>
                <Button variant="ghost" disabled={login.isPending} onClick={() => login.mutate(p)}>
                  {p.displayName}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {login.isError ? (
        <p role="alert" className="text-sm text-danger">
          Sign-in refused.
        </p>
      ) : null}
    </section>
  );
}
