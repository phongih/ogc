/*
 * Admissions → "Refer to partner" (owner 22/11). Partners for this lead, ranked by FIT FOR THE
 * LEARNER (course taught, near the learner's center, how many learners stay). The commission is
 * shown for information only and never changes the order. Referring closes the lead at OGC.
 * Shared by the demo and the Platform: the caller passes a `ReferApi`.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PartnersResult } from "@ogc/contracts";
import { Button } from "../../ui";
import { Refused } from "./refused";
import type { ReferApi } from "./partnersApi";

export function ReferToPartner({
  leadId,
  learnerName,
  api,
}: {
  leadId: string;
  learnerName: string;
  api: ReferApi;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: [...api.key, "partner-fit", leadId],
    queryFn: () => api.suggest(leadId),
    enabled: open,
  });
  const act = useMutation({
    mutationFn: (partnerId: string): Promise<PartnersResult> => api.refer(leadId, partnerId),
    onSuccess: () => api.onChanged(qc),
  });
  if (!open)
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Refer to partner · {learnerName}
      </Button>
    );
  return (
    <div className="w-full rounded-ogc border border-border p-2 text-sm">
      <p className="mb-1 text-xs text-muted">
        Ranked by fit for {learnerName} — course, distance, how many learners stay. Commission is
        shown for information only. The partner gets a reference code, a short name and the course;
        the lead closes here as &quot;referred to partner&quot;.
      </p>
      <ul className="space-y-1" aria-label={`Partners for ${learnerName}`}>
        {(q.data ?? []).map((f) => (
          <li key={f.partnerId} className="flex flex-wrap items-center gap-2">
            <span className={f.fits ? "font-medium" : "text-muted"}>{f.partnerName}</span>
            <span className="text-xs text-muted">
              {f.reasons.join(" · ")}
              {f.commissionInfo ? ` · commission (info): ${f.commissionInfo}` : ""}
            </span>
            {f.fits ? (
              <Button variant="ghost" onClick={() => act.mutate(f.partnerId)}>
                Refer to {f.partnerName}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <button type="button" className="mt-1 text-xs text-muted" onClick={() => setOpen(false)}>
        Cancel
      </button>
      <Refused r={act.data} />
    </div>
  );
}
