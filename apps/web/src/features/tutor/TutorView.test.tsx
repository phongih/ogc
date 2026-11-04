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

  it("sends a suggested prompt and shows its deterministic reply", async () => {
    renderUI(<TutorView />, { role: "learner" });
    await waitFor(() => expect(screen.getByText(/Practising A2 plans/)).toBeInTheDocument());

    const prompt = "Explain this in simpler English.";
    await userEvent.click(await waitFor(() => screen.getByRole("button", { name: prompt })));

    const expected = tutorReply(prompt, "Everyday English A2");
    await waitFor(() => expect(screen.getByText(expected)).toBeInTheDocument());
  });

  it("starts a new conversation and lists it", async () => {
    renderUI(<TutorView />, { role: "learner" });
    await userEvent.click(await waitFor(() => screen.getByRole("button", { name: "+ New conversation" })));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^New conversation \d+$/ })).toBeInTheDocument(),
    );
  });

  it("renames a conversation in place (in-memory)", async () => {
    renderUI(<TutorView />, { role: "learner" });
    await waitFor(() => expect(screen.getByText("Practising A2 plans")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Rename Practising A2 plans" }));
    const input = screen.getByRole("textbox", { name: "Rename Practising A2 plans" });
    await userEvent.clear(input);
    await userEvent.type(input, "Weekend plans{Enter}");

    await waitFor(() => expect(screen.getByText("Weekend plans")).toBeInTheDocument());
    expect(screen.queryByText("Practising A2 plans")).not.toBeInTheDocument();
  });

  it("deletes a conversation from the list (in-memory)", async () => {
    renderUI(<TutorView />, { role: "learner" });
    await waitFor(() => expect(screen.getByText("B1 opinions warm-up")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: "Delete B1 opinions warm-up" }));
    await waitFor(() => expect(screen.queryByText("B1 opinions warm-up")).not.toBeInTheDocument());
  });
});
