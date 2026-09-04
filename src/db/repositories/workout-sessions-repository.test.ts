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
        targetSets: 4,
        restSeconds: 120,
        sets: [],
        notes: null,
      },
      {
        exerciseId: "exercise-b",
        order: 1,
        targetSets: 3,
        restSeconds: 90,
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

  it("adds an exercise to an empty active workout", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["session-1"]),
      now: createTimestampFactory(["2026-05-07T11:00:00.000Z", "2026-05-07T11:02:00.000Z"]),
    });

    await database?.exercises.add({
      id: "exercise-a",
      name: "Bench press",
      muscleGroups: ["chest"],
      equipment: "Barbell",
      trackingMode: "weighted",
      notes: null,
      createdAt: "2026-05-07T10:00:00.000Z",
      updatedAt: "2026-05-07T10:00:00.000Z",
    });
    await repository.startEmpty({ name: "Current lift" });

    const snapshot = await repository.addExercise("session-1", "exercise-a");

    expect(snapshot?.session.exercises).toEqual([
      {
        exerciseId: "exercise-a",
        order: 0,
        targetSets: null,
        restSeconds: null,
        sets: [],
        notes: null,
      },
    ]);
    expect(snapshot?.activeWorkout.updatedAt).toBe("2026-05-07T11:02:00.000Z");
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
      effortRating: 4,
    });

    expect(workoutSession?.exercises[0]?.sets).toEqual([
      {
        id: "set-1",
        order: 0,
        reps: 8,
        durationSeconds: null,
        weight: 80,
        weightUnit: "kg",
        isCompleted: true,
        completedAt: "2026-05-07T11:08:00.000Z",
        restSeconds: 120,
        effortRating: 4,
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

  it("logs a timed hold set with a duration and no reps", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["session-1", "set-1"]),
      now: createTimestampFactory(["2026-05-07T11:00:00.000Z", "2026-05-07T11:08:00.000Z"]),
    });

    await database?.workoutTemplates.add(createWorkoutTemplate());
    await repository.startFromTemplate("template-1");
    const workoutSession = await repository.logSet("session-1", "exercise-a", {
      reps: null,
      durationSeconds: 45,
      restSeconds: 60,
    });

    expect(workoutSession?.exercises[0]?.sets).toEqual([
      {
        id: "set-1",
        order: 0,
        reps: null,
        durationSeconds: 45,
        weight: null,
        weightUnit: "kg",
        isCompleted: true,
        completedAt: "2026-05-07T11:08:00.000Z",
        restSeconds: 60,
        effortRating: null,
        notes: null,
      },
    ]);
  });

  it("starts an active workout by repeating a finished workout without copied sets", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["session-repeat"]),
      now: createTimestampFactory(["2026-05-07T12:00:00.000Z"]),
    });

    await database?.workoutSessions.add({
      id: "session-finished",
      templateId: null,
      name: "Upper body",
      status: "finished",
      exercises: [
        {
          exerciseId: "exercise-b",
          order: 1,
          targetSets: null,
          restSeconds: null,
          sets: [
            {
              id: "set-3",
              order: 0,
              reps: 10,
              weight: 30,
              weightUnit: "kg",
              isCompleted: true,
              completedAt: "2026-05-07T11:30:00.000Z",
              restSeconds: 60,
              notes: null,
            },
          ],
          notes: "Keep controlled",
        },
        {
          exerciseId: "exercise-a",
          order: 0,
          targetSets: 4,
          restSeconds: 120,
          sets: [
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
            {
              id: "set-2",
              order: 1,
              reps: 7,
              weight: 80,
              weightUnit: "kg",
              isCompleted: true,
              completedAt: "2026-05-07T11:11:00.000Z",
              restSeconds: 90,
              notes: null,
            },
          ],
          notes: null,
        },
      ],
      notes: "Felt strong",
      startedAt: "2026-05-07T11:00:00.000Z",
      finishedAt: "2026-05-07T11:45:00.000Z",
      createdAt: "2026-05-07T11:00:00.000Z",
      updatedAt: "2026-05-07T11:45:00.000Z",
    });

    const snapshot = await repository.repeatFinished("session-finished");

    expect(snapshot?.session).toMatchObject({
      id: "session-repeat",
      templateId: null,
      name: "Upper body",
      status: "active",
      startedAt: "2026-05-07T12:00:00.000Z",
      finishedAt: null,
    });
    expect(snapshot?.session.exercises).toEqual([
      {
        exerciseId: "exercise-a",
        order: 0,
        targetSets: 4,
        restSeconds: 120,
        sets: [],
        notes: null,
      },
      {
        exerciseId: "exercise-b",
        order: 1,
        targetSets: 1,
        restSeconds: 60,
        sets: [],
        notes: "Keep controlled",
      },
    ]);
    await expect(database?.activeWorkout.get(activeWorkoutId)).resolves.toMatchObject({
      id: activeWorkoutId,
      sessionId: "session-repeat",
    });
  });

  it("does not repeat a finished workout without exercises", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
    });

    await database?.workoutSessions.add({
      id: "session-empty",
      templateId: null,
      name: "Quick workout",
      status: "finished",
      exercises: [],
      notes: null,
      startedAt: "2026-05-07T11:00:00.000Z",
      finishedAt: "2026-05-07T11:05:00.000Z",
      createdAt: "2026-05-07T11:00:00.000Z",
      updatedAt: "2026-05-07T11:05:00.000Z",
    });

    await expect(repository.repeatFinished("session-empty")).resolves.toBeUndefined();
    await expect(database?.activeWorkout.count()).resolves.toBe(0);
    await expect(database?.workoutSessions.count()).resolves.toBe(1);
  });

  it("saves an ad-hoc active workout as a template and links the session", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["session-1", "set-1", "template-1"]),
      now: createTimestampFactory([
        "2026-05-07T11:00:00.000Z",
        "2026-05-07T11:01:00.000Z",
        "2026-05-07T11:08:00.000Z",
        "2026-05-07T11:09:00.000Z",
      ]),
    });

    await database?.exercises.add({
      id: "exercise-a",
      name: "Bench press",
      muscleGroups: ["chest"],
      equipment: "Barbell",
      trackingMode: "weighted",
      notes: null,
      createdAt: "2026-05-07T10:00:00.000Z",
      updatedAt: "2026-05-07T10:00:00.000Z",
    });
    await repository.startEmpty({ name: "Quick workout" });
    await repository.addExercise("session-1", "exercise-a");
    await repository.logSet("session-1", "exercise-a", {
      reps: 8,
      restSeconds: 120,
      weight: 80,
    });

    const result = await repository.createTemplateFromActive("session-1", {
      name: "Upper body",
    });

    expect(result?.template).toEqual({
      id: "template-1",
      name: "Upper body",
      exercises: [
        {
          exerciseId: "exercise-a",
          order: 0,
          targetSets: 1,
          restSeconds: 120,
          notes: null,
        },
      ],
      createdAt: "2026-05-07T11:09:00.000Z",
      updatedAt: "2026-05-07T11:09:00.000Z",
    });
    expect(result?.snapshot.session).toMatchObject({
      id: "session-1",
      templateId: "template-1",
      name: "Upper body",
      updatedAt: "2026-05-07T11:09:00.000Z",
    });
    expect(result?.snapshot.activeWorkout.updatedAt).toBe("2026-05-07T11:09:00.000Z");
    await expect(database?.workoutTemplates.get("template-1")).resolves.toEqual(result?.template);
    await expect(database?.workoutSessions.get("session-1")).resolves.toMatchObject({
      templateId: "template-1",
      name: "Upper body",
    });
  });

  it("saves a finished workout as a template", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["template-1"]),
      now: createTimestampFactory(["2026-05-07T12:00:00.000Z"]),
    });

    await database?.workoutSessions.add({
      id: "session-finished",
      templateId: null,
      name: "Upper body",
      status: "finished",
      exercises: [
        {
          exerciseId: "exercise-a",
          order: 0,
          targetSets: null,
          restSeconds: null,
          sets: [
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
            {
              id: "set-2",
              order: 1,
              reps: 7,
              weight: 80,
              weightUnit: "kg",
              isCompleted: true,
              completedAt: "2026-05-07T11:11:00.000Z",
              restSeconds: 90,
              notes: null,
            },
          ],
          notes: null,
        },
      ],
      notes: null,
      startedAt: "2026-05-07T11:00:00.000Z",
      finishedAt: "2026-05-07T11:45:00.000Z",
      createdAt: "2026-05-07T11:00:00.000Z",
      updatedAt: "2026-05-07T11:45:00.000Z",
    });

    const workoutTemplate = await repository.createTemplateFromFinished("session-finished", {
      name: "Upper plan",
    });

    expect(workoutTemplate).toEqual({
      id: "template-1",
      name: "Upper plan",
      exercises: [
        {
          exerciseId: "exercise-a",
          order: 0,
          targetSets: 2,
          restSeconds: 90,
          notes: null,
        },
      ],
      createdAt: "2026-05-07T12:00:00.000Z",
      updatedAt: "2026-05-07T12:00:00.000Z",
    });
    await expect(database?.workoutTemplates.get("template-1")).resolves.toEqual(workoutTemplate);
  });

  it("does not save a template from an active workout without exercises", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["session-1"]),
      now: createTimestampFactory(["2026-05-07T11:00:00.000Z"]),
    });

    await repository.startEmpty({ name: "Quick workout" });

    await expect(
      repository.createTemplateFromActive("session-1", { name: "Upper body" }),
    ).resolves.toBeUndefined();
    await expect(database?.workoutTemplates.count()).resolves.toBe(0);
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
      effortRating: 3,
    });

    expect(snapshot?.session.exercises[0]?.sets[0]).toMatchObject({
      id: "set-1",
      reps: 10,
      restSeconds: 90,
      weight: 82.5,
      weightUnit: "kg",
      effortRating: 3,
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
        durationSeconds: null,
        weight: 80,
        weightUnit: "kg",
        isCompleted: true,
        completedAt: "2026-05-07T11:08:00.000Z",
        restSeconds: 120,
        effortRating: null,
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

  it("lists finished workout sessions newest first", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
    });

    await database?.workoutSessions.bulkAdd([
      {
        id: "session-old",
        templateId: null,
        name: "Old lift",
        status: "finished",
        exercises: [],
        notes: null,
        startedAt: "2026-05-07T09:00:00.000Z",
        finishedAt: "2026-05-07T09:30:00.000Z",
        createdAt: "2026-05-07T09:00:00.000Z",
        updatedAt: "2026-05-07T09:30:00.000Z",
      },
      {
        id: "session-active",
        templateId: null,
        name: "Current lift",
        status: "active",
        exercises: [],
        notes: null,
        startedAt: "2026-05-07T10:00:00.000Z",
        finishedAt: null,
        createdAt: "2026-05-07T10:00:00.000Z",
        updatedAt: "2026-05-07T10:00:00.000Z",
      },
      {
        id: "session-new",
        templateId: null,
        name: "New lift",
        status: "finished",
        exercises: [],
        notes: null,
        startedAt: "2026-05-07T11:00:00.000Z",
        finishedAt: "2026-05-07T11:45:00.000Z",
        createdAt: "2026-05-07T11:00:00.000Z",
        updatedAt: "2026-05-07T11:45:00.000Z",
      },
    ]);

    await expect(repository.listFinished()).resolves.toMatchObject([
      {
        id: "session-new",
      },
      {
        id: "session-old",
      },
    ]);
    await expect(repository.listFinished(1)).resolves.toMatchObject([
      {
        id: "session-new",
      },
    ]);
  });

  it("deletes a finished workout session", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
    });

    await database?.workoutSessions.add({
      id: "session-finished",
      templateId: null,
      name: "Finished lift",
      status: "finished",
      exercises: [],
      notes: null,
      startedAt: "2026-05-07T11:00:00.000Z",
      finishedAt: "2026-05-07T11:30:00.000Z",
      createdAt: "2026-05-07T11:00:00.000Z",
      updatedAt: "2026-05-07T11:30:00.000Z",
    });

    await expect(repository.deleteFinished("session-finished")).resolves.toBe(true);
    await expect(database?.workoutSessions.get("session-finished")).resolves.toBeUndefined();
  });

  it("does not delete an active workout through the finished history API", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["session-active"]),
      now: createTimestampFactory(["2026-05-07T11:00:00.000Z"]),
    });

    await repository.startEmpty({ name: "Current lift" });

    await expect(repository.deleteFinished("session-active")).resolves.toBe(false);
    await expect(database?.workoutSessions.get("session-active")).resolves.toMatchObject({
      id: "session-active",
      status: "active",
    });
    await expect(database?.activeWorkout.get(activeWorkoutId)).resolves.toMatchObject({
      sessionId: "session-active",
    });
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

  it("updates exercise confidence in the same transaction that finishes the workout", async () => {
    const repository = createWorkoutSessionRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["session-1"]),
      now: createTimestampFactory(["2026-05-07T11:00:00.000Z", "2026-05-07T11:45:00.000Z"]),
    });

    await database?.exercises.bulkAdd([
      {
        id: "exercise-a",
        name: "Bench press",
        muscleGroups: ["chest"],
        equipment: "Barbell",
        trackingMode: "weighted",
        confidenceRating: 2,
        notes: null,
        createdAt: "2026-05-07T10:00:00.000Z",
        updatedAt: "2026-05-07T10:00:00.000Z",
      },
      {
        id: "exercise-b",
        name: "Triceps extension",
        muscleGroups: ["triceps"],
        equipment: "Cable",
        trackingMode: "weighted",
        confidenceRating: null,
        notes: null,
        createdAt: "2026-05-07T10:00:00.000Z",
        updatedAt: "2026-05-07T10:00:00.000Z",
      },
    ]);
    await database?.workoutTemplates.add(createWorkoutTemplate());
    await repository.startFromTemplate("template-1");

    const session = await repository.finishActive({
      confidenceRatings: {
        "exercise-a": 5,
        "exercise-b": 3,
      },
    });

    expect(session).toMatchObject({ id: "session-1", status: "finished" });
    await expect(database?.exercises.get("exercise-a")).resolves.toMatchObject({
      confidenceRating: 5,
      updatedAt: "2026-05-07T11:45:00.000Z",
    });
    await expect(database?.exercises.get("exercise-b")).resolves.toMatchObject({
      confidenceRating: 3,
      updatedAt: "2026-05-07T11:45:00.000Z",
    });
    await expect(database?.activeWorkout.get(activeWorkoutId)).resolves.toBeUndefined();
  });
});
