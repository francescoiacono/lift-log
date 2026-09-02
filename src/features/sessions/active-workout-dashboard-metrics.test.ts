import { describe, expect, it } from "vitest";

import type {
  EntityId,
  Exercise,
  IsoDateTime,
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSet,
  WorkoutTemplate,
} from "@/db";
import {
  buildMuscleRecoveryStatuses,
  calculateTrainingDayStreak,
  findLastSessionSets,
  getStaleWorkoutAgeHours,
  recommendWorkoutTemplate,
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

  it("does not count an unfinished workout toward the streak", () => {
    const now = new Date("2026-05-29T12:00:00.000Z");
    const activeSession: WorkoutSession = {
      ...createFinishedSession("session-active", "2026-05-29T08:00:00.000Z"),
      status: "active",
      finishedAt: null,
    };

    expect(
      calculateTrainingDayStreak(
        [activeSession, createFinishedSession("session-yesterday", "2026-05-28T08:00:00.000Z")],
        now,
      ),
    ).toBe(1);
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

  it("skips uncompleted set drafts in a newer session", () => {
    const result = findLastSessionSets("bench", [
      createFinishedSession("recent-draft", "2026-05-28T08:00:00.000Z", [
        createSessionExercise("bench", [{ ...createSet(0, 82.5, 6), isCompleted: false }]),
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

const templates: WorkoutTemplate[] = [
  {
    id: "upper",
    name: "Upper Body A",
    exercises: [],
    createdAt: "2026-05-01T10:00:00.000Z",
    updatedAt: "2026-05-01T10:00:00.000Z",
  },
  {
    id: "lower",
    name: "Lower Body A",
    exercises: [],
    createdAt: "2026-05-01T10:00:00.000Z",
    updatedAt: "2026-05-01T10:00:00.000Z",
  },
];

describe("recommendWorkoutTemplate", () => {
  it("suggests the plan that has waited longest", () => {
    const upperSession = {
      ...createFinishedSession("upper-session", "2026-05-23T12:00:00.000Z"),
      templateId: "upper",
    };
    const lowerSession = {
      ...createFinishedSession("lower-session", "2026-05-27T12:00:00.000Z"),
      templateId: "lower",
    };

    expect(
      recommendWorkoutTemplate(
        templates,
        [lowerSession, upperSession],
        new Date("2026-05-29T12:00:00.000Z"),
      ),
    ).toMatchObject({ template: { id: "upper" }, daysSinceLastSession: 6 });
  });

  it("prioritizes a plan that has never been completed", () => {
    const upperSession = {
      ...createFinishedSession("upper-session", "2026-05-23T12:00:00.000Z"),
      templateId: "upper",
    };

    expect(
      recommendWorkoutTemplate(templates, [upperSession], new Date("2026-05-29T12:00:00.000Z")),
    ).toMatchObject({ template: { id: "lower" }, daysSinceLastSession: null });
  });
});

describe("buildMuscleRecoveryStatuses", () => {
  it("classifies normalized muscle groups by training recency", () => {
    const exercises: Exercise[] = [
      {
        id: "bench",
        name: "Bench press",
        muscleGroups: ["chest"],
        equipment: "barbell",
        trackingMode: "weighted",
        notes: null,
        createdAt: "2026-05-01T10:00:00.000Z",
        updatedAt: "2026-05-01T10:00:00.000Z",
      },
      {
        id: "row",
        name: "Row",
        muscleGroups: ["back"],
        equipment: "cable",
        trackingMode: "weighted",
        notes: null,
        createdAt: "2026-05-01T10:00:00.000Z",
        updatedAt: "2026-05-01T10:00:00.000Z",
      },
      {
        id: "raise",
        name: "Lateral raise",
        muscleGroups: ["shoulders"],
        equipment: "dumbbell",
        trackingMode: "weighted",
        notes: null,
        createdAt: "2026-05-01T10:00:00.000Z",
        updatedAt: "2026-05-01T10:00:00.000Z",
      },
    ];
    const sessions = [
      createFinishedSession("chest", "2026-05-29T08:00:00.000Z", [
        createSessionExercise("bench", [createSet(0, 80, 8)]),
      ]),
      createFinishedSession("shoulders", "2026-05-26T08:00:00.000Z", [
        createSessionExercise("raise", [createSet(0, 10, 12)]),
      ]),
      createFinishedSession("back", "2026-05-24T08:00:00.000Z", [
        createSessionExercise("row", [createSet(0, 60, 10)]),
      ]),
    ];

    expect(
      buildMuscleRecoveryStatuses(exercises, sessions, new Date("2026-05-29T12:00:00.000Z")),
    ).toEqual([
      { muscleGroupId: "back", daysSinceTrained: 5, state: "ready" },
      { muscleGroupId: "shoulders", daysSinceTrained: 3, state: "recent" },
      { muscleGroupId: "chest", daysSinceTrained: 0, state: "rest" },
    ]);
  });
});

describe("getStaleWorkoutAgeHours", () => {
  it("warns for an old session that has also been inactive", () => {
    const session: WorkoutSession = {
      ...createFinishedSession("active", "2026-05-29T02:00:00.000Z"),
      status: "active",
      finishedAt: null,
      updatedAt: "2026-05-29T04:00:00.000Z",
    };

    expect(getStaleWorkoutAgeHours(session, new Date("2026-05-29T12:00:00.000Z"))).toBe(10);
  });

  it("does not warn when an old session was updated recently", () => {
    const session: WorkoutSession = {
      ...createFinishedSession("active", "2026-05-29T02:00:00.000Z"),
      status: "active",
      finishedAt: null,
      updatedAt: "2026-05-29T11:30:00.000Z",
    };

    expect(getStaleWorkoutAgeHours(session, new Date("2026-05-29T12:00:00.000Z"))).toBeNull();
  });
});
