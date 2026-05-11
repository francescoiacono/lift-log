import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { activeWorkoutId, createLiftLogDatabase, type LiftLogDatabase } from "../database";
import type { EntityId, IsoDateTime, WorkoutTemplate } from "../entities";
import { createWorkoutSessionRepository } from "./workout-sessions-repository";

let database: LiftLogDatabase | undefined;
let databaseIndex = 0;

/** Creates an isolated test database for repository tests. */
const createTestDatabase = () => {
  databaseIndex += 1;
  database = createLiftLogDatabase(`lift-log-workout-session-test-${databaseIndex}`);

  return database;
};

/** Creates a deterministic id factory for repository tests. */
const createIdFactory = (ids: EntityId[]) => {
  let index = 0;

  return () => {
    const id = ids[index];

    if (!id) {
      throw new Error("Test id factory ran out of ids.");
    }

    index += 1;

    return id;
  };
};

/** Creates a deterministic timestamp factory for repository tests. */
const createTimestampFactory = (timestamps: IsoDateTime[]) => {
  let index = 0;

  return () => {
    const timestamp = timestamps[index];

    if (!timestamp) {
      throw new Error("Test timestamp factory ran out of timestamps.");
    }

    index += 1;

    return timestamp;
  };
};

/** Creates a complete workout template fixture for repository tests. */
const createWorkoutTemplate = (): WorkoutTemplate => ({
  id: "template-1",
  name: "Push",
  exercises: [
    {
      exerciseId: "exercise-b",
      order: 1,
      targetSets: 3,
      restSeconds: 90,
      notes: "Keep elbows tucked",
    },
    {
      exerciseId: "exercise-a",
      order: 0,
      targetSets: 4,
      restSeconds: 120,
      notes: null,
    },
  ],
  createdAt: "2026-05-07T10:00:00.000Z",
  updatedAt: "2026-05-07T10:00:00.000Z",
});

afterEach(async () => {
  await database?.delete();
  database = undefined;
});

