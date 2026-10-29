import { describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TutorView } from "./TutorView";
import { renderUI } from "../../test/harness";
import { tutorReply } from "../../lib/adapters/mockTutor";

describe("TutorView", () => {
  it("loads a conversation and shows a deterministic tutor reply after sending", async () => {
    renderUI(<TutorView />, { role: "learner" });
    await waitFor(() => expect(screen.getByText(/Practising A2 plans/)).toBeInTheDocument());
    const input = await waitFor(() => screen.getByLabelText("Message the tutor"));
    await userEvent.type(input, "How do I order food?");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    const expected = tutorReply("How do I order food?", "Everyday English A2");
    await waitFor(() => expect(screen.getByText(expected)).toBeInTheDocument());
  });
});
