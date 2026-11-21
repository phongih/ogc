import type { PracticeActivity, SpeakingTurnCoach } from "@ogc/contracts";
import { PRACTICE_SCORING_VERSION } from "../features/learning/intelligence/practiceVersion";

/*
 * P1 · Speaking studio — synthetic role-play scripts + authored coaching. NON-PRODUCTION,
 * invented A2-level content; no proprietary material, no audio, no model. Kept SEPARATE from
 * `practiceByActivity` on purpose: a speaking rehearsal must never flow through the immediate
 * submitPractice path — it only counts after a teacher approves it.
 */
export const speakingByActivity: Record<string, PracticeActivity> = {
  // ACT-A2-4 — "Speaking: Describe your weekend" (unlocked by the ACT-A2-3 quiz).
  "ACT-A2-4": {
    activityId: "ACT-A2-4",
    skill: "speaking",
    title: "Describe your weekend",
    prompt:
      "Your friend Sam asks about your weekend. For each line, choose the most natural reply, then say it out loud.",
    scoringVersion: PRACTICE_SCORING_VERSION,
    items: [
      {
        id: "SPK-A2-4-1",
        prompt: "Hi! How was your weekend?",
        options: [
          { id: "a", text: "It was great, thanks! I went to the beach." },
          { id: "b", text: "I am go to the beach yesterday." },
          { id: "c", text: "Weekend is Saturday and Sunday." },
        ],
        correctOptionId: "a",
      },
      {
        id: "SPK-A2-4-2",
        prompt: "Oh nice! Who did you go with?",
        options: [
          { id: "a", text: "With the beach." },
          { id: "b", text: "I went with my cousin and her friends." },
          { id: "c", text: "Yes, I go." },
        ],
        correctOptionId: "b",
      },
      {
        id: "SPK-A2-4-3",
        prompt: "What did you do there?",
        options: [
          { id: "a", text: "We swim and eat seafood tomorrow." },
          { id: "b", text: "Seafood is delicious." },
          { id: "c", text: "We swam in the morning and had seafood for lunch." },
        ],
        correctOptionId: "c",
      },
      {
        id: "SPK-A2-4-4",
        prompt: "Sounds fun. Would you go again?",
        options: [
          { id: "a", text: "Definitely — maybe next month." },
          { id: "b", text: "I went again yesterday last week." },
          { id: "c", text: "No beach." },
        ],
        correctOptionId: "a",
      },
    ],
  },
};

// Authored coaching per turn, revealed only after the rehearsal is submitted.
export const speakingCoachByActivity: Record<string, SpeakingTurnCoach[]> = {
  "ACT-A2-4": [
    {
      itemId: "SPK-A2-4-1",
      modelLine: "It was great, thanks! I went to the beach.",
      tips: [
        {
          focus: "weekend",
          ipa: "/ˌwiːkˈend/",
          tip: "Long 'ee' in week; stress the second part: week-END.",
        },
        { focus: "went", ipa: "/went/", tip: "Past of 'go'. Finish with a clear 't'." },
      ],
    },
    {
      itemId: "SPK-A2-4-2",
      modelLine: "I went with my cousin and her friends.",
      tips: [
        { focus: "cousin", ipa: "/ˈkʌz.ən/", tip: "Sounds like 'CUZ-en'. The 's' is a 'z' sound." },
        { focus: "friends", ipa: "/frendz/", tip: "End with 'dz', not 's'." },
      ],
    },
    {
      itemId: "SPK-A2-4-3",
      modelLine: "We swam in the morning and had seafood for lunch.",
      tips: [
        { focus: "swam", ipa: "/swæm/", tip: "Past of 'swim'. Open 'a' as in 'cat'." },
        { focus: "seafood", ipa: "/ˈsiː.fuːd/", tip: "Stress the first part: SEA-food." },
      ],
    },
    {
      itemId: "SPK-A2-4-4",
      modelLine: "Definitely — maybe next month.",
      tips: [
        {
          focus: "definitely",
          ipa: "/ˈdef.ɪ.nət.li/",
          tip: "Four beats, stress the first: DEF-i-nit-ly.",
        },
        { focus: "month", ipa: "/mʌnθ/", tip: "End with 'th' — tongue between the teeth." },
      ],
    },
  ],
};

export function speakingFor(activityId: string): PracticeActivity | undefined {
  return speakingByActivity[activityId];
}

export function speakingCoachFor(activityId: string): SpeakingTurnCoach[] {
  return speakingCoachByActivity[activityId] ?? [];
}
