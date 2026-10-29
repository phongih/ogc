import { describe, expect, it } from "vitest";
import { mockTutor, tutorReply } from "./mockTutor";

describe("deterministic mock tutor", () => {
  it("returns the same reply for the same input (no randomness, no external LLM)", () => {
    const a = tutorReply("How do I use the past tense?", null);
    const b = tutorReply("How do I use the past tense?", null);
    expect(a).toBe(b);
  });

  it("varies reply by input and appends lesson context", () => {
    const base = tutorReply("question one", null);
    const other = tutorReply("a completely different question two", null);
    expect(base).not.toBe(other);
    expect(tutorReply("x", "Everyday English A2")).toContain("Everyday English A2");
  });

  it("send appends a learner message and a deterministic tutor reply", async () => {
    const before = await mockTutor.getConversation("CONV-001");
    const added = await mockTutor.send("CONV-001", "Deterministic input");
    expect(added).toHaveLength(2);
    expect(added[0].role).toBe("learner");
    expect(added[1].role).toBe("tutor");
    expect(added[1].text).toBe(tutorReply("Deterministic input", before!.lessonContext!.title));
    const after = await mockTutor.getConversation("CONV-001");
    expect(after!.messages.length).toBe(before!.messages.length + 2);
  });

  it("send on an unknown conversation yields no messages (fail-closed)", async () => {
    expect(await mockTutor.send("nope", "hi")).toEqual([]);
  });
});
