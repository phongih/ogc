import { z } from "zod";
import { Id } from "./common.js";

export const TutorRole = z.enum(["learner", "tutor"]);
export type TutorRole = z.infer<typeof TutorRole>;

export const Message = z.object({
  id: z.string().min(1),
  role: TutorRole,
  text: z.string(),
  at: z.string(), // deterministic ISO in the mock (not wall-clock)
});
export type Message = z.infer<typeof Message>;

export const LessonContext = z.object({ courseId: Id, title: z.string().min(1) });
export type LessonContext = z.infer<typeof LessonContext>;

export const Conversation = z.object({
  id: z.string().min(1),
  orgId: Id,
  personaId: z.string().min(1), // owner; conversations are strictly per-persona
  title: z.string().min(1),
  lessonContext: LessonContext.nullable(),
  messages: z.array(Message),
});
export type Conversation = z.infer<typeof Conversation>;

export interface TutorPort {
  listConversations(personaId: string): Promise<Conversation[]>;
  // personaId scopes access: a persona can only read/write its own conversations (fail-closed).
  getConversation(personaId: string, conversationId: string): Promise<Conversation | null>;
  createConversation(
    personaId: string,
    title: string,
    lessonContext?: LessonContext | null,
  ): Promise<Conversation>;
  // Deterministic: same input always yields the same tutor reply. No external LLM.
  send(personaId: string, conversationId: string, text: string): Promise<Message[]>;
  suggestedPrompts(): Promise<string[]>;
}
