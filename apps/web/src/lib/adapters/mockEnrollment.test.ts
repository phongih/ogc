import { as } from "../../test/grants";
import { describe, expect, it } from "vitest";
import { mockEnrollment } from "./mockEnrollment";
import { courses } from "../../fixtures/catalog";

const MINH = "demo-learner-2"; // starts with no enrollments

describe("mock enrollment", () => {
  it("enrolls a learner and reflects it in getState and listMyEnrollments", async () => {
    const courseId = courses[0].id;
    expect(await mockEnrollment.getState(as(MINH), courseId)).toBe("not_enrolled");

    const result = await mockEnrollment.enroll(as(MINH), courseId);
    expect(result.enrolled).toBe(true);

    expect(await mockEnrollment.getState(as(MINH), courseId)).toBe("enrolled");
    const list = await mockEnrollment.listMyEnrollments(as(MINH));
    expect(list.some((e) => e.courseId === courseId)).toBe(true);
  });

  // NEGATIVE: a duplicate enrollment is rejected (no duplicate records).
  it("prevents duplicate enrollment in the same course", async () => {
    const courseId = courses[1].id;
    const first = await mockEnrollment.enroll(as(MINH), courseId);
    expect(first.enrolled).toBe(true);

    const second = await mockEnrollment.enroll(as(MINH), courseId);
    expect(second.enrolled).toBe(false);
    expect(second.reason).toBe("already_enrolled");

    const list = await mockEnrollment.listMyEnrollments(as(MINH));
    expect(list.filter((e) => e.courseId === courseId)).toHaveLength(1);
  });

  // NEGATIVE: cannot enroll in a course outside the persona's organization.
  it("rejects enrollment in an unknown / out-of-org course", async () => {
    const result = await mockEnrollment.enroll(as(MINH), "00000000-0000-4000-8000-0000000000zz");
    expect(result.enrolled).toBe(false);
    expect(result.reason).toBe("course_not_in_org");
  });
});
