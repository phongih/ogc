import type { EnrollmentPort, EnrollmentState } from "@ogc/contracts";
import { enrollmentStore } from "./store";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

export const mockEnrollment: EnrollmentPort = {
  getState: (personaId, courseId): Promise<EnrollmentState> =>
    latency(enrollmentStore.get(personaId, courseId)?.state ?? "not_enrolled"),
  listMyEnrollments: (personaId) => latency(enrollmentStore.list(personaId)),
  enroll: (personaId, courseId) => latency(enrollmentStore.enroll(personaId, courseId)),
};
