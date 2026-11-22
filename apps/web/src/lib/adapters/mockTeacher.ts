import { viaGrant } from "./viewer";
import type { TeacherPort, TeacherDashboard, LearnerRow, Session } from "@ogc/contracts";
import { personaMap, teacherName } from "../../fixtures/personas";
import { classes, classTeachers, learnerCountOf, rosters } from "../../fixtures/teaching";
import { sessionStore } from "./sessionStore";

const latency = <T>(v: T, ms = 100): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

/*
 * Teacher dashboard. P2: classes are the ones this teacher OWNS (live assignment, set by center
 * staff); upcoming sessions come from the live schedule — the teacher's own classes (noting a
 * substitute when one covers a session) plus sessions this teacher substitutes for.
 */
export const mockTeacher: TeacherPort = viaGrant<TeacherPort>({
  getDashboard: (personaId) => {
    const p = personaMap[personaId];
    if (!p || !p.teacherId) return latency(null); // fail-closed: no teacher scope for this persona
    const me = p.teacherId;
    const now = Date.now();
    const future = sessionStore
      .all()
      .filter((s) => s.state === "scheduled" && Date.parse(s.at) > now);
    const owned = classes.filter((c) => c.orgId === p.orgId && classTeachers[c.id] === me);
    const upcoming: Session[] = future
      .filter((s) => owned.some((c) => c.id === s.classId) || s.substituteId === me)
      .map((s) => ({
        id: s.id,
        classId: s.classId,
        title: s.title,
        at: s.at,
        ...(s.kind === "makeup" ? { makeup: true } : {}),
        ...(s.substituteId === me
          ? { asSubstitute: true }
          : s.substituteId
            ? { coveredBy: teacherName(s.substituteId) ?? "a substitute" }
            : {}),
      }));
    const dashboard: TeacherDashboard = {
      teacherId: me,
      teacherName: teacherName(me) ?? "Teacher",
      orgId: p.orgId,
      classes: owned.map((c) => ({
        ...c,
        learnerCount: learnerCountOf(c.id), // from the roster, not the seed placeholder
        // The class's own next lesson — a make-up session is not the class's next session.
        nextSessionAt: future.find((s) => s.classId === c.id && s.kind === "regular")?.at ?? null,
      })),
      upcoming,
    };
    return latency(dashboard);
  },
  getClassRoster: (classId): Promise<LearnerRow[]> => latency(rosters[classId] ?? []),
});
