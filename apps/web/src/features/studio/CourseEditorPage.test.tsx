// Course Studio editor + My Learning player UI (owner 22/11). Tara adds a block and submits; Olivia
// approves (v2); Linh takes a lesson of her class course and her quiz score is recorded.
// SYNTHETIC.
import { beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "../../test/harness";
import { as } from "../../test/grants";
import { __resetStudioLinksForTests } from "../../lib/adapters/mockStudioLinks";
import {
  __resetCourseAuthoringForTests,
  mockCourseAuthoring as A,
} from "../../lib/adapters/mockCourseAuthoring";
import { __resetCourseProgressForTests } from "../../lib/adapters/courseProgress";

beforeEach(() => {
  __resetCourseAuthoringForTests();
  __resetCourseProgressForTests();
  __resetStudioLinksForTests();
  window.localStorage.clear();
});

describe("Course Studio editor", () => {
  it("teacher: adds a vocabulary card, saves the draft, submits for review", async () => {
    const user = userEvent.setup();
    renderApp("/app/teaching/courses/CS-B1-SPEAK", "teacher");
    expect(await screen.findByTestId("course-status")).toHaveTextContent(
      "Published · unpublished changes",
    );
    const editor = screen.getByRole("region", { name: "Editor" });
    await user.click(within(editor).getByRole("button", { name: /3\. Short debates/ }));
    await user.selectOptions(within(editor).getByLabelText("Block type"), "vocab");
    await user.click(within(editor).getByRole("button", { name: "Add block" }));
    await user.type(within(editor).getByLabelText("Word · block 2"), "to rebut");
    await user.type(within(editor).getByLabelText("Meaning · block 2"), "to argue against");
    expect(within(editor).getByTestId("draft-state")).toHaveTextContent("Unsaved changes");
    await user.click(within(editor).getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(screen.getByTestId("draft-state")).toHaveTextContent("Saved · revision 5"),
    );
    await user.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByText("In review", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Editor" })).toBeNull();
    expect(screen.getByRole("button", { name: "Withdraw from review" })).toBeInTheDocument();
  });

  it("teacher: adds a speaking rehearsal — coach line, replies, the natural one, a model line — and submits", async () => {
    const user = userEvent.setup();
    renderApp("/app/teaching/courses/CS-B1-SPEAK", "teacher");
    const editor = await screen.findByRole("region", { name: "Editor" });
    await user.click(within(editor).getByRole("button", { name: /3\. Short debates/ }));
    await user.selectOptions(within(editor).getByLabelText("Block type"), "speaking");
    await user.click(within(editor).getByRole("button", { name: "Add block" }));
    const f = (label: string) => within(editor).getByLabelText(`${label} · block 2`);
    await user.type(f("Scenario"), "Disagree politely");
    await user.type(f("Coach line 1"), "I think homework is useless.");
    await user.type(f("Reply 1 of turn 1"), "You are wrong.");
    await user.type(f("Reply 2 of turn 1"), "I see your point, but it helps me practise.");
    expect(within(editor).getByTestId("draft-state")).not.toHaveTextContent(/error|must/i);
    await user.click(f("Natural reply 2 of turn 1"));
    await user.type(f("Model line 1"), "I see your point, but it helps me practise.");
    await user.click(within(editor).getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(screen.getByTestId("draft-state")).toHaveTextContent("Saved · revision 5"),
    );
    const c = (await A.get(as("demo-teacher"), "CS-B1-SPEAK"))!;
    expect(c.draft.lessons[2].blocks[1]).toMatchObject({
      kind: "speaking",
      scenario: "Disagree politely",
      turns: [
        { natural: 1, options: ["You are wrong.", "I see your point, but it helps me practise."] },
      ],
    });
    await user.click(screen.getByRole("button", { name: "Submit for review" }));
    expect(await screen.findByText("In review", { selector: "span" })).toBeInTheDocument();
  });

  it("an invalid video link cannot be saved", async () => {
    const user = userEvent.setup();
    renderApp("/app/teaching/courses/CS-B1-SPEAK", "teacher");
    const editor = await screen.findByRole("region", { name: "Editor" });
    await user.selectOptions(within(editor).getByLabelText("Block type"), "video");
    await user.click(within(editor).getByRole("button", { name: "Add block" }));
    await user.type(
      within(editor).getByLabelText("Video link (YouTube or Vimeo) · block 4"),
      "https://evil.example/v",
    );
    expect(within(editor).getByTestId("draft-state")).toHaveTextContent(/only youtube/);
    expect(within(editor).getByRole("button", { name: "Save draft" })).toBeDisabled();
  });

  it("Org Admin approves Tara's submission; the history shows v2", async () => {
    const c = (await A.get(as("demo-teacher"), "CS-B1-SPEAK"))!;
    await A.saveDraft(
      as("demo-teacher"),
      "CS-B1-SPEAK",
      { ...c.draft, summary: "v2" },
      c.draftRevision,
    );
    await A.submit(as("demo-teacher"), "CS-B1-SPEAK");
    const user = userEvent.setup();
    renderApp("/app/operations/courses/CS-B1-SPEAK", "admin");
    const review = await screen.findByRole("region", { name: "Review" });
    await user.type(within(review).getByLabelText("Review note"), "Clear and short");
    await user.click(within(review).getByRole("button", { name: "Approve and publish v2" }));
    await waitFor(() =>
      expect(screen.getByTestId("course-status")).toHaveTextContent(/^Published · learners get v2/),
    );
    const history = screen.getByRole("region", { name: "History" });
    expect(
      within(history).getByText(/approved by Olivia \(Org Admin\) — “Clear and short”/),
    ).toBeInTheDocument();
    await user.click(within(history).getByRole("button", { name: "View v1" }));
    expect(within(history).getByLabelText("Version 1")).toHaveTextContent("Giving opinions");
  });
});

describe("My Learning — class course", () => {
  it("Linh opens a lesson, answers, completes it; the score shows", async () => {
    const user = userEvent.setup();
    renderApp("/app/learning", "learner");
    const sec = await screen.findByRole("region", { name: "Class courses" });
    expect(sec).toHaveTextContent(/A2 Everyday English.*version 2/);
    await user.click(within(sec).getByRole("link", { name: "1. At the market" }));
    await user.click(await screen.findByRole("radio", { name: "Can I have some rice, please?" }));
    await user.click(screen.getByRole("button", { name: "Complete lesson" }));
    expect(await screen.findByTestId("lesson-done")).toHaveTextContent("quiz 100%");
    expect(screen.getByRole("link", { name: "Next lesson →" })).toBeInTheDocument();
  });

  it("a lesson with an unanswered quiz is refused with a reason", async () => {
    const user = userEvent.setup();
    renderApp("/app/learning/class-courses/CS-A2-EVERYDAY/a2-l1", "learner");
    await user.click(await screen.findByRole("button", { name: "Complete lesson" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("answer every question");
  });
});
