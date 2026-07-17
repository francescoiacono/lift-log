import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import {
  activeWorkoutId,
  appSettingsId,
  createLiftLogDatabase,
  databaseVersion,
  type LiftLogDatabase,
} from "../database";
import type { Exercise, WorkoutSession, WorkoutTemplate } from "../entities";
import {
  createLocalDataRepository,
  InvalidLocalDataImportError,
  localDataExportFormat,
} from "./local-data-repository";

let database: LiftLogDatabase | undefined;
let databaseIndex = 0;

/** Creates an isolated test database for repository tests. */
const createTestDatabase = () => {
  databaseIndex += 1;
  database = createLiftLogDatabase(`lift-log-local-data-test-${databaseIndex}`);

  return database;
};

const exercise = {
  id: "exercise-1",
  name: "Bench press",
  muscleGroups: ["Chest"],
  equipment: "Barbell",
  notes: null,
  createdAt: "2026-05-07T10:00:00.000Z",
  updatedAt: "2026-05-07T10:00:00.000Z",
} satisfies Exercise;

const workoutTemplate = {
  id: "template-1",
  name: "Push",
  exercises: [],
  createdAt: "2026-05-07T10:00:00.000Z",
  updatedAt: "2026-05-07T10:00:00.000Z",
} satisfies WorkoutTemplate;

const workoutSession = {
  id: "session-1",
  templateId: null,
  name: "Quick workout",
  status: "active",
  exercises: [],
  notes: null,
  startedAt: "2026-05-07T10:00:00.000Z",
  finishedAt: null,
  createdAt: "2026-05-07T10:00:00.000Z",
  updatedAt: "2026-05-07T10:00:00.000Z",
} satisfies WorkoutSession;

afterEach(async () => {
  await database?.delete();
  database = undefined;
});

describe("createLocalDataRepository", () => {
  it("exports all local app data stores with metadata", async () => {
    const testDatabase = createTestDatabase();
    const repository = createLocalDataRepository({
      database: testDatabase,
      now: () => "2026-05-07T12:00:00.000Z",
    });
    const settings = {
      id: appSettingsId,
      weightUnit: "kg",
      defaultRestSeconds: 120,
      createdAt: "2026-05-07T10:00:00.000Z",
      updatedAt: "2026-05-07T10:00:00.000Z",
    } as const;
    const activeWorkout = {
      id: activeWorkoutId,
      sessionId: workoutSession.id,
      restTimer: null,
      startedAt: "2026-05-07T10:00:00.000Z",
      updatedAt: "2026-05-07T10:00:00.000Z",
    } as const;

    await Promise.all([
      testDatabase.exercises.add(exercise),
      testDatabase.workoutTemplates.add(workoutTemplate),
      testDatabase.workoutSessions.add(workoutSession),
      testDatabase.settings.add(settings),
      testDatabase.activeWorkout.add(activeWorkout),
    ]);

    await expect(repository.exportData()).resolves.toEqual({
      format: localDataExportFormat,
      databaseVersion,
      exportedAt: "2026-05-07T12:00:00.000Z",
      exercises: [exercise],
      workoutTemplates: [workoutTemplate],
      workoutSessions: [workoutSession],
      settings: [settings],
      activeWorkout: [activeWorkout],
    });
  });

  it("replaces all local app data with an imported snapshot", async () => {
    const testDatabase = createTestDatabase();
    const repository = createLocalDataRepository({
      database: testDatabase,
      now: () => "2026-05-07T12:00:00.000Z",
    });

    await testDatabase.exercises.add(exercise);
    await testDatabase.workoutTemplates.add(workoutTemplate);
    await testDatabase.workoutSessions.add(workoutSession);
    const snapshot = await repository.exportData();

    // Add data that is absent from the snapshot; import must remove it.
    await testDatabase.exercises.add({ ...exercise, id: "stale-exercise", name: "Old lift" });

    await repository.importData(snapshot);

    await expect(repository.exportData()).resolves.toEqual(snapshot);
    await expect(testDatabase.exercises.get("stale-exercise")).resolves.toBeUndefined();
  });

  it("rejects an incompatible import file without touching stored data", async () => {
    const testDatabase = createTestDatabase();
    const repository = createLocalDataRepository({ database: testDatabase });

    await testDatabase.exercises.add(exercise);

    await expect(repository.importData({ format: "something-else" })).rejects.toBeInstanceOf(
      InvalidLocalDataImportError,
    );
    await expect(testDatabase.exercises.count()).resolves.toBe(1);
  });

  it("rejects a file with malformed records before clearing stored data", async () => {
    const testDatabase = createTestDatabase();
    const repository = createLocalDataRepository({ database: testDatabase });

    await testDatabase.exercises.add(exercise);
    const snapshot = await repository.exportData();

    // Valid envelope, but a record is missing its string id: must fail before clearing.
    const corrupted = { ...snapshot, exercises: [{ name: "No id" }] };

    await expect(repository.importData(corrupted)).rejects.toBeInstanceOf(
      InvalidLocalDataImportError,
    );
    await expect(testDatabase.exercises.get(exercise.id)).resolves.toEqual(exercise);
  });

  it("clears all local app data stores", async () => {
    const testDatabase = createTestDatabase();
    const repository = createLocalDataRepository({ database: testDatabase });

    await Promise.all([
      testDatabase.exercises.add(exercise),
      testDatabase.workoutTemplates.add(workoutTemplate),
      testDatabase.workoutSessions.add(workoutSession),
      testDatabase.settings.add({
        id: appSettingsId,
        weightUnit: "kg",
        defaultRestSeconds: 120,
        createdAt: "2026-05-07T10:00:00.000Z",
        updatedAt: "2026-05-07T10:00:00.000Z",
      }),
      testDatabase.activeWorkout.add({
        id: activeWorkoutId,
        sessionId: workoutSession.id,
        restTimer: null,
        startedAt: "2026-05-07T10:00:00.000Z",
        updatedAt: "2026-05-07T10:00:00.000Z",
      }),
    ]);

    await repository.reset();

    await expect(testDatabase.exercises.count()).resolves.toBe(0);
    await expect(testDatabase.workoutTemplates.count()).resolves.toBe(0);
    await expect(testDatabase.workoutSessions.count()).resolves.toBe(0);
    await expect(testDatabase.settings.count()).resolves.toBe(0);
    await expect(testDatabase.activeWorkout.count()).resolves.toBe(0);
  });
});
