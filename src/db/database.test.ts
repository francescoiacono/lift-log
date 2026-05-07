import "fake-indexeddb/auto";

import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";

import {
  activeWorkoutId,
  appSettingsId,
  createLiftLogDatabase,
  databaseVersion,
  type LiftLogDatabase,
} from "./database";
import type {
  ActiveWorkout,
  AppSettings,
  Exercise,
  WorkoutSession,
  WorkoutTemplate,
} from "./entities";

let databaseIndex = 0;
let databases: LiftLogDatabase[] = [];
let databaseNames = new Set<string>();

/** Creates an isolated database name for persistence tests. */
const createTestDatabaseName = () => {
  databaseIndex += 1;

  return `lift-log-database-test-${databaseIndex}`;
};

/** Creates a test database and tracks it for cleanup. */
const createTestDatabase = (name = createTestDatabaseName()) => {
  const database = createLiftLogDatabase(name);

  databases.push(database);
  databaseNames.add(name);

  return database;
};

const timestamp = "2026-05-07T10:00:00.000Z";

const exercise = {
  id: "exercise-1",
  name: "Bench Press",
  muscleGroups: ["chest", "triceps"],
  equipment: "barbell",
  notes: null,
  createdAt: timestamp,
  updatedAt: timestamp,
} satisfies Exercise;

const workoutTemplate = {
  id: "template-1",
  name: "Push",
  exercises: [
    {
      exerciseId: exercise.id,
      order: 0,
      targetSets: 3,
      restSeconds: 120,
      notes: null,
    },
  ],
  createdAt: timestamp,
  updatedAt: timestamp,
} satisfies WorkoutTemplate;

const workoutSession = {
  id: "session-1",
  templateId: workoutTemplate.id,
  name: "Push",
  status: "finished",
  exercises: [
    {
      exerciseId: exercise.id,
      order: 0,
      sets: [
        {
          id: "set-1",
          order: 0,
          reps: 8,
          weight: 100,
          weightUnit: "kg",
          isCompleted: true,
          completedAt: timestamp,
          restSeconds: 120,
          notes: null,
        },
      ],
      notes: null,
    },
  ],
  notes: null,
  startedAt: timestamp,
  finishedAt: "2026-05-07T11:00:00.000Z",
  createdAt: timestamp,
  updatedAt: timestamp,
} satisfies WorkoutSession;

const appSettings = {
  id: appSettingsId,
  weightUnit: "kg",
  defaultRestSeconds: 120,
  createdAt: timestamp,
  updatedAt: timestamp,
} satisfies AppSettings;

const activeWorkout = {
  id: activeWorkoutId,
  sessionId: workoutSession.id,
  restTimer: {
    startedAt: timestamp,
    durationSeconds: 120,
    endsAt: "2026-05-07T10:02:00.000Z",
    relatedSetId: "set-1",
  },
  startedAt: timestamp,
  updatedAt: timestamp,
} satisfies ActiveWorkout;

afterEach(async () => {
  for (const database of databases) {
    database.close();
  }

  await Promise.all([...databaseNames].map((name) => Dexie.delete(name)));

  databases = [];
  databaseNames = new Set<string>();
});

describe("createLiftLogDatabase", () => {
  it("opens schema version 1 with expected stores and indexes", async () => {
    const database = createTestDatabase();

    await database.open();

    const tableSchemas = Object.fromEntries(
      database.tables.map((table) => [
        table.name,
        {
          primaryKey: table.schema.primKey.keyPath,
          indexes: table.schema.indexes.map((index) => ({
            name: index.name,
            multi: index.multi,
          })),
        },
      ]),
    );

    expect(database.verno).toBe(databaseVersion);
    expect(tableSchemas).toEqual({
      exercises: {
        primaryKey: "id",
        indexes: [
          { name: "name", multi: false },
          { name: "muscleGroups", multi: true },
          { name: "equipment", multi: false },
          { name: "createdAt", multi: false },
          { name: "updatedAt", multi: false },
        ],
      },
      workoutTemplates: {
        primaryKey: "id",
        indexes: [
          { name: "name", multi: false },
          { name: "createdAt", multi: false },
          { name: "updatedAt", multi: false },
        ],
      },
      workoutSessions: {
        primaryKey: "id",
        indexes: [
          { name: "status", multi: false },
          { name: "templateId", multi: false },
          { name: "startedAt", multi: false },
          { name: "finishedAt", multi: false },
          { name: "updatedAt", multi: false },
        ],
      },
      settings: {
        primaryKey: "id",
        indexes: [{ name: "updatedAt", multi: false }],
      },
      activeWorkout: {
        primaryKey: "id",
        indexes: [
          { name: "sessionId", multi: false },
          { name: "updatedAt", multi: false },
        ],
      },
    });
  });

  it("persists representative records in every store", async () => {
    const database = createTestDatabase();

    await database.exercises.add(exercise);
    await database.workoutTemplates.add(workoutTemplate);
    await database.workoutSessions.add(workoutSession);
    await database.settings.add(appSettings);
    await database.activeWorkout.add(activeWorkout);

    await expect(database.exercises.get(exercise.id)).resolves.toEqual(exercise);
    await expect(database.workoutTemplates.get(workoutTemplate.id)).resolves.toEqual(
      workoutTemplate,
    );
    await expect(database.workoutSessions.get(workoutSession.id)).resolves.toEqual(workoutSession);
    await expect(database.settings.get(appSettingsId)).resolves.toEqual(appSettings);
    await expect(database.activeWorkout.get(activeWorkoutId)).resolves.toEqual(activeWorkout);
    await expect(
      database.exercises.where("muscleGroups").equals("chest").toArray(),
    ).resolves.toEqual([exercise]);
    await expect(
      database.workoutSessions.where("status").equals("finished").toArray(),
    ).resolves.toEqual([workoutSession]);
  });

  it("keeps persisted records available after reopening the database", async () => {
    const databaseName = createTestDatabaseName();
    const firstDatabase = createTestDatabase(databaseName);

    await firstDatabase.exercises.add(exercise);
    firstDatabase.close();

    const reopenedDatabase = createTestDatabase(databaseName);

    await expect(reopenedDatabase.exercises.get(exercise.id)).resolves.toEqual(exercise);
  });
});
