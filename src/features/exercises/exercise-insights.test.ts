import { describe, expect, it } from "vitest";

import type { Exercise, WorkoutSession, WorkoutSet } from "@/db";
import {
  buildExerciseInsights,
  buildExercisePerformances,
  filterExerciseProgressPoints,
} from "./exercise-insights";

const timestamp = "2026-08-24T10:00:00.000Z";

/** Creates a completed set fixture for exercise insight tests. */
const createSet = (id: string, overrides: Partial<WorkoutSet> = {}): WorkoutSet => ({
  id,
  order: 0,
  reps: 8,
  durationSeconds: null,
  weight: 50,
  weightUnit: "kg",
  isCompleted: true,
  completedAt: timestamp,
  restSeconds: 120,
  notes: null,
  ...overrides,
});

/** Creates a finished workout containing the bench exercise. */
const createSession = (id: string, startedAt: string, sets: WorkoutSet[]): WorkoutSession => ({
  id,
  templateId: "push",
  name: "Push",
  status: "finished",
  exercises: [
    {
      exerciseId: "bench",
      order: 0,
      targetSets: 3,
      restSeconds: 120,
      sets,
      notes: "Pause on the chest",
    },
  ],
  notes: "Good session",
  startedAt,
  finishedAt: startedAt,
  createdAt: startedAt,
  updatedAt: startedAt,
});

const benchExercise = {
  id: "bench",
  name: "Bench press",
  muscleGroups: ["chest"],
  equipment: "Barbell",
  trackingMode: "weighted",
  notes: null,
  createdAt: timestamp,
  updatedAt: timestamp,
} satisfies Exercise;

describe("buildExercisePerformances", () => {
  it("groups completed sets by workout, preserves set order, and normalizes volume", () => {
    const performances = buildExercisePerformances(
      "bench",
      [
        createSession("latest", "2026-08-24T10:00:00.000Z", [
          createSet("second", { order: 1, weight: 110.231, weightUnit: "lb" }),
          createSet("first", { order: 0 }),
          createSet("skipped", { order: 2, isCompleted: false }),
        ]),
      ],
      "kg",
    );

    expect(performances).toHaveLength(1);
    expect(performances[0]?.sets.map((set) => set.id)).toEqual(["first", "second"]);
    expect(performances[0]?.volume).toBeCloseTo(800, 0);
    expect(performances[0]).toMatchObject({
      exerciseNotes: "Pause on the chest",
      sessionNotes: "Good session",
      totalReps: 16,
    });
  });
});

describe("buildExerciseInsights", () => {
  it("uses estimated strength for weighted summaries and compares consecutive workouts", () => {
    const insights = buildExerciseInsights(
      benchExercise,
      [
        createSession("first", "2026-08-10T10:00:00.000Z", [
          createSet("first-set", { reps: 8, weight: 60 }),
        ]),
        createSession("latest", "2026-08-24T10:00:00.000Z", [
          createSet("latest-set", { reps: 8, weight: 65 }),
        ]),
      ],
      "kg",
    );

    expect(insights.progress.kind).toBe("estimatedStrength");
    expect(insights.workoutCount).toBe(2);
    expect(insights.completedSetCount).toBe(2);
    expect(insights.latestPoint?.value).toBeCloseTo(82.33, 2);
    expect(insights.changeFromPrevious).toBeCloseTo(6.33, 2);
    expect(insights.isImprovement).toBe(true);
  });

  it("treats a decrease in assistance as an improvement", () => {
    const assistedExercise = { ...benchExercise, trackingMode: "assisted" } satisfies Exercise;
    const insights = buildExerciseInsights(
      assistedExercise,
      [
        createSession("first", "2026-08-10T10:00:00.000Z", [
          createSet("first-set", { weight: 30 }),
        ]),
        createSession("latest", "2026-08-24T10:00:00.000Z", [
          createSet("latest-set", { weight: 25 }),
        ]),
      ],
      "kg",
    );

    expect(insights.changeFromPrevious).toBe(-5);
    expect(insights.isImprovement).toBe(true);
    expect(insights.bestPoint?.value).toBe(25);
  });
});

describe("filterExerciseProgressPoints", () => {
  it("keeps only points within the selected calendar-month window", () => {
    const insights = buildExerciseInsights(
      benchExercise,
      [
        createSession("old", "2026-04-01T10:00:00.000Z", [createSet("old-set")]),
        createSession("recent", "2026-08-15T10:00:00.000Z", [createSet("recent-set")]),
      ],
      "kg",
    );

    expect(
      filterExerciseProgressPoints(
        insights.progress.points,
        "threeMonths",
        new Date("2026-09-03T10:00:00.000Z"),
      ).map((point) => point.sessionId),
    ).toEqual(["recent"]);
  });

  it("clamps month-end boundaries and excludes future performances", () => {
    const insights = buildExerciseInsights(
      benchExercise,
      [
        createSession("boundary", "2026-02-28T10:00:00.000Z", [createSet("boundary-set")]),
        createSession("future", "2026-04-01T10:00:00.000Z", [createSet("future-set")]),
      ],
      "kg",
    );

    expect(
      filterExerciseProgressPoints(
        insights.progress.points,
        "oneMonth",
        new Date("2026-03-31T10:00:00.000Z"),
      ).map((point) => point.sessionId),
    ).toEqual(["boundary"]);
  });
});
