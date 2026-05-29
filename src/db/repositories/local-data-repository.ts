import { databaseVersion, db as defaultDatabase, type LiftLogDatabase } from "../database";
import type {
  ActiveWorkout,
  AppSettings,
  Exercise,
  IsoDateTime,
  WorkoutSession,
  WorkoutTemplate,
} from "../entities";
import { createIsoDateTime } from "../persistence-utils";

/** Format marker used by Lift Log local data export files. */
export const localDataExportFormat = "lift-log.local-data-export";

/** Complete JSON-serializable snapshot of device-local Lift Log data. */
export type LocalDataExport = {
  /** Stable export format marker. */
  format: typeof localDataExportFormat;

  /** IndexedDB schema version used when the export was created. */
  databaseVersion: number;

  /** Timestamp for when the export file was created. */
  exportedAt: IsoDateTime;

  /** Persisted exercise definitions. */
  exercises: Exercise[];

  /** Persisted reusable workout templates. */
  workoutTemplates: WorkoutTemplate[];

  /** Persisted active, finished, and discarded workout sessions. */
  workoutSessions: WorkoutSession[];

  /** Persisted device-local app settings. */
  settings: AppSettings[];

  /** Persisted active workout pointer and rest timer state. */
  activeWorkout: ActiveWorkout[];
};

/** Dependency overrides used to create a local data repository instance. */
export type LocalDataRepositoryOptions = {
  /** Dexie database instance used by repository operations. */
  database?: LiftLogDatabase;

  /** Timestamp factory used when creating export metadata. */
  now?: () => IsoDateTime;
};

/** Operations for managing all local-first app data on this device. */
export type LocalDataRepository = {
  /** Exports all locally persisted user data as a JSON-serializable snapshot. */
  exportData: () => Promise<LocalDataExport>;

  /** Deletes all locally persisted user data while keeping the database schema available. */
  reset: () => Promise<void>;
};

/** Creates a repository for device-local data management operations. */
export const createLocalDataRepository = ({
  database = defaultDatabase,
  now = createIsoDateTime,
}: LocalDataRepositoryOptions = {}): LocalDataRepository => {
  return {
    /** Exports all locally persisted user data as a JSON-serializable snapshot. */
    exportData: async () => {
      const [activeWorkout, exercises, settings, workoutSessions, workoutTemplates] =
        await database.transaction(
          "r",
          [
            database.activeWorkout,
            database.exercises,
            database.settings,
            database.workoutSessions,
            database.workoutTemplates,
          ],
          async () => {
            return Promise.all([
              database.activeWorkout.toArray(),
              database.exercises.toArray(),
              database.settings.toArray(),
              database.workoutSessions.toArray(),
              database.workoutTemplates.toArray(),
            ]);
          },
        );

      return {
        format: localDataExportFormat,
        databaseVersion,
        exportedAt: now(),
        exercises,
        workoutTemplates,
        workoutSessions,
        settings,
        activeWorkout,
      };
    },

    /** Deletes all locally persisted user data while keeping the database schema available. */
    reset: async () => {
      await database.transaction(
        "rw",
        [
          database.activeWorkout,
          database.exercises,
          database.settings,
          database.workoutSessions,
          database.workoutTemplates,
        ],
        async () => {
          await Promise.all([
            database.activeWorkout.clear(),
            database.exercises.clear(),
            database.settings.clear(),
            database.workoutSessions.clear(),
            database.workoutTemplates.clear(),
          ]);
        },
      );
    },
  };
};

export const localDataRepository = createLocalDataRepository();
