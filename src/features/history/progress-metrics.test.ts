import { describe, expect, it } from "vitest";

import type { Exercise, WorkoutSession, WorkoutSet } from "@/db";
import {
  buildExerciseProgress,
  buildWeeklyTrainingSummaries,
  calculatePlanAdherence,
  convertWeight,
  getDaysSinceLastWorkout,
} from "./progress-metrics";

const timestamp = "2026-08-24T10:00:00.000Z";

/** Creates a completed set fixture for progress metric tests. */
const createSet = (overrides: Partial<WorkoutSet> = {}): WorkoutSet => ({
  id: "set-1",
  order: 0,
  reps: 10,
  durationSeconds: null,
  weight: 50,
  weightUnit: "kg",
  isCompleted: true,
  completedAt: timestamp,
  restSeconds: null,
  notes: null,
  ...overrides,
});

/** Creates a finished workout fixture containing one exercise block. */
const createSession = (
  id: string,
  startedAt: string,
  sets: WorkoutSet[],
  targetSets: number | null = 3,
): WorkoutSession => ({
  id,
  templateId: "plan-1",
  name: "Push",
  status: "finished",
  exercises: [
    {
      exerciseId: "bench",
      order: 0,
      targetSets,
      restSeconds: 120,
      sets,
      notes: null,
    },
  ],
  notes: null,
  startedAt,
  finishedAt: startedAt,
  createdAt: startedAt,
  updatedAt: startedAt,
});

const benchExercise = {
  id: "bench",
  name: "Bench press",
  muscleGroups: ["Chest"],
  equipment: "Barbell",
  trackingMode: "weighted",
  notes: null,
  createdAt: timestamp,
  updatedAt: timestamp,
} satisfies Exercise;

describe("buildWeeklyTrainingSummaries", () => {
  it("returns fixed weeks with completed sets, targets, and normalized volume", () => {
    const summaries = buildWeeklyTrainingSummaries(
      [
        createSession("current", "2026-08-25T10:00:00.000Z", [
          createSet(),
          createSet({ id: "set-2", weight: 110.231, weightUnit: "lb" }),
          createSet({ id: "set-3", isCompleted: false }),
        ]),
      ],
      { numberOfWeeks: 2, now: new Date("2026-08-26T12:00:00.000Z") },
    );

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({ sessionCount: 0, completedSetCount: 0 });
    expect(summaries[1]).toMatchObject({
      sessionCount: 1,
      completedSetCount: 2,
      plannedSetCount: 3,
      completedPlannedSetCount: 2,
    });
    expect(summaries[1]?.volume).toBeCloseTo(1000, 0);
  });
});

describe("calculatePlanAdherence", () => {
  it("caps completed-to-planned adherence at one hundred percent", () => {
    expect(
      calculatePlanAdherence([
        {
          weekStartedAt: timestamp,
          sessionCount: 1,
          completedSetCount: 4,
          plannedSetCount: 3,
          completedPlannedSetCount: 4,
          volume: 0,
        },
      ]),
    ).toEqual({ plannedSetCount: 3, completedSetCount: 4, percent: 100 });
  });
});

describe("getDaysSinceLastWorkout", () => {
  it("uses local calendar days instead of elapsed twenty-four-hour periods", () => {
    expect(
      getDaysSinceLastWorkout(
        [createSession("recent", "2026-08-25T22:30:00.000Z", [])],
        new Date("2026-08-26T08:00:00.000Z"),
      ),
    ).toBe(1);
  });
});

describe("buildExerciseProgress", () => {
  it("uses the actual weight lifted by default and marks later personal records", () => {
    const progress = buildExerciseProgress(benchExercise, [
      createSession("first", "2026-08-18T10:00:00.000Z", [createSet({ weight: 50 })]),
      createSession("second", "2026-08-25T10:00:00.000Z", [createSet({ weight: 55 })]),
    ]);

    expect(progress.kind).toBe("weight");
    expect(progress.points).toHaveLength(2);
    expect(progress.points[0]?.isPersonalRecord).toBe(false);
    expect(progress.points[1]).toMatchObject({
      isPersonalRecord: true,
      sessionName: "Push",
      value: 55,
      weight: 55,
    });
  });

  it("builds estimated one-rep-max points when that metric is selected", () => {
    const progress = buildExerciseProgress(
      benchExercise,
      [createSession("first", "2026-08-18T10:00:00.000Z", [createSet({ weight: 50 })])],
      "kg",
      "estimatedStrength",
    );

    expect(progress.kind).toBe("estimatedStrength");
    expect(progress.points[0]?.value).toBeCloseTo(66.67, 2);
  });

  it("keeps logged weight separate from an estimated one-rep max", () => {
    const sessions = [
      createSession("first", "2026-08-18T10:00:00.000Z", [createSet({ reps: 10, weight: 50 })]),
      createSession("latest", "2026-08-25T10:00:00.000Z", [createSet({ reps: 12, weight: 45 })]),
    ];
    const weightProgress = buildExerciseProgress(benchExercise, sessions);
    const estimatedProgress = buildExerciseProgress(
      benchExercise,
      sessions,
      "kg",
      "estimatedStrength",
    );

    expect(weightProgress.points.map((point) => point.value)).toEqual([50, 45]);
    expect(estimatedProgress.points[0]?.value).toBeCloseTo(66.67, 2);
    expect(estimatedProgress.points[1]?.value).toBeCloseTo(63, 2);
  });

  it("treats lower assistance as progress", () => {
    const progress = buildExerciseProgress({ ...benchExercise, trackingMode: "assisted" }, [
      createSession("first", "2026-08-18T10:00:00.000Z", [createSet({ weight: 40 })]),
      createSession("second", "2026-08-25T10:00:00.000Z", [createSet({ weight: 35 })]),
    ]);

    expect(progress.kind).toBe("assistance");
    expect(progress.points[1]?.isPersonalRecord).toBe(true);
  });

  it("recognizes zero assistance as the best assisted performance", () => {
    const progress = buildExerciseProgress({ ...benchExercise, trackingMode: "assisted" }, [
      createSession("first", "2026-08-18T10:00:00.000Z", [createSet({ weight: 10 })]),
      createSession("second", "2026-08-25T10:00:00.000Z", [createSet({ weight: 0 })]),
    ]);

    expect(progress.points[1]).toMatchObject({ value: 0, isPersonalRecord: true });
  });

  it("uses repetitions for bodyweight exercises even when old sets contain weight", () => {
    const progress = buildExerciseProgress({ ...benchExercise, trackingMode: "bodyweight" }, [
      createSession("first", "2026-08-18T10:00:00.000Z", [createSet({ reps: 8, weight: 10 })]),
      createSession("second", "2026-08-25T10:00:00.000Z", [createSet({ reps: 10, weight: 5 })]),
    ]);

    expect(progress.kind).toBe("repetitions");
    expect(progress.points.map((point) => point.value)).toEqual([8, 10]);
    expect(progress.points[1]?.isPersonalRecord).toBe(true);
  });

  it("uses hold duration for timed exercises", () => {
    const progress = buildExerciseProgress({ ...benchExercise, trackingMode: "timed" }, [
      createSession("first", "2026-08-18T10:00:00.000Z", [
        createSet({ durationSeconds: 30, reps: null, weight: null }),
      ]),
    ]);

    expect(progress.kind).toBe("duration");
    expect(progress.points[0]?.value).toBe(30);
  });
});

describe("convertWeight", () => {
  it("converts pounds to kilograms", () => {
    expect(convertWeight(220.462, "lb", "kg")).toBeCloseTo(100, 2);
  });
});
