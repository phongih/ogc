import type { PracticeActivity } from "@ogc/contracts";
import { PRACTICE_SCORING_VERSION } from "../features/learning/intelligence/practiceVersion";

/*
 * OGC-AUTH-030 — Synthetic practice item-sets, keyed by an EXISTING LearningActivity id so a
 * submission scores into the established LI-1 → LI-4 path. NON-PRODUCTION, invented content;
 * no proprietary teaching material, no real learner data. Both map to use_of_english quizzes.
 */
export const practiceByActivity: Record<string, PracticeActivity> = {
  // ACT-A2-3 — the use_of_english quiz Linh is recommended first.
  "ACT-A2-3": {
    activityId: "ACT-A2-3",
    skill: "use_of_english",
    title: "At the market",
    prompt: "Choose the most appropriate expression for each short exchange at a market.",
    scoringVersion: PRACTICE_SCORING_VERSION,
    items: [
      {
        id: "A2-3-Q1",
        prompt: "You want to know the price of the apples. What do you say?",
        options: [
          { id: "a", text: "How much are the apples?" },
          { id: "b", text: "How many the apples?" },
          { id: "c", text: "What apples cost?" },
        ],
        correctOptionId: "a",
      },
      {
        id: "A2-3-Q2",
        prompt: "The seller offers a bag you don't need. Politely decline.",
        options: [
          { id: "a", text: "No, I don't want nothing." },
          { id: "b", text: "No thanks, I'm fine." },
          { id: "c", text: "No, give me not." },
        ],
        correctOptionId: "b",
      },
      {
        id: "A2-3-Q3",
        prompt: "You'd like half a kilo of tomatoes. What's the natural request?",
        options: [
          { id: "a", text: "I take tomato half." },
          { id: "b", text: "Can I have half a kilo of tomatoes, please?" },
          { id: "c", text: "Give half kilo tomato." },
        ],
        correctOptionId: "b",
      },
      {
        id: "A2-3-Q4",
        prompt: "You want to pay by card. Ask whether it's possible.",
        options: [
          { id: "a", text: "Can I pay by card?" },
          { id: "b", text: "I pay card yes?" },
          { id: "c", text: "Card paying is?" },
        ],
        correctOptionId: "a",
      },
    ],
  },

  // ACT-B1-2 — the eligible alternative a teacher may apply.
  "ACT-B1-2": {
    activityId: "ACT-B1-2",
    skill: "use_of_english",
    title: "Opinion phrases",
    prompt: "Choose the most natural way to express or respond to an opinion.",
    scoringVersion: PRACTICE_SCORING_VERSION,
    items: [
      {
        id: "B1-2-Q1",
        prompt: "You want to introduce your personal opinion. Which opener is best?",
        options: [
          { id: "a", text: "In my opinion, the film was too long." },
          { id: "b", text: "By my opinion, the film was too long." },
          { id: "c", text: "On my think, the film was too long." },
        ],
        correctOptionId: "a",
      },
      {
        id: "B1-2-Q2",
        prompt: "A friend states a view you partly share. Soften your agreement.",
        options: [
          { id: "a", text: "You're totally wrong." },
          { id: "b", text: "I see your point, but I'm not sure I agree completely." },
          { id: "c", text: "Yes, same, end of story." },
        ],
        correctOptionId: "b",
      },
      {
        id: "B1-2-Q3",
        prompt: "Ask someone for their view politely.",
        options: [
          { id: "a", text: "What you think?" },
          { id: "b", text: "Tell opinion now." },
          { id: "c", text: "What do you think about it?" },
        ],
        correctOptionId: "c",
      },
    ],
  },
};

export function practiceFor(activityId: string): PracticeActivity | undefined {
  return practiceByActivity[activityId];
}
