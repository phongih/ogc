import { personaMap } from "../../fixtures/personas";

// Synthetic, in-memory learner streak + achievements. NOT a shared contract and NOT real
// data — a demo-only accessor, fail-closed to learner personas (persona isolation).
export interface Achievement {
  id: string;
  title: string;
  icon: string;
  earned: boolean;
}
export interface LearnerAchievements {
  streakDays: number;
  badges: Achievement[];
}

const DEMO: LearnerAchievements = {
  streakDays: 5,
  badges: [
    { id: "first-lesson", title: "First lesson", icon: "🎯", earned: true },
    { id: "streak-3", title: "3-day streak", icon: "🔥", earned: true },
    { id: "quiz-ace", title: "Quiz ace", icon: "🏆", earned: true },
    { id: "course-complete", title: "Course complete", icon: "🎓", earned: false },
    { id: "streak-30", title: "30-day streak", icon: "⭐", earned: false },
  ],
};

export function getAchievements(personaId: string): LearnerAchievements | null {
  // Only learner personas have a streak/achievements panel.
  return personaMap[personaId]?.learnerId ? DEMO : null;
}
