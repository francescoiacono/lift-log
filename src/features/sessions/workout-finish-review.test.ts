import { describe, expect, it } from "vitest";

import {
  buildWorkoutFinishReviewSummary,
  calculateAverageSetEffort,
  getCompletedWorkoutSets,
} from "./workout-finish-review-metrics";
import type { WorkoutSession, WorkoutSessionExercise, WorkoutSet } from "@/db";

/** Creates a workout set fixture for finish-review calculations. */
const createSet = (
  id: string,
  order: number,
  isCompleted: boolean,
  effortRating: WorkoutSet["effortRating"] = null,
): WorkoutSet => ({
  id,
  order,
  reps: 8,
  weight: 80,
  weightUnit: "kg",
  isCompleted,
  completedAt: isCompleted ? "2026-09-04T10:05:00.000Z" : null,
  restSeconds: 120,
  effortRating,
  notes: null,
});

/** Creates a workout exercise fixture for finish-review calculations. */
const createExercise = (
  exerciseId: string,
  targetSets: number | null,
  sets: WorkoutSet[],
): WorkoutSessionExercise => ({
  exerciseId,
  order: 0,
  targetSets,
  restSeconds: 120,
  sets,
  notes: null,
});

/** Creates an active workout fixture for finish-review calculations. */
const createSession = (exercises: WorkoutSessionExercise[]): WorkoutSession => ({
  id: "session-1",
  templateId: "template-1",
  name: "Push",
  status: "active",
  exercises,
  notes: null,
  startedAt: "2026-09-04T10:00:00.000Z",
  finishedAt: null,
  createdAt: "2026-09-04T10:00:00.000Z",
  updatedAt: "2026-09-04T10:05:00.000Z",
});

describe("workout finish review", () => {
  it("returns completed sets in display order", () => {
    const exercise = createExercise("exercise-1", 3, [
      createSet("set-3", 2, true),
      createSet("set-1", 0, true),
      createSet("set-2", 1, false),
    ]);

    expect(getCompletedWorkoutSets(exercise).map((set) => set.id)).toEqual(["set-1", "set-3"]);
  });

  it("averages only completed sets with effort ratings", () => {
    const sets = [
      createSet("set-1", 0, true, 2),
      createSet("set-2", 1, true, null),
      createSet("set-3", 2, true, 5),
      createSet("set-4", 3, false, 1),
    ];

    expect(calculateAverageSetEffort(sets)).toBe(3.5);
  });

  it("returns no average when no completed set has an effort rating", () => {
    expect(calculateAverageSetEffort([createSet("set-1", 0, true)])).toBeNull();
  });

  it("summarizes completed and incomplete planned sets", () => {
    const session = createSession([
      createExercise("exercise-1", 3, [
        createSet("set-1", 0, true, 3),
        createSet("set-2", 1, true, 4),
      ]),
      createExercise("exercise-2", 2, [createSet("set-3", 0, true, 5)]),
      createExercise("exercise-3", null, [createSet("set-4", 0, true, null)]),
    ]);

    expect(buildWorkoutFinishReviewSummary(session)).toEqual({
      exerciseCount: 3,
      completedSetCount: 4,
      incompleteSetCount: 2,
      averageEffort: 4,
    });
  });
});
