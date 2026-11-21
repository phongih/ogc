// P1 · Speaking studio (MOCK) — learner rehearsal UI + teacher review queue. SYNTHETIC.
import { describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp, renderUI } from "../../../test/harness";
import { TodaysMission } from "../../learner/TodaysMission";
import { courses } from "../../../fixtures/catalog";
import { learningStore } from "../../../lib/adapters/store";
import { LEARNER_LINH } from "../../../fixtures/personas";

const A = "ACT-A2-4";
const NATURAL = [
  "It was great, thanks! I went to the beach.",
  "I went with my cousin and her friends.",
  "We swam in the morning and had seafood for lunch.",
  "Definitely — maybe next month.",
];

describe("Speaking studio — learner", () => {
  it("is locked until the prerequisite quiz is done, and says which one", async () => {
    renderApp(`/app/learning/speaking/${A}`, "learner");
    expect(await screen.findByTestId("locked-notice")).toHaveTextContent(
      "Finish “Quiz: At the market” first",
    );
    expect(screen.queryByRole("button", { name: "Start rehearsal" })).toBeNull();
    learningStore.complete("demo-learner", "ACT-A2-3"); // satisfy it for the rest of this file
  });

  it("rehearses turn by turn, then shows coaching and a pending teacher review", async () => {
    const user = userEvent.setup();
    renderApp(`/app/learning/speaking/${A}`, "learner");
    expect(await screen.findByTestId("speaking-disclosure")).toHaveTextContent(
      /no microphone, no recording, no AI/,
    );
    await user.click(screen.getByRole("button", { name: "Start rehearsal" }));

    for (let i = 0; i < NATURAL.length; i++) {
      expect(screen.getByText(`Turn ${i + 1} of 4`)).toBeInTheDocument();
      const next = screen.getByRole("button", {
        name: i === 3 ? "I said it — finish" : "I said it — next",
      });
      expect(next).toBeDisabled(); // must pick a reply first
      await user.click(screen.getByLabelText(NATURAL[i]));
      await user.click(next);
    }

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Waiting for your teacher's review");
    expect(screen.getByText(/replies were the most natural choice/)).toHaveTextContent("4 of 4");
    const tips = screen.getByRole("list", { name: "Pronunciation tips for turn 1" });
    expect(within(tips).getByText("/ˌwiːkˈend/")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rehearse again" })).toBeInTheDocument();
    // nothing counted yet
    expect(learningStore.getAttempt(LEARNER_LINH, A)).toBeNull();
  });

  it("a speaking mission shows the pending review and reopens the studio", async () => {
    // same module store: the rehearsal above is pending
    renderUI(
      <TodaysMission
        action={{
          source: "teacher",
          activityId: A,
          courseId: courses[0].id,
          skill: "speaking",
          masteryLevel: 55,
          confidenceBand: "low",
          friendlyReason: "Practise talking about your weekend.",
          teacherNote: null,
        }}
      />,
      { role: "learner" },
    );
    expect(await screen.findByTestId("mission-speaking-status")).toHaveTextContent(
      "Waiting for your teacher's review",
    );
    expect(screen.getByRole("link", { name: "Open speaking studio" })).toHaveAttribute(
      "href",
      `/app/learning/speaking/${A}`,
    );
  });
});

describe("Speaking studio — teacher review queue", () => {
  it("the owning teacher sees the rehearsal, a note is required to return it, approve closes it", async () => {
    const user = userEvent.setup();
    renderApp("/app/teaching", "teacher");
    expect(
      await screen.findByRole("heading", { name: "Speaking to review (1)" }),
    ).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Speaking to review" });
    expect(
      within(list).getByText(/Linh N\. · Speaking: Describe your weekend/),
    ).toBeInTheDocument();
    expect(within(list).getByText("4 of 4 natural replies")).toBeInTheDocument();

    await user.click(within(list).getByRole("button", { name: "Ask to try again" }));
    expect(within(list).getByRole("button", { name: "Send back with note" })).toBeDisabled();
    await user.click(within(list).getByRole("button", { name: "Cancel" }));

    await user.click(within(list).getByRole("button", { name: "Approve for Linh N." }));
    await waitFor(() => expect(screen.getByText("Nothing to review")).toBeInTheDocument());
    expect(learningStore.getAttempt(LEARNER_LINH, A)).toMatchObject({
      state: "completed",
      score: 100,
    });
  });

  it("a learner persona has no teacher queue (Teaching is not in its workspace)", async () => {
    renderApp("/app/teaching", "learner");
    expect(await screen.findByText("Not available for this persona")).toBeInTheDocument();
  });

  it("after approval the learner sees 'Approved' and can no longer rehearse", async () => {
    renderApp(`/app/learning/speaking/${A}`, "learner");
    expect(await screen.findByText("Approved by your teacher")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rehearse again" })).toBeNull();
  });
});
