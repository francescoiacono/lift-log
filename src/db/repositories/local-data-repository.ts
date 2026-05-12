import { db as defaultDatabase, type LiftLogDatabase } from "../database";

/** Dependency overrides used to create a local data repository instance. */
export type LocalDataRepositoryOptions = {
  /** Dexie database instance used by repository operations. */
  database?: LiftLogDatabase;
};

/** Operations for managing all local-first app data on this device. */
export type LocalDataRepository = {
  /** Deletes all locally persisted user data while keeping the database schema available. */
  reset: () => Promise<void>;
};

/** Creates a repository for device-local data management operations. */
export const createLocalDataRepository = ({
  database = defaultDatabase,
}: LocalDataRepositoryOptions = {}): LocalDataRepository => {
  return {
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
