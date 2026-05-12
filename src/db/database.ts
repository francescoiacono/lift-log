import Dexie, { type EntityTable } from "dexie";

import type {
  ActiveWorkout,
  AppSettings,
  Exercise,
  WorkoutSession,
  WorkoutTemplate,
} from "./entities";

/** IndexedDB database name used by the app. */
export const databaseName = "lift-log";

/** Current Dexie schema version for the app database. */
export const databaseVersion = 2;

/** Singleton settings record id. */
export const appSettingsId = "app" satisfies AppSettings["id"];

/** Singleton active workout record id. */
export const activeWorkoutId = "current" satisfies ActiveWorkout["id"];

/** Dexie store definitions for the first schema version. */
const schemaV1 = {
  exercises: "id, name, *muscleGroups, equipment, createdAt, updatedAt",
  workoutTemplates: "id, name, createdAt, updatedAt",
  workoutSessions: "id, status, templateId, startedAt, finishedAt, updatedAt",
  settings: "id, updatedAt",
  activeWorkout: "id, sessionId, updatedAt",
};

/** Dexie store definitions for the second schema version. */
const schemaV2 = schemaV1;

/** Typed Dexie database containing all local-first app stores. */
export type LiftLogDatabase = Dexie & {
  /** Exercise definitions used by templates and sessions. */
  exercises: EntityTable<Exercise, "id">;

  /** Reusable workout templates. */
  workoutTemplates: EntityTable<WorkoutTemplate, "id">;

  /** Active, finished, and discarded workout sessions. */
  workoutSessions: EntityTable<WorkoutSession, "id">;

  /** Device-local app settings. */
  settings: EntityTable<AppSettings, "id">;

  /** Pointer and transient state for the current active workout. */
  activeWorkout: EntityTable<ActiveWorkout, "id">;
};

/** Adds default planning fields to workout session exercises created before schema version 2. */
const migrateWorkoutSessionExercisePlans = (workoutSession: WorkoutSession): void => {
  workoutSession.exercises = workoutSession.exercises.map((exercise) => ({
    ...exercise,
    restSeconds: exercise.restSeconds ?? null,
    targetSets: exercise.targetSets ?? null,
  }));
};

/** Creates a typed Dexie database instance with the current schema applied. */
export const createLiftLogDatabase = (name = databaseName): LiftLogDatabase => {
  const database = new Dexie(name) as LiftLogDatabase;

  database.version(1).stores(schemaV1);
  database
    .version(2)
    .stores(schemaV2)
    .upgrade(async (transaction) => {
      await transaction
        .table("workoutSessions")
        .toCollection()
        .modify((workoutSession) => migrateWorkoutSessionExercisePlans(workoutSession));
    });

  return database;
};

export const db = createLiftLogDatabase();
