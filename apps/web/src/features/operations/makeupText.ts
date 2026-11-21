// Shared wording for a make-up item, so staff, teacher, learner and guardian read the same thing.
import type { MakeupItem } from "@ogc/contracts";
import { formatCenterDateTime } from "../../lib/centerTime";

export const MAKEUP_STATUS: Record<MakeupItem["status"], string> = {
  open: "Needs a make-up",
  booked: "Booked",
  to_confirm: "Waiting for teacher",
  done: "Made up",
};

/** "joins A2 Evening — Tue/Thu · Tue, 24/11/2026, 18:00 · Ben" / "self-study · Tara confirms". */
export function bookingText(item: MakeupItem): string | null {
  const b = item.booking;
  if (!b) return null;
  if (b.kind === "selfstudy") {
    const s = b.selfStudy;
    const who = b.teacherName ?? "the class teacher";
    if (s?.confirmedAt) return `self-study · confirmed by ${who}`;
    if (s?.submittedAt) return `self-study · submitted, waiting for ${who}`;
    if (s?.returnedNote) return `self-study · returned by ${who}: “${s.returnedNote}”`;
    return `self-study · ${who} confirms`;
  }
  const where = b.kind === "join" ? `joins ${b.className}` : "make-up session";
  return [where, b.at ? formatCenterDateTime(b.at) : null, b.teacherName]
    .filter(Boolean)
    .join(" · ");
}
