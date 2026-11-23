/*
 * Platform API client (ADR-040 §5: the `http` side; no mock, no fixture). Same origin: nginx
 * proxies `/v1/…` on app.ogc.eduos.vn to the API. Every call carries the grant and the
 * organization; every write carries a fresh Idempotency-Key. Domain refusals come back in the
 * contract's result shapes (ScheduleResult, RecordAttendanceResult) whatever the HTTP status.
 */
import type {
  AccessAdminView,
  AttendanceMark,
  PolicyInput,
  PolicyResult,
  PolicyRule,
  AttendanceSummaryRow,
  ClassSession,
  OperationsOverview,
  RecordAttendanceResult,
  ScheduleResult,
  SessionAttendance,
} from "@ogc/contracts";
import type { PlatformSession } from "./session";

const BASE = (import.meta.env.VITE_OGC_API_BASE as string | undefined) ?? "";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`api ${status}`);
  }
}

export interface Persona {
  principalId: string;
  orgId: string;
  orgName: string;
  displayName: string;
  role: string;
}

export interface MyClass {
  classId: string;
  className: string;
  centerName: string;
  learnerCount: number;
}

export interface MyAccess {
  role: string;
  orgAdmin: boolean;
  narrowing: { state: string; name?: string };
  allowed: string[];
}

async function send(
  s: PlatformSession | null,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (s) {
    headers.authorization = `Bearer ${s.grant}`;
    headers["x-ogc-org"] = s.orgId;
  }
  if (method !== "GET") headers["idempotency-key"] = crypto.randomUUID();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const parsed = await res.json().catch(() => null);
  return { status: res.status, body: parsed };
}

/** A read: anything but 200 is an error (401 sends the user back to sign in). */
async function read<T>(s: PlatformSession, path: string): Promise<T> {
  const r = await send(s, "GET", path);
  if (r.status !== 200) throw new ApiError(r.status, r.body);
  return r.body as T;
}

/** A write whose body is a contract result (`ok` true or false) for any 2xx–4xx answer. */
async function result<T extends { ok: boolean }>(
  s: PlatformSession,
  method: "POST" | "PUT",
  path: string,
  body: unknown,
): Promise<T> {
  const r = await send(s, method, path, body);
  const b = r.body as T | null;
  if (b && typeof b === "object" && "ok" in b) return b;
  throw new ApiError(r.status, r.body);
}

export const platformApi = {
  personas: async (): Promise<Persona[]> => {
    const r = await send(null, "GET", "/v1/dev/personas");
    if (r.status !== 200) throw new ApiError(r.status, r.body);
    return r.body as Persona[];
  },
  login: async (principalId: string, orgId: string) => {
    const r = await send(null, "POST", "/v1/dev/login", { principalId, orgId });
    if (r.status !== 200) throw new ApiError(r.status, r.body);
    return r.body as { grant: string; expiresAt: string; orgId: string };
  },
  myAccess: (s: PlatformSession) => read<MyAccess>(s, "/v1/me/access"),

  // Schedule (staff)
  schedule: (s: PlatformSession) => read<OperationsOverview>(s, "/v1/schedule"),
  reschedule: (s: PlatformSession, sessionId: string, at: string) =>
    result<ScheduleResult>(s, "POST", `/v1/sessions/${encodeURIComponent(sessionId)}/reschedule`, {
      at,
    }),
  cancel: (s: PlatformSession, sessionId: string, replacementAt: string) =>
    result<ScheduleResult>(s, "POST", `/v1/sessions/${encodeURIComponent(sessionId)}/cancel`, {
      replacementAt,
    }),
  addSession: (s: PlatformSession, classId: string, title: string, at: string) =>
    result<ScheduleResult>(s, "POST", `/v1/classes/${encodeURIComponent(classId)}/sessions`, {
      title,
      at,
    }),
  assignTeacher: (s: PlatformSession, classId: string, teacherId: string) =>
    result<ScheduleResult>(s, "PUT", `/v1/classes/${encodeURIComponent(classId)}/teacher`, {
      teacherId,
    }),
  setSubstitute: (s: PlatformSession, sessionId: string, teacherId: string | null) =>
    result<ScheduleResult>(s, "PUT", `/v1/sessions/${encodeURIComponent(sessionId)}/substitute`, {
      teacherId,
    }),

  // Access policies (Org Admin; IIOS stores and decides, the API relays — OGC-ADR-039 option C)
  accessAdmin: async (s: PlatformSession): Promise<AccessAdminView | null> => {
    const r = await send(s, "GET", "/v1/access/admin");
    if (r.status === 403) return null;
    if (r.status !== 200) throw new ApiError(r.status, r.body);
    return r.body as AccessAdminView;
  },
  createPolicy: (s: PlatformSession, input: PolicyInput) =>
    result<PolicyResult>(s, "POST", "/v1/access/policies", input),
  revisePolicy: (
    s: PlatformSession,
    ref: string,
    expectedVersion: number,
    patch: { description?: string | null; rules?: PolicyRule[] },
  ) =>
    result<PolicyResult>(s, "PUT", `/v1/access/policies/${encodeURIComponent(ref)}`, {
      expectedVersion,
      ...patch,
    }),
  retirePolicy: (s: PlatformSession, ref: string, expectedVersion: number) =>
    result<PolicyResult>(s, "POST", `/v1/access/policies/${encodeURIComponent(ref)}/retire`, {
      expectedVersion,
    }),
  attachPolicy: (s: PlatformSession, member: string, ref: string | null) =>
    result<PolicyResult>(s, "PUT", `/v1/access/members/${encodeURIComponent(member)}/policy`, {
      policyRef: ref,
    }),

  // Attendance (teachers)
  myClasses: (s: PlatformSession) => read<MyClass[]>(s, "/v1/me/classes"),
  toMark: (s: PlatformSession) => read<ClassSession[]>(s, "/v1/me/to-mark"),
  classSessions: (s: PlatformSession, classId: string) =>
    read<ClassSession[]>(s, `/v1/classes/${encodeURIComponent(classId)}/sessions`),
  classSummary: (s: PlatformSession, classId: string) =>
    read<AttendanceSummaryRow[]>(
      s,
      `/v1/classes/${encodeURIComponent(classId)}/attendance-summary`,
    ),
  sessionAttendance: (s: PlatformSession, sessionId: string) =>
    read<SessionAttendance>(s, `/v1/sessions/${encodeURIComponent(sessionId)}/attendance`),
  recordAttendance: (
    s: PlatformSession,
    sessionId: string,
    marks: { learnerId: string; mark: AttendanceMark }[],
  ) =>
    result<RecordAttendanceResult>(
      s,
      "PUT",
      `/v1/sessions/${encodeURIComponent(sessionId)}/attendance`,
      {
        marks,
      },
    ),
};
