import { as } from "../../test/grants";
import { describe, expect, it } from "vitest";
import { mockTutor, tutorReply } from "./mockTutor";

const LINH = "demo-learner"; // seeded with CONV-001 / CONV-002
const MINH = "demo-learner-2"; // starts with no conversations

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
    const before = await mockTutor.getConversation(as(LINH), "CONV-001");
    const added = await mockTutor.send(as(LINH), "CONV-001", "Deterministic input");
    expect(added).toHaveLength(2);
    expect(added[0].role).toBe("learner");
    expect(added[1].role).toBe("tutor");
    expect(added[1].text).toBe(tutorReply("Deterministic input", before!.lessonContext!.title));
    const after = await mockTutor.getConversation(as(LINH), "CONV-001");
    expect(after!.messages.length).toBe(before!.messages.length + 2);
  });

  it("send on an unknown conversation yields no messages (fail-closed)", async () => {
    expect(await mockTutor.send(as(LINH), "nope", "hi")).toEqual([]);
  });

  it("createConversation adds a persona-scoped conversation", async () => {
    const created = await mockTutor.createConversation(as(MINH), "Minh's first chat", null);
    expect(created.personaId).toBe(MINH);
    expect(created.messages).toEqual([]);
    const list = await mockTutor.listConversations(as(MINH));
    expect(list.some((c) => c.id === created.id)).toBe(true);
  });

  // NEGATIVE: cross-persona conversation history access is denied (strict separation).
  it("does not expose another persona's conversation (cross-persona read denied)", async () => {
    // Minh must not be able to read Linh's seeded conversation.
    expect(await mockTutor.getConversation(as(MINH), "CONV-001")).toBeNull();
    // And Linh's conversation is absent from Minh's own list.
    const minhList = await mockTutor.listConversations(as(MINH));
    expect(minhList.some((c) => c.id === "CONV-001")).toBe(false);
  });

  // NEGATIVE: a persona cannot write into another persona's conversation.
  it("does not write into another persona's conversation (cross-persona send denied)", async () => {
    const linhBefore = await mockTutor.getConversation(as(LINH), "CONV-002");
    const result = await mockTutor.send(as(MINH), "CONV-002", "injection attempt");
    expect(result).toEqual([]); // fail-closed: no messages created
    const linhAfter = await mockTutor.getConversation(as(LINH), "CONV-002");
    expect(linhAfter!.messages.length).toBe(linhBefore!.messages.length); // unchanged
  });
});
