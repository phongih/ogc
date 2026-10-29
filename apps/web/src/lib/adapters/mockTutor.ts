import type { TutorPort, Message, LessonContext } from "@ogc/contracts";
import { SUGGESTED_PROMPTS, TUTOR_EPOCH } from "../../fixtures/tutor";
import { personaMap } from "../../fixtures/personas";
import { tutorStore } from "./store";

const latency = <T>(v: T, ms = 60): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(v), ms));

// Deterministic, pure reply: same input text (+ lesson context) always yields the same reply.
const TEMPLATES = [
  "Good question. In English we usually say it like this: ",
  "Here is a simple rule to remember: ",
  "Let's practise. Try this example: ",
  "Think about the tense first. For this case: ",
  "Nice try. A clearer way to say it is: ",
];
const TIPS = [
  "use 'be going to' for plans.",
  "keep the subject before the verb.",
  "add a time word at the end, like 'tomorrow'.",
  "use 'would like' to be polite.",
  "join two ideas with 'because'.",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

export function tutorReply(text: string, lessonTitle: string | null): string {
  const key = text.trim().toLowerCase();
  const h = hash(key);
  let reply = TEMPLATES[h % TEMPLATES.length] + TIPS[(h >> 3) % TIPS.length];
  if (lessonTitle) reply += ` (Lesson context: ${lessonTitle})`;
  return reply;
}

export const mockTutor: TutorPort = {
  listConversations: (personaId) => latency(tutorStore.list(personaId)),

  // Fail-closed: returns null for any conversation the persona does not own.
  getConversation: (personaId, conversationId) => latency(tutorStore.get(personaId, conversationId)),

  createConversation: (personaId, title, lessonContext?: LessonContext | null) => {
    const orgId = personaMap[personaId]?.orgId ?? "";
    return latency(tutorStore.create(personaId, orgId, title, lessonContext ?? null));
  },

  send: (personaId, conversationId, text) => {
    // raw() is scoped to the persona; a foreign conversationId yields null → no write.
    const conv = tutorStore.raw(personaId, conversationId);
    if (!conv) return latency<Message[]>([]);
    const baseIdx = conv.messages.length;
    const learnerMsg: Message = {
      id: `${conv.id}:${baseIdx}`,
      role: "learner",
      text,
      at: new Date(TUTOR_EPOCH + (baseIdx + 1) * 60000).toISOString(),
    };
    const tutorMsg: Message = {
      id: `${conv.id}:${baseIdx + 1}`,
      role: "tutor",
      text: tutorReply(text, conv.lessonContext?.title ?? null),
      at: new Date(TUTOR_EPOCH + (baseIdx + 2) * 60000).toISOString(),
    };
    conv.messages.push(learnerMsg, tutorMsg);
    return latency([learnerMsg, tutorMsg]);
  },

  suggestedPrompts: () => latency(SUGGESTED_PROMPTS.slice()),
};
