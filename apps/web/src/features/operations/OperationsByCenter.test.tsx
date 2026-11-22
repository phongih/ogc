// Center operations grouped by center; long schedules collapsed; build id in the footer.
import { as } from "../../test/grants";
import { beforeEach, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emptyCenterDraft } from "@ogc/contracts";
import { renderApp } from "../../test/harness";
import { __resetAttendanceForTests } from "../../lib/adapters/mockAttendance";
import { mockCenterSetup } from "../../lib/adapters/mockCenterSetup";
import { brands } from "../../fixtures/directory";
import { courses } from "../../fixtures/catalog";
import { TEACHER_TARA } from "../../fixtures/personas";

beforeEach(() => __resetAttendanceForTests());

describe("Center operations by center", () => {
  it("groups classes under their center and collapses a long schedule", async () => {
    await mockCenterSetup.createCenter(as("demo-staff"), {
      ...emptyCenterDraft(),
      brandId: brands[0].id,
      name: "London School",
      code: "LD01",
      courseIds: [courses[0].id],
      rooms: [{ name: "A101", capacity: 12 }],
      classes: [
        {
          name: "English A2",
          courseId: courses[0].id,
          room: "A101",
          weekdays: [1, 3, 5],
          time: "18:00",
          durationMin: 90,
          teacherId: TEACHER_TARA,
        },
      ],
    });
    const user = userEvent.setup();
    renderApp("/app/operations", "staff");
    const london = await screen.findByRole("region", { name: "London School" });
    expect(
      within(london).getByRole("heading", { name: /London School · 1 class/ }),
    ).toBeInTheDocument();
    const d1 = screen.getByRole("region", { name: "Nova English — District 1" });
    expect(within(d1).getByRole("region", { name: "A2 Morning — Mon/Wed" })).toBeInTheDocument();
    expect(within(d1).queryByRole("region", { name: "English A2 — Mon/Wed/Fri" })).toBeNull();

    const sessions = within(london).getByRole("list", {
      name: "Sessions of English A2 — Mon/Wed/Fri",
    });
    expect(within(sessions).getAllByRole("listitem")).toHaveLength(3); // of 12
    await user.click(
      within(london).getByRole("button", {
        name: "Show all 12 upcoming · English A2 — Mon/Wed/Fri",
      }),
    );
    expect(within(sessions).getAllByRole("listitem")).toHaveLength(12);
  });

  it("shows the build id in the footer", async () => {
    renderApp("/app/operations", "staff");
    expect(await screen.findByTestId("build-id")).toHaveTextContent(
      /^OGC · build \S+ · synthetic demo$/,
    );
  });
});
