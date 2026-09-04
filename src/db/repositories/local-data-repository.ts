import { databaseVersion, db as defaultDatabase, type LiftLogDatabase } from "../database";
import { normalizeExerciseTrackingMode, normalizeMuscleGroupIds } from "../exercise-semantics";
import type {
  ActiveWorkout,
  AppSettings,
  Exercise,
  ExerciseConfidenceRating,
  IsoDateTime,
  SetEffortRating,
  WorkoutSession,
  WorkoutTemplate,
} from "../entities";
import { createIsoDateTime } from "../persistence-utils";
import { normalizeWeeklyWorkoutTarget } from "./settings-repository";

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

/** Store fields on a local data export that must contain record arrays. */
const localDataExportStoreKeys = [
  "exercises",
  "workoutTemplates",
  "workoutSessions",
  "settings",
  "activeWorkout",
] as const satisfies readonly (keyof LocalDataExport)[];

/** Oldest export schema that can be normalized into the current data model. */
const minimumCompatibleDatabaseVersion = 2;

/** Exercise shape accepted from exports that predate canonical tracking modes. */
type CompatibleImportedExercise = Omit<Exercise, "confidenceRating" | "trackingMode"> & {
  /** Canonical mode when supplied by a current export. */
  trackingMode?: unknown;

  /** Confidence rating when supplied by a current export. */
  confidenceRating?: unknown;

  /** Older timed-exercise flag. */
  tracksDuration?: boolean;

  /** Older assisted-exercise flag. */
  tracksAssistance?: boolean;
};

/** Normalizes an untrusted exercise-confidence value into the supported five-point scale. */
const normalizeExerciseConfidenceRating = (value: unknown): ExerciseConfidenceRating | null => {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 ? value : null;
};

/** Normalizes an imported exercise into the current persistence model. */
const normalizeImportedExercise = (exercise: Exercise): Exercise => {
  const compatibleExercise = exercise as CompatibleImportedExercise;
  const { tracksAssistance, tracksDuration, ...currentFields } = compatibleExercise;

  return {
    ...currentFields,
    muscleGroups: normalizeMuscleGroupIds(compatibleExercise.muscleGroups),
    trackingMode: normalizeExerciseTrackingMode(compatibleExercise.trackingMode, {
      tracksAssistance,
      tracksDuration,
    }),
    confidenceRating: normalizeExerciseConfidenceRating(compatibleExercise.confidenceRating),
  } as Exercise;
};

/** Normalizes an untrusted perceived-effort value into the supported five-point scale. */
const normalizeSetEffortRating = (value: unknown): SetEffortRating | null => {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 ? value : null;
};

/** Normalizes imported workout sets that predate perceived-effort tracking. */
const normalizeImportedWorkoutSession = (workoutSession: WorkoutSession): WorkoutSession => {
  return {
    ...workoutSession,
    exercises: workoutSession.exercises.map((exercise) => ({
      ...exercise,
      sets: exercise.sets.map((set) => ({
        ...set,
        effortRating: normalizeSetEffortRating(set.effortRating),
      })),
    })),
  };
};

/** Checks that an untrusted store record is an object carrying a string id key. */
const hasStringId = (record: unknown): boolean => {
  return (
    typeof record === "object" &&
    record !== null &&
    typeof (record as { id?: unknown }).id === "string"
  );
};

/** Validates that an untrusted parsed value is a compatible local data export. */
const isLocalDataExport = (value: unknown): value is LocalDataExport => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  return (
    candidate.format === localDataExportFormat &&
    typeof candidate.databaseVersion === "number" &&
    candidate.databaseVersion >= minimumCompatibleDatabaseVersion &&
    candidate.databaseVersion <= databaseVersion &&
    // Every store must be an array of records that Dexie can key by a string id,
    // so a malformed file is rejected before the destructive clear+load runs.
    localDataExportStoreKeys.every(
      (key) => Array.isArray(candidate[key]) && (candidate[key] as unknown[]).every(hasStringId),
    )
  );
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

  /** Replaces all locally persisted user data with a previously exported snapshot. */
  importData: (data: unknown) => Promise<void>;

  /** Deletes all locally persisted user data while keeping the database schema available. */
  reset: () => Promise<void>;
};

/** Error thrown when an import file is not a compatible local data export. */
export class InvalidLocalDataImportError extends Error {
  constructor() {
    super("The selected file is not a compatible Lift Log export.");
    this.name = "InvalidLocalDataImportError";
  }
}

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

    /** Replaces all locally persisted user data with a previously exported snapshot. */
    importData: async (data) => {
      if (!isLocalDataExport(data)) {
        throw new InvalidLocalDataImportError();
      }

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
          // Replace-all: clear every store, then load the imported records atomically.
          await Promise.all([
            database.activeWorkout.clear(),
            database.exercises.clear(),
            database.settings.clear(),
            database.workoutSessions.clear(),
            database.workoutTemplates.clear(),
          ]);
          await Promise.all([
            database.activeWorkout.bulkPut(data.activeWorkout),
            database.exercises.bulkPut(data.exercises.map(normalizeImportedExercise)),
            database.settings.bulkPut(
              data.settings.map((settings) => ({
                ...settings,
                weeklyWorkoutTarget: normalizeWeeklyWorkoutTarget(settings.weeklyWorkoutTarget),
              })),
            ),
            database.workoutSessions.bulkPut(
              data.workoutSessions.map(normalizeImportedWorkoutSession),
            ),
            database.workoutTemplates.bulkPut(data.workoutTemplates),
          ]);
        },
      );
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
