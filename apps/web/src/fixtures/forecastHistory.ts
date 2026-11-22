/*
 * Business Forecast — SYNTHETIC two-year monthly history (owner 22/11). Not real data: generated
 * deterministically, ANCHORED to OGC's own fixtures so it is the same size as the demo center
 * (each center's enrolled learners today, its seeded weekly teaching hours, its courses' tuition).
 * A center with no learners today (e.g. a new center) has no history.
 * Months are calendar months at the center (Asia/Ho_Chi_Minh), oldest first.
 */
import type { ForecastMetric } from "@ogc/contracts";
import { courses } from "./catalog";
import { classes, rosters } from "./teaching";
import { seedSessions } from "./attendance";

export const HISTORY_MONTHS = 24;
/** Yearly growth the synthetic history was built with (before noise). */
export const SYNTHETIC_GROWTH = 0.15;

// Seasonal shapes by calendar month, January first.
const SEASON: Record<Exclude<ForecastMetric, "collected">, number[]> = {
  // Students dip over the summer and peak in Term 1.
  active: [1.05, 1.05, 1.0, 1.0, 0.95, 0.85, 0.8, 0.85, 1.1, 1.1, 1.1, 1.05],
  hours: [1.05, 1.05, 1.0, 1.0, 0.95, 0.85, 0.8, 0.85, 1.1, 1.1, 1.1, 1.05],
  // Enquiries before Term 2 (Dec–Jan) and before the school year (Jul–Aug).
  leads: [1.3, 0.8, 0.9, 0.8, 0.9, 1.1, 1.4, 1.5, 1.1, 0.8, 0.7, 1.2],
  enrolments: [1.2, 1.1, 0.9, 0.85, 0.8, 1.0, 1.2, 1.5, 1.4, 0.8, 0.7, 0.9],
};
// Share of a term's tuition collected in each month: most in the due month (Term 1 Sep, Term 2
// Dec, Term 3 Mar, Summer Jun), late payers the next two months.
const COLLECTED_SHARE = [0.2, 0.05, 0.75, 0.2, 0.05, 0.75, 0.2, 0.05, 0.75, 0.2, 0.05, 0.75];
const TUITION_PER_TERM: Record<string, number> = {
  "ENG-A2": 6_900_000,
  "ENG-B1": 8_400_000,
  "IELTS-B2": 12_000_000,
};

export const monthAdd = (ym: string, n: number): string => {
  const [y, m] = ym.split("-").map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};
export const calMonth = (ym: string) => Number(ym.slice(5, 7)) - 1; // 0 = January

/** Deterministic noise in [−amp, +amp] from a key. */
function noise(key: string, amp: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((((h >>> 0) % 10_000) / 10_000) * 2 - 1) * amp;
}

export interface CenterHistory {
  centerId: string;
  months: string[]; // HISTORY_MONTHS months ending the month before `currentMonth`
  series: Record<ForecastMetric, number[]>;
}

/** Synthetic history of one center for the 24 months before `currentMonth` (YYYY-MM). */
export function historyOf(
  centerId: string,
  currentMonth: string,
  now = Date.now(),
): CenterHistory | null {
  const own = classes.filter((c) => c.centerId === centerId);
  const learners = own.reduce((t, c) => t + (rosters[c.id]?.length ?? 0), 0);
  if (learners === 0) return null;
  // The seeded schedule's 90-minute sessions in the coming week at this center.
  const weeklyHours =
    seedSessions.filter(
      (s) =>
        own.some((c) => c.id === s.classId) &&
        Date.parse(s.at) >= now &&
        Date.parse(s.at) < now + 7 * 86_400_000,
    ).length * 1.5 || own.length * 3;
  const tuition =
    own.reduce((t, c) => {
      const code = courses.find((x) => x.id === c.courseId)?.code ?? "";
      return t + (TUITION_PER_TERM[code] ?? 7_500_000) * (rosters[c.id]?.length ?? 0);
    }, 0) / learners;
  const cur = calMonth(currentMonth);
  const months = Array.from({ length: HISTORY_MONTHS }, (_, i) =>
    monthAdd(currentMonth, i - HISTORY_MONTHS),
  );
  const series: Record<ForecastMetric, number[]> = {
    leads: [],
    enrolments: [],
    active: [],
    hours: [],
    collected: [],
  };
  months.forEach((ym, i) => {
    const c = calMonth(ym);
    const trend = (1 + SYNTHETIC_GROWTH) ** ((i - HISTORY_MONTHS) / 12);
    const k = `${centerId}:${ym}`;
    const active = Math.max(
      1,
      Math.round(
        learners * trend * (SEASON.active[c] / SEASON.active[cur]) * (1 + noise(`${k}:a`, 0.06)),
      ),
    );
    const base = (learners / SEASON.active[cur]) * trend;
    series.active.push(active);
    series.leads.push(Math.round(base * 1.2 * SEASON.leads[c] * (1 + noise(`${k}:l`, 0.15))));
    series.enrolments.push(
      Math.round(base * 0.4 * SEASON.enrolments[c] * (1 + noise(`${k}:e`, 0.2))),
    );
    series.hours.push(
      Math.round(
        weeklyHours *
          trend *
          (SEASON.hours[c] / SEASON.hours[cur]) *
          (1 + noise(`${k}:h`, 0.05)) *
          10,
      ) / 10,
    );
    series.collected.push(
      Math.round((active * tuition * COLLECTED_SHARE[c] * (1 + noise(`${k}:c`, 0.05))) / 100_000) *
        100_000,
    );
  });
  return { centerId, months, series };
}
