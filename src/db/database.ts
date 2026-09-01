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
export const databaseVersion = 3;

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

/** Dexie store definitions for the third schema version. */
const schemaV3 = schemaV2;

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

/** Adds insight preferences to settings records created before schema version 3. */
const migrateAppSettingsInsights = (settings: AppSettings): void => {
  settings.weeklyWorkoutTarget ??= 3;
};

/** Adds exercise progress semantics to records created before schema version 3. */
const migrateExerciseProgressSemantics = (exercise: Exercise): void => {
  exercise.tracksAssistance = exercise.tracksDuration
    ? false
    : (exercise.tracksAssistance ?? false);
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
  database
    .version(3)
    .stores(schemaV3)
    .upgrade(async (transaction) => {
      await Promise.all([
        transaction
          .table("settings")
          .toCollection()
          .modify((settings) => migrateAppSettingsInsights(settings)),
        transaction
          .table("exercises")
          .toCollection()
          .modify((exercise) => migrateExerciseProgressSemantics(exercise)),
      ]);
    });

  return database;
};

export const db = createLiftLogDatabase();
