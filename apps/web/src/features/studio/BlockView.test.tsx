// Reading blocks in a lesson (owner 24/11): a vocabulary deck flips card by card, book pages are read
// one at a time; the editor's preview (no interaction) shows everything at once. SYNTHETIC.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import type { CourseBlock } from "@ogc/contracts";
import { BlockView } from "./BlockView";

const DECK: CourseBlock = {
  id: "v",
  kind: "vocab",
  title: "Little Eagle",
  cards: [
    { word: "Eagle", meaning: "a large bird", example: "", translation: "đại bàng", imageUrl: "" },
    { word: "Nest", meaning: "a bird's home", example: "", translation: "tổ", imageUrl: "" },
  ],
};
const BOOK: CourseBlock = {
  id: "b",
  kind: "book_page",
  title: "A tiny seed",
  pages: [
    { heading: "One", body: "A seed is small." },
    { heading: "Two", body: "It grows." },
  ],
};

describe("reading blocks", () => {
  it("in a lesson, each card shows its word until the learner flips it", async () => {
    const user = userEvent.setup();
    render(<BlockView b={DECK} io={{}} />);
    expect(screen.queryByText("a large bird")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Flip Eagle" }));
    expect(screen.getByText("a large bird")).toBeVisible();
    expect(screen.queryByText("a bird's home")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Hide Eagle" }));
    expect(screen.queryByText("a large bird")).toBeNull();
  });

  it("in a lesson, the book is read one page at a time", async () => {
    const user = userEvent.setup();
    render(<BlockView b={BOOK} io={{}} />);
    expect(screen.getByText("A seed is small.")).toBeVisible();
    expect(screen.queryByText("It grows.")).toBeNull();
    expect(screen.getByTestId("page-b")).toHaveTextContent("Page 1 of 2");
    await user.click(screen.getByRole("button", { name: "Next page →" }));
    expect(screen.getByText("It grows.")).toBeVisible();
    expect(screen.queryByText("A seed is small.")).toBeNull();
    expect(screen.getByRole("button", { name: "Next page →" })).toBeDisabled();
  });

  it("the editor's preview shows every card side and every page", () => {
    render(
      <>
        <BlockView b={DECK} />
        <BlockView b={BOOK} />
      </>,
    );
    expect(screen.getByText("a large bird")).toBeVisible();
    expect(screen.getByText("a bird's home")).toBeVisible();
    expect(screen.queryByRole("button", { name: /Flip/ })).toBeNull();
    expect(screen.getByText("It grows.")).toBeVisible();
  });
});

const MISSION: CourseBlock = {
  id: "m",
  kind: "mission_box",
  title: "Seed & Stem Explorer",
  task: "Find 1 leaf and 1 seed around your house.",
  whyItMatters: "Plants use seeds to grow new life.",
};

describe("Mission Box", () => {
  it("the editor preview explains the review; no checkbox", () => {
    render(<BlockView b={MISSION} />);
    expect(screen.getByText("🧭 Seed & Stem Explorer")).toBeVisible();
    expect(screen.getByText("Why it matters: Plants use seeds to grow new life.")).toBeVisible();
    expect(screen.getByText(/never a skill score/)).toBeVisible();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("the learner ticks it and may add a note", async () => {
    const user = userEvent.setup();
    let last = { done: false, note: "" };
    function Host() {
      const [m, setM] = useState(last);
      return (
        <BlockView
          b={MISSION}
          io={{
            mission: m,
            onMission: (x) => {
              last = x;
              setM(x);
            },
          }}
        />
      );
    }
    render(<Host />);
    await user.click(
      screen.getByRole("checkbox", { name: "I did this mission: Seed & Stem Explorer" }),
    );
    await user.type(screen.getByRole("textbox", { name: /What did you notice/ }), "A brown seed");
    expect(last).toEqual({ done: true, note: "A brown seed" });
  });

  it("after completion: what was confirmed and the teacher's review", () => {
    render(
      <BlockView
        b={MISSION}
        io={{
          mission: { done: true, note: "A brown seed" },
          missionAttempt: {
            blockId: "m",
            attempt: 2,
            note: "A brown seed",
            status: "returned",
            submittedAt: "2026-11-24T05:00:00Z",
            reviewedAt: "2026-11-24T06:00:00Z",
            reviewerName: "Tara",
            reviewNote: "Tell me its colour.",
          },
        }}
      />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("✓ You did this mission · “A brown seed”")).toBeVisible();
    expect(screen.getByTestId("mission-status-m")).toHaveTextContent(
      "Returned by your teacher — send it again · try 2 · “Tell me its colour.”",
    );
  });
});