describe("createWorkoutSessionRepository", () => {
  it("starts an active workout from a template", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["session-1"]),
      now: createTimestampFactory(["2026-05-07T11:00:00.000Z"]),
    });

    await database?.workoutTemplates.add(createWorkoutTemplate());

    const snapshot = await repository.startFromTemplate("template-1");

    expect(snapshot?.session).toMatchObject({
      id: "session-1",
      templateId: "template-1",
      name: "Push",
      status: "active",
      startedAt: "2026-05-07T11:00:00.000Z",
    });
    expect(snapshot?.session.exercises).toEqual([
      {
        exerciseId: "exercise-a",
        order: 0,
        sets: [],
        notes: null,
      },
      {
        exerciseId: "exercise-b",
        order: 1,
        sets: [],
        notes: "Keep elbows tucked",
      },
    ]);
    await expect(database?.activeWorkout.get(activeWorkoutId)).resolves.toMatchObject({
      id: activeWorkoutId,
      sessionId: "session-1",
    });
  });

  it("starts an empty active workout", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["session-1"]),
      now: createTimestampFactory(["2026-05-07T11:00:00.000Z"]),
    });

    const snapshot = await repository.startEmpty({ name: "  Evening lift  " });

    expect(snapshot.session).toMatchObject({
      id: "session-1",
      templateId: null,
      name: "Evening lift",
      status: "active",
      exercises: [],
    });
    await expect(database?.activeWorkout.get(activeWorkoutId)).resolves.toMatchObject({
      sessionId: "session-1",
    });
  });

  it("reuses the active workout instead of creating a second one", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["session-1"]),
      now: createTimestampFactory(["2026-05-07T11:00:00.000Z"]),
    });

    await database?.workoutTemplates.add(createWorkoutTemplate());
    const emptyWorkout = await repository.startEmpty({ name: "Current lift" });
    const templateWorkout = await repository.startFromTemplate("template-1");

    expect(templateWorkout?.session.id).toBe(emptyWorkout.session.id);
    await expect(database?.workoutSessions.count()).resolves.toBe(1);
  });

  it("logs a completed set against an active workout exercise", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["session-1", "set-1"]),
      now: createTimestampFactory(["2026-05-07T11:00:00.000Z", "2026-05-07T11:08:00.000Z"]),
    });

    await database?.workoutTemplates.add(createWorkoutTemplate());
    await repository.startFromTemplate("template-1");
    const workoutSession = await repository.logSet("session-1", "exercise-a", {
      reps: 8,
      restSeconds: 120,
      weight: 80,
      weightUnit: "kg",
    });

    expect(workoutSession?.exercises[0]?.sets).toEqual([
      {
        id: "set-1",
        order: 0,
        reps: 8,
        weight: 80,
        weightUnit: "kg",
        isCompleted: true,
        completedAt: "2026-05-07T11:08:00.000Z",
        restSeconds: 120,
        notes: null,
      },
    ]);
    expect(workoutSession?.updatedAt).toBe("2026-05-07T11:08:00.000Z");
    await expect(database?.activeWorkout.get(activeWorkoutId)).resolves.toMatchObject({
      restTimer: {
        startedAt: "2026-05-07T11:08:00.000Z",
        durationSeconds: 120,
        endsAt: "2026-05-07T11:10:00.000Z",
        relatedSetId: "set-1",
      },
      updatedAt: "2026-05-07T11:08:00.000Z",
    });
  });

  it("clears the active rest timer", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["session-1", "set-1"]),
      now: createTimestampFactory([
        "2026-05-07T11:00:00.000Z",
        "2026-05-07T11:08:00.000Z",
        "2026-05-07T11:09:00.000Z",
      ]),
    });

    await database?.workoutTemplates.add(createWorkoutTemplate());
    await repository.startFromTemplate("template-1");
    await repository.logSet("session-1", "exercise-a", {
      reps: 8,
      restSeconds: 120,
      weight: 80,
    });

    const snapshot = await repository.clearRestTimer("session-1");

    expect(snapshot?.activeWorkout).toMatchObject({
      restTimer: null,
      updatedAt: "2026-05-07T11:09:00.000Z",
    });
    await expect(database?.activeWorkout.get(activeWorkoutId)).resolves.toMatchObject({
      restTimer: null,
      updatedAt: "2026-05-07T11:09:00.000Z",
    });
  });

  it("updates a completed set and recalculates its active rest timer", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["session-1", "set-1"]),
      now: createTimestampFactory([
        "2026-05-07T11:00:00.000Z",
        "2026-05-07T11:08:00.000Z",
        "2026-05-07T11:09:00.000Z",
      ]),
    });

    await database?.workoutTemplates.add(createWorkoutTemplate());
    await repository.startFromTemplate("template-1");
    await repository.logSet("session-1", "exercise-a", {
      reps: 8,
      restSeconds: 120,
      weight: 80,
    });

    const snapshot = await repository.updateSet("session-1", "exercise-a", "set-1", {
      reps: 10,
      restSeconds: 90,
      weight: 82.5,
      weightUnit: "kg",
    });

    expect(snapshot?.session.exercises[0]?.sets[0]).toMatchObject({
      id: "set-1",
      reps: 10,
      restSeconds: 90,
      weight: 82.5,
      weightUnit: "kg",
    });
    expect(snapshot?.activeWorkout).toMatchObject({
      restTimer: {
        startedAt: "2026-05-07T11:09:00.000Z",
        durationSeconds: 90,
        endsAt: "2026-05-07T11:10:30.000Z",
        relatedSetId: "set-1",
      },
      updatedAt: "2026-05-07T11:09:00.000Z",
    });
  });

  it("preserves the active rest timer when editing set fields without changing rest", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["session-1", "set-1"]),
      now: createTimestampFactory([
        "2026-05-07T11:00:00.000Z",
        "2026-05-07T11:08:00.000Z",
        "2026-05-07T11:09:00.000Z",
      ]),
    });

    await database?.workoutTemplates.add(createWorkoutTemplate());
    await repository.startFromTemplate("template-1");
    await repository.logSet("session-1", "exercise-a", {
      reps: 8,
      restSeconds: 120,
      weight: 80,
    });

    const snapshot = await repository.updateSet("session-1", "exercise-a", "set-1", {
      reps: 10,
      restSeconds: 120,
      weight: 82.5,
      weightUnit: "kg",
    });

    expect(snapshot?.activeWorkout).toMatchObject({
      restTimer: {
        startedAt: "2026-05-07T11:08:00.000Z",
        durationSeconds: 120,
        endsAt: "2026-05-07T11:10:00.000Z",
        relatedSetId: "set-1",
      },
      updatedAt: "2026-05-07T11:09:00.000Z",
    });
  });

  it("deletes a completed set and clears its active rest timer", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["session-1", "set-1", "set-2"]),
      now: createTimestampFactory([
        "2026-05-07T11:00:00.000Z",
        "2026-05-07T11:08:00.000Z",
        "2026-05-07T11:11:00.000Z",
        "2026-05-07T11:12:00.000Z",
      ]),
    });

    await database?.workoutTemplates.add(createWorkoutTemplate());
    await repository.startFromTemplate("template-1");
    await repository.logSet("session-1", "exercise-a", {
      reps: 8,
      restSeconds: 120,
      weight: 80,
    });
    await repository.logSet("session-1", "exercise-a", {
      reps: 7,
      restSeconds: 90,
      weight: 80,
    });

    const snapshot = await repository.deleteSet("session-1", "exercise-a", "set-2");

    expect(snapshot?.session.exercises[0]?.sets).toEqual([
      {
        id: "set-1",
        order: 0,
        reps: 8,
        weight: 80,
        weightUnit: "kg",
        isCompleted: true,
        completedAt: "2026-05-07T11:08:00.000Z",
        restSeconds: 120,
        notes: null,
      },
    ]);
    expect(snapshot?.activeWorkout).toMatchObject({
      restTimer: null,
      updatedAt: "2026-05-07T11:12:00.000Z",
    });
  });

  it("does not log a set for an exercise outside the active workout", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["session-1"]),
      now: createTimestampFactory(["2026-05-07T11:00:00.000Z"]),
    });

    await repository.startEmpty();

    await expect(
      repository.logSet("session-1", "missing-exercise", { reps: 8 }),
    ).resolves.toBeUndefined();
    await expect(database?.workoutSessions.get("session-1")).resolves.toMatchObject({
      exercises: [],
    });
  });

  it("restores and cleans up the active workout pointer", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["session-1"]),
      now: createTimestampFactory(["2026-05-07T11:00:00.000Z"]),
    });

    const snapshot = await repository.startEmpty();

    await expect(repository.getActive()).resolves.toEqual(snapshot);
    await database?.workoutSessions.delete("session-1");
    await expect(repository.getActive()).resolves.toBeUndefined();
    await expect(database?.activeWorkout.get(activeWorkoutId)).resolves.toBeUndefined();
  });

  it("finishes the active workout and clears the active pointer", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["session-1"]),
      now: createTimestampFactory(["2026-05-07T11:00:00.000Z", "2026-05-07T11:45:00.000Z"]),
    });

    await repository.startEmpty();
    const session = await repository.finishActive();

    expect(session).toMatchObject({
      id: "session-1",
      status: "finished",
      finishedAt: "2026-05-07T11:45:00.000Z",
      updatedAt: "2026-05-07T11:45:00.000Z",
    });
    await expect(database?.activeWorkout.get(activeWorkoutId)).resolves.toBeUndefined();
  });
});
