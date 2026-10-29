import type { Conversation } from "@ogc/contracts";
import { organizations } from "./directory";
import { courses } from "./catalog";

const ORG = organizations[0].id;

// Fixed base time so the mock is deterministic (no wall-clock in content).
export const TUTOR_EPOCH = Date.parse("2026-10-20T08:00:00.000Z");

export const seedConversations: Conversation[] = [
  {
    id: "CONV-001",
    orgId: ORG,
    title: "Practising A2 plans",
    lessonContext: { courseId: courses[0].id, title: "Everyday English A2" },
    messages: [
      { id: "CONV-001:0", role: "learner", text: "How do I talk about weekend plans?", at: new Date(TUTOR_EPOCH).toISOString() },
      {
        id: "CONV-001:1",
        role: "tutor",
        text: "Use 'be going to' for plans: \"I am going to visit my family this weekend.\" Try making one sentence about Saturday.",
        at: new Date(TUTOR_EPOCH + 60000).toISOString(),
      },
    ],
  },
  {
    id: "CONV-002",
    orgId: ORG,
    title: "B1 opinions warm-up",
    lessonContext: null,
    messages: [
      { id: "CONV-002:0", role: "learner", text: "Give me a phrase to disagree politely.", at: new Date(TUTOR_EPOCH + 120000).toISOString() },
      {
        id: "CONV-002:1",
        role: "tutor",
        text: "You can say: \"I see your point, but I think…\". Want to practise with a topic?",
        at: new Date(TUTOR_EPOCH + 180000).toISOString(),
      },
    ],
  },
];

export const SUGGESTED_PROMPTS = [
  "Explain this in simpler English.",
  "Give me an example sentence.",
  "Quiz me with 3 questions.",
  "Correct my last sentence.",
];
