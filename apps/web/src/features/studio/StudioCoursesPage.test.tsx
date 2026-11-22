// Course Studio UI (owner 22/11): OGC writes its own courses; the class teacher proposes a
// published course for their class, staff link it; completion per learner (with their version);
// a course opens in the editor. SYNTHETIC.
import { beforeEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { __resetStudioLinksForTests } from "../../lib/adapters/mockStudioLinks";
import { __resetCourseAuthoringForTests } from "../../lib/adapters/mockCourseAuthoring";
import { __resetCourseProgressForTests } from "../../lib/adapters/courseProgress";
import { __resetAttendanceForTests } from "../../lib/adapters/mockAttendance";

beforeEach(() => {
  __resetAttendanceForTests();
  __resetCourseAuthoringForTests();
  __resetCourseProgressForTests();
  __resetStudioLinksForTests();
  window.localStorage.clear();
});

describe("Course Studio page", () => {
  it("staff: see the course list and what waits for review; link Tara's proposal; completion with versions", async () => {
    const user = userEvent.setup();
    renderApp("/app/operations/courses", "staff");
    const list = await screen.findByRole("table", { name: "Course list" });
    expect(within(list).getAllByRole("row")).toHaveLength(5); // header + 4 courses of the org
    expect(await screen.findByTestId("to-review")).toHaveTextContent("A2 Pronunciation Lab");
    const b1 = await screen.findByRole("region", { name: "Class B1 Evening — Tue/Thu" });
    await user.click(within(b1).getByRole("button", { name: "Link · CS-B1-SPEAK" }));
    expect(await within(b1).findByTestId("linked-B1 Evening — Tue/Thu")).toHaveTextContent(
      /B1 Speaking Confidence.*proposed by Tara/,
    );
    const a2 = screen.getByRole("region", { name: "Class A2 Morning — Mon/Wed" });
    expect(within(a2).getByRole("link", { name: "Open CS-A2-EVERYDAY" })).toHaveAttribute(
      "href",
      "/app/operations/courses/CS-A2-EVERYDAY",
    );
    await user.click(within(a2).getByRole("button", { name: /Show completion/ }));
    const t = await within(a2).findByRole("table", { name: /Completion/ });
    expect(within(t).getAllByRole("row")).toHaveLength(4); // header + 3 learners
    expect(within(t).getByRole("row", { name: /An P\./ })).toHaveTextContent(/v1.*1 of 2/);
  });

  it("teacher: proposes a published course for their own class; another teacher's draft is not listed", async () => {
    const user = userEvent.setup();
    renderApp("/app/teaching/courses", "teacher");
    const b1 = await screen.findByRole("region", { name: "Class B1 Evening — Tue/Thu" });
    expect(within(b1).queryByRole("button", { name: /^Link/ })).toBeNull();
    await user.click(within(b1).getByRole("button", { name: /Propose a course/ }));
    const results = await within(b1).findByRole("list", { name: /Course results/ });
    await within(results).findByText("IELTS Writing Task 1 — Charts");
    expect(within(results).queryByText("A2 Pronunciation Lab")).toBeNull(); // Ben's, unpublished
    await user.click(within(results).getByRole("button", { name: "Propose CS-IELTS-W1" }));
    expect(await within(b1).findByTestId("proposal-CS-IELTS-W1")).toHaveTextContent(
      /waiting for center staff/,
    );
  });
});
