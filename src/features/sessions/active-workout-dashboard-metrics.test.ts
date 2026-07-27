import { describe, expect, it } from "vitest";

import type {
  EntityId,
  IsoDateTime,
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSet,
} from "@/db";
import {
  calculateTrainingDayStreak,
  findLastSessionSets,
} from "./active-workout-dashboard-metrics";

/** Creates a finished workout session fixture for dashboard metric tests. */
const createFinishedSession = (
  id: EntityId,
  startedAt: IsoDateTime,
  exercises: WorkoutSessionExercise[] = [],
): WorkoutSession => ({
  id,
  templateId: null,
  name: "Lift",
  status: "finished",
  exercises,
  notes: null,
  startedAt,
  finishedAt: startedAt,
  createdAt: startedAt,
  updatedAt: startedAt,
});

/** Creates a logged set fixture. */
const createSet = (order: number, weight: number, reps: number): WorkoutSet => ({
  id: `set-${order}`,
  order,
  reps,
  weight,
  weightUnit: "kg",
  isCompleted: true,
  completedAt: null,
  restSeconds: null,
  notes: null,
});

/** Creates a session exercise block with the given sets. */
const createSessionExercise = (
  exerciseId: EntityId,
  sets: WorkoutSet[],
): WorkoutSessionExercise => ({
  exerciseId,
  order: 0,
  targetSets: null,
  restSeconds: null,
  sets,
  notes: null,
});

describe("calculateTrainingDayStreak", () => {
  it("counts consecutive training days through today", () => {
    const now = new Date("2026-05-29T12:00:00.000Z");

    expect(
      calculateTrainingDayStreak(
        [
          createFinishedSession("session-today", "2026-05-29T08:00:00.000Z"),
          createFinishedSession("session-yesterday", "2026-05-28T08:00:00.000Z"),
          createFinishedSession("session-previous", "2026-05-27T08:00:00.000Z"),
        ],
        now,
      ),
    ).toBe(3);
  });

  it("keeps the current streak when the latest workout was yesterday", () => {
    const now = new Date("2026-05-29T12:00:00.000Z");

    expect(
      calculateTrainingDayStreak(
        [
          createFinishedSession("session-yesterday", "2026-05-28T08:00:00.000Z"),
          createFinishedSession("session-previous", "2026-05-27T08:00:00.000Z"),
        ],
        now,
      ),
    ).toBe(2);
  });

  it("returns zero when the latest workout is older than yesterday", () => {
    const now = new Date("2026-05-29T12:00:00.000Z");

    expect(
      calculateTrainingDayStreak(
        [
          createFinishedSession("session-old", "2026-05-27T08:00:00.000Z"),
          createFinishedSession("session-older", "2026-05-26T08:00:00.000Z"),
        ],
        now,
      ),
    ).toBe(0);
  });
});

describe("findLastSessionSets", () => {
  it("returns sets from the most recent session containing the exercise, in order", () => {
    const result = findLastSessionSets("bench", [
      createFinishedSession("recent", "2026-05-28T08:00:00.000Z", [
        createSessionExercise("bench", [createSet(1, 82.5, 6), createSet(0, 80, 8)]),
      ]),
      createFinishedSession("older", "2026-05-21T08:00:00.000Z", [
        createSessionExercise("bench", [createSet(0, 75, 10)]),
      ]),
    ]);

    expect(result?.startedAt).toBe("2026-05-28T08:00:00.000Z");
    expect(result?.sets.map((set) => set.weight)).toEqual([80, 82.5]);
  });

  it("skips sessions where the exercise has no logged sets", () => {
    const result = findLastSessionSets("bench", [
      createFinishedSession("recent-empty", "2026-05-28T08:00:00.000Z", [
        createSessionExercise("bench", []),
      ]),
      createFinishedSession("older-logged", "2026-05-21T08:00:00.000Z", [
        createSessionExercise("bench", [createSet(0, 75, 10)]),
      ]),
    ]);

    expect(result?.startedAt).toBe("2026-05-21T08:00:00.000Z");
  });

  it("returns undefined when the exercise was never logged", () => {
    expect(
      findLastSessionSets("squat", [
        createFinishedSession("recent", "2026-05-28T08:00:00.000Z", [
          createSessionExercise("bench", [createSet(0, 80, 8)]),
        ]),
      ]),
    ).toBeUndefined();
  });
});
