import { activeWorkoutId, db as defaultDatabase, type LiftLogDatabase } from "../database";
import type {
  ActiveRestTimer,
  ActiveWorkout,
  EntityId,
  IsoDateTime,
  WeightUnit,
  WorkoutSet,
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutTemplateExercise,
} from "../entities";
import { createEntityId, createIsoDateTime } from "../persistence-utils";

/** Snapshot of the active workout pointer and its session record. */
export type ActiveWorkoutSnapshot = {
  /** Persisted active workout pointer. */
  activeWorkout: ActiveWorkout;

  /** Persisted workout session currently in progress. */
  session: WorkoutSession;
};

/** Data used to create an empty active workout session. */
export type StartEmptyWorkoutInput = {
  /** Optional display name for the workout session. */
  name?: string | null;
};

/** Data used to append a completed set to an active workout exercise. */
export type LogWorkoutSetInput = {
  /** Repetition count completed for the set. */
  reps: number | null;

  /** Weight used for the set. */
  weight?: number | null;

  /** Unit used for the logged weight. */
  weightUnit?: WeightUnit;

  /** Rest duration planned after the set. */
  restSeconds?: number | null;

  /** Optional notes for the logged set. */
  notes?: string | null;
};

/** Data used to edit a completed set in an active workout exercise. */
export type UpdateWorkoutSetInput = {
  /** Repetition count completed for the set. */
  reps: number | null;

  /** Weight used for the set. */
  weight?: number | null;

  /** Unit used for the logged weight. */
  weightUnit?: WeightUnit;

  /** Rest duration planned after the set. */
  restSeconds?: number | null;

  /** Optional notes for the logged set. */
  notes?: string | null;
};

/** Dependency overrides used to create a workout session repository instance. */
export type WorkoutSessionRepositoryOptions = {
  /** Dexie database instance used by repository operations. */
  database?: LiftLogDatabase;

  /** Identifier factory used when creating records. */
  createId?: () => EntityId;

  /** Timestamp factory used when creating or updating records. */
  now?: () => IsoDateTime;
};

/** Persistence operations for workout sessions and the active workout pointer. */
export type WorkoutSessionRepository = {
  /** Returns the current active workout session, if one exists. */
  getActive: () => Promise<ActiveWorkoutSnapshot | undefined>;

  /** Lists recently finished workout sessions. */
  listFinished: (limit?: number) => Promise<WorkoutSession[]>;

  /** Starts an empty active workout session. */
  startEmpty: (input?: StartEmptyWorkoutInput) => Promise<ActiveWorkoutSnapshot>;

  /** Starts an active workout session from a saved workout template. */
  startFromTemplate: (templateId: EntityId) => Promise<ActiveWorkoutSnapshot | undefined>;

  /** Adds an exercise to the current active workout session. */
  addExercise: (
    sessionId: EntityId,
    exerciseId: EntityId,
  ) => Promise<ActiveWorkoutSnapshot | undefined>;

  /** Logs a completed set against an exercise in an active workout session. */
  logSet: (
    sessionId: EntityId,
    exerciseId: EntityId,
    input: LogWorkoutSetInput,
  ) => Promise<WorkoutSession | undefined>;

  /** Updates a completed set in an active workout session. */
  updateSet: (
    sessionId: EntityId,
    exerciseId: EntityId,
    setId: EntityId,
    input: UpdateWorkoutSetInput,
  ) => Promise<ActiveWorkoutSnapshot | undefined>;

  /** Deletes a completed set from an active workout session. */
  deleteSet: (
    sessionId: EntityId,
    exerciseId: EntityId,
    setId: EntityId,
  ) => Promise<ActiveWorkoutSnapshot | undefined>;

  /** Clears the active rest timer for the current workout session. */
  clearRestTimer: (sessionId: EntityId) => Promise<ActiveWorkoutSnapshot | undefined>;

  /** Marks the active workout session as finished and clears the active pointer. */
  finishActive: () => Promise<WorkoutSession | undefined>;

  /** Marks the active workout session as discarded and clears the active pointer. */
  discardActive: () => Promise<WorkoutSession | undefined>;
};

/** Converts an optional session name into the nullable persisted shape. */
const normalizeSessionName = (value: string | null | undefined): string | null => {
  const trimmedValue = value?.trim();

  return trimmedValue ? trimmedValue : null;
};

/** Converts optional text into the nullable persisted shape. */
const normalizeOptionalText = (value: string | null | undefined): string | null => {
  const trimmedValue = value?.trim();

  return trimmedValue ? trimmedValue : null;
};

/** Converts template exercise entries into empty workout session exercise blocks. */
const createSessionExerciseBlocks = (
  exercises: WorkoutTemplateExercise[],
): WorkoutSessionExercise[] => {
  return [...exercises]
    .sort((first, second) => first.order - second.order)
    .map((exercise, index) => ({
      exerciseId: exercise.exerciseId,
      notes: exercise.notes,
      order: index,
      restSeconds: exercise.restSeconds,
      sets: [],
      targetSets: exercise.targetSets,
    }));
};

/** Creates the singleton active workout pointer for a session. */
const createActiveWorkout = (sessionId: EntityId, timestamp: IsoDateTime): ActiveWorkout => {
  return {
    id: activeWorkoutId,
    restTimer: null,
    sessionId,
    startedAt: timestamp,
    updatedAt: timestamp,
  };
};

/** Creates a completed workout set for an active session exercise. */
const createCompletedWorkoutSet = (
  input: LogWorkoutSetInput,
  order: number,
  timestamp: IsoDateTime,
  createId: () => EntityId,
): WorkoutSet => {
  return {
    id: createId(),
    order,
    reps: input.reps,
    weight: input.weight ?? null,
    weightUnit: input.weightUnit ?? "kg",
    isCompleted: true,
    completedAt: timestamp,
    restSeconds: input.restSeconds ?? null,
    notes: normalizeOptionalText(input.notes),
  };
};

/** Applies editable fields to an existing completed workout set. */
const updateCompletedWorkoutSet = (set: WorkoutSet, input: UpdateWorkoutSetInput): WorkoutSet => {
  return {
    ...set,
    reps: input.reps,
    weight: input.weight ?? null,
    weightUnit: input.weightUnit ?? set.weightUnit,
    restSeconds: input.restSeconds ?? null,
    notes: normalizeOptionalText(input.notes),
  };
};

/** Adds a number of seconds to an ISO timestamp. */
const addSecondsToTimestamp = (timestamp: IsoDateTime, seconds: number): IsoDateTime => {
  return new Date(new Date(timestamp).getTime() + seconds * 1000).toISOString();
};

/** Creates a persisted rest timer from the logged set rest duration. */
const createRestTimer = (
  restSeconds: number | null | undefined,
  relatedSetId: EntityId,
  timestamp: IsoDateTime,
): ActiveRestTimer | null => {
  if (!restSeconds || restSeconds <= 0) {
    return null;
  }

  return {
    startedAt: timestamp,
    durationSeconds: restSeconds,
    endsAt: addSecondsToTimestamp(timestamp, restSeconds),
    relatedSetId,
  };
};

/** Returns the active session and removes stale pointers to missing or closed sessions. */
const getActiveSnapshot = async (
  database: LiftLogDatabase,
): Promise<ActiveWorkoutSnapshot | undefined> => {
  const activeWorkout = await database.activeWorkout.get(activeWorkoutId);

  if (!activeWorkout) {
    return undefined;
  }

  const session = await database.workoutSessions.get(activeWorkout.sessionId);

  if (!session || session.status !== "active") {
    await database.activeWorkout.delete(activeWorkoutId);

    return undefined;
  }

  return { activeWorkout, session };
};

/** Creates a typed workout session repository using the provided persistence dependencies. */
export const createWorkoutSessionRepository = ({
  database = defaultDatabase,
  createId = createEntityId,
  now = createIsoDateTime,
}: WorkoutSessionRepositoryOptions = {}): WorkoutSessionRepository => {
  return {
    /** Returns the current active workout session, if one exists. */
    getActive: async () => {
      return getActiveSnapshot(database);
    },

    /** Lists recently finished workout sessions. */
    listFinished: async (limit = 10) => {
      const workoutSessions = await database.workoutSessions
        .where("status")
        .equals("finished")
        .toArray();

      return workoutSessions
        .sort((firstSession, secondSession) => {
          return (
            new Date(secondSession.startedAt).getTime() - new Date(firstSession.startedAt).getTime()
          );
        })
        .slice(0, limit);
    },

    /** Starts an empty active workout session. */
    startEmpty: async (input = {}) => {
      return database.transaction(
        "rw",
        database.workoutSessions,
        database.activeWorkout,
        async () => {
          const existingWorkout = await getActiveSnapshot(database);

          if (existingWorkout) {
            return existingWorkout;
          }

          const timestamp = now();
          const workoutSession: WorkoutSession = {
            id: createId(),
            templateId: null,
            name: normalizeSessionName(input.name),
            status: "active",
            exercises: [],
            notes: null,
            startedAt: timestamp,
            finishedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          const activeWorkout = createActiveWorkout(workoutSession.id, timestamp);

          await database.workoutSessions.add(workoutSession);
          await database.activeWorkout.put(activeWorkout);

          return { activeWorkout, session: workoutSession };
        },
      );
    },

    /** Starts an active workout session from a saved workout template. */
    startFromTemplate: async (templateId) => {
      return database.transaction(
        "rw",
        database.workoutTemplates,
        database.workoutSessions,
        database.activeWorkout,
        async () => {
          const existingWorkout = await getActiveSnapshot(database);

          if (existingWorkout) {
            return existingWorkout;
          }

          const workoutTemplate = await database.workoutTemplates.get(templateId);

          if (!workoutTemplate) {
            return undefined;
          }

          const timestamp = now();
          const workoutSession: WorkoutSession = {
            id: createId(),
            templateId: workoutTemplate.id,
            name: workoutTemplate.name,
            status: "active",
            exercises: createSessionExerciseBlocks(workoutTemplate.exercises),
            notes: null,
            startedAt: timestamp,
            finishedAt: null,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          const activeWorkout = createActiveWorkout(workoutSession.id, timestamp);

          await database.workoutSessions.add(workoutSession);
          await database.activeWorkout.put(activeWorkout);

          return { activeWorkout, session: workoutSession };
        },
      );
    },

    /** Adds an exercise to the current active workout session. */
    addExercise: async (sessionId, exerciseId) => {
      return database.transaction(
        "rw",
        database.exercises,
        database.workoutSessions,
        database.activeWorkout,
        async () => {
          const activeWorkout = await getActiveSnapshot(database);

          if (!activeWorkout || activeWorkout.session.id !== sessionId) {
            return undefined;
          }

          const exerciseExists = await database.exercises.get(exerciseId);

          if (!exerciseExists) {
            return undefined;
          }

          if (
            activeWorkout.session.exercises.some((exercise) => exercise.exerciseId === exerciseId)
          ) {
            return activeWorkout;
          }

          const timestamp = now();
          const workoutSession: WorkoutSession = {
            ...activeWorkout.session,
            exercises: [
              ...activeWorkout.session.exercises,
              {
                exerciseId,
                notes: null,
                order: activeWorkout.session.exercises.length,
                restSeconds: null,
                sets: [],
                targetSets: null,
              },
            ],
            updatedAt: timestamp,
          };
          const updatedActiveWorkout: ActiveWorkout = {
            ...activeWorkout.activeWorkout,
            updatedAt: timestamp,
          };

          await database.workoutSessions.put(workoutSession);
          await database.activeWorkout.put(updatedActiveWorkout);

          return {
            activeWorkout: updatedActiveWorkout,
            session: workoutSession,
          };
        },
      );
    },

    /** Logs a completed set against an exercise in an active workout session. */
    logSet: async (sessionId, exerciseId, input) => {
      return database.transaction(
        "rw",
        database.workoutSessions,
        database.activeWorkout,
        async () => {
          const existingWorkoutSession = await database.workoutSessions.get(sessionId);

          if (!existingWorkoutSession || existingWorkoutSession.status !== "active") {
            return undefined;
          }

          const exerciseIndex = existingWorkoutSession.exercises.findIndex(
            (exercise) => exercise.exerciseId === exerciseId,
          );

          if (exerciseIndex === -1) {
            return undefined;
          }

          const timestamp = now();
          const targetExercise = existingWorkoutSession.exercises[exerciseIndex];
          const loggedSet = createCompletedWorkoutSet(
            input,
            targetExercise?.sets.length ?? 0,
            timestamp,
            createId,
          );
          const exercises = existingWorkoutSession.exercises.map((exercise, index) =>
            index === exerciseIndex
              ? {
                  ...exercise,
                  sets: [...exercise.sets, loggedSet],
                }
              : exercise,
          );

          const workoutSession: WorkoutSession = {
            ...existingWorkoutSession,
            exercises,
            updatedAt: timestamp,
          };
          const activeWorkout = await database.activeWorkout.get(activeWorkoutId);

          await database.workoutSessions.put(workoutSession);

          if (activeWorkout?.sessionId === sessionId) {
            await database.activeWorkout.put({
              ...activeWorkout,
              restTimer: createRestTimer(input.restSeconds, loggedSet.id, timestamp),
              updatedAt: timestamp,
            });
          }

          return workoutSession;
        },
      );
    },

    /** Updates a completed set in an active workout session. */
    updateSet: async (sessionId, exerciseId, setId, input) => {
      return database.transaction(
        "rw",
        database.workoutSessions,
        database.activeWorkout,
        async () => {
          const activeWorkout = await getActiveSnapshot(database);

          if (!activeWorkout || activeWorkout.session.id !== sessionId) {
            return undefined;
          }

          const exerciseIndex = activeWorkout.session.exercises.findIndex(
            (exercise) => exercise.exerciseId === exerciseId,
          );

          if (exerciseIndex === -1) {
            return undefined;
          }

          const targetExercise = activeWorkout.session.exercises[exerciseIndex];
          const setIndex = targetExercise?.sets.findIndex((set) => set.id === setId) ?? -1;

          if (!targetExercise || setIndex === -1) {
            return undefined;
          }

          const timestamp = now();
          const existingSet = targetExercise.sets[setIndex];
          const updatedSet = updateCompletedWorkoutSet(existingSet, input);
          const exercises = activeWorkout.session.exercises.map((exercise, index) =>
            index === exerciseIndex
              ? {
                  ...exercise,
                  sets: exercise.sets.map((set) => (set.id === setId ? updatedSet : set)),
                }
              : exercise,
          );
          const workoutSession: WorkoutSession = {
            ...activeWorkout.session,
            exercises,
            updatedAt: timestamp,
          };
          const currentRestTimer = activeWorkout.activeWorkout.restTimer;
          const updatedActiveWorkout: ActiveWorkout = {
            ...activeWorkout.activeWorkout,
            restTimer:
              currentRestTimer?.relatedSetId === setId &&
              existingSet.restSeconds !== updatedSet.restSeconds
                ? createRestTimer(updatedSet.restSeconds, setId, timestamp)
                : currentRestTimer,
            updatedAt: timestamp,
          };

          await database.workoutSessions.put(workoutSession);
          await database.activeWorkout.put(updatedActiveWorkout);

          return {
            activeWorkout: updatedActiveWorkout,
            session: workoutSession,
          };
        },
      );
    },

    /** Deletes a completed set from an active workout session. */
    deleteSet: async (sessionId, exerciseId, setId) => {
      return database.transaction(
        "rw",
        database.workoutSessions,
        database.activeWorkout,
        async () => {
          const activeWorkout = await getActiveSnapshot(database);

          if (!activeWorkout || activeWorkout.session.id !== sessionId) {
            return undefined;
          }

          const exerciseIndex = activeWorkout.session.exercises.findIndex(
            (exercise) => exercise.exerciseId === exerciseId,
          );

          if (exerciseIndex === -1) {
            return undefined;
          }

          const targetExercise = activeWorkout.session.exercises[exerciseIndex];

          if (!targetExercise?.sets.some((set) => set.id === setId)) {
            return undefined;
          }

          const timestamp = now();
          const exercises = activeWorkout.session.exercises.map((exercise, index) =>
            index === exerciseIndex
              ? {
                  ...exercise,
                  sets: exercise.sets
                    .filter((set) => set.id !== setId)
                    .map((set, order) => ({
                      ...set,
                      order,
                    })),
                }
              : exercise,
          );
          const workoutSession: WorkoutSession = {
            ...activeWorkout.session,
            exercises,
            updatedAt: timestamp,
          };
          const updatedActiveWorkout: ActiveWorkout = {
            ...activeWorkout.activeWorkout,
            restTimer:
              activeWorkout.activeWorkout.restTimer?.relatedSetId === setId
                ? null
                : activeWorkout.activeWorkout.restTimer,
            updatedAt: timestamp,
          };

          await database.workoutSessions.put(workoutSession);
          await database.activeWorkout.put(updatedActiveWorkout);

          return {
            activeWorkout: updatedActiveWorkout,
            session: workoutSession,
          };
        },
      );
    },

    /** Clears the active rest timer for the current workout session. */
    clearRestTimer: async (sessionId) => {
      return database.transaction(
        "rw",
        database.workoutSessions,
        database.activeWorkout,
        async () => {
          const activeWorkout = await getActiveSnapshot(database);

          if (!activeWorkout || activeWorkout.session.id !== sessionId) {
            return undefined;
          }

          const timestamp = now();
          const updatedActiveWorkout: ActiveWorkout = {
            ...activeWorkout.activeWorkout,
            restTimer: null,
            updatedAt: timestamp,
          };

          await database.activeWorkout.put(updatedActiveWorkout);

          return {
            activeWorkout: updatedActiveWorkout,
            session: activeWorkout.session,
          };
        },
      );
    },

    /** Marks the active workout session as finished and clears the active pointer. */
    finishActive: async () => {
      return database.transaction(
        "rw",
        database.workoutSessions,
        database.activeWorkout,
        async () => {
          const activeWorkout = await getActiveSnapshot(database);

          if (!activeWorkout) {
            return undefined;
          }

          const timestamp = now();
          const workoutSession: WorkoutSession = {
            ...activeWorkout.session,
            status: "finished",
            finishedAt: timestamp,
            updatedAt: timestamp,
          };

          await database.workoutSessions.put(workoutSession);
          await database.activeWorkout.delete(activeWorkoutId);

          return workoutSession;
        },
      );
    },

    /** Marks the active workout session as discarded and clears the active pointer. */
    discardActive: async () => {
      return database.transaction(
        "rw",
        database.workoutSessions,
        database.activeWorkout,
        async () => {
          const activeWorkout = await getActiveSnapshot(database);

          if (!activeWorkout) {
            return undefined;
          }

          const timestamp = now();
          const workoutSession: WorkoutSession = {
            ...activeWorkout.session,
            status: "discarded",
            finishedAt: timestamp,
            updatedAt: timestamp,
          };

          await database.workoutSessions.put(workoutSession);
          await database.activeWorkout.delete(activeWorkoutId);

          return workoutSession;
        },
      );
    },
  };
};

export const workoutSessionRepository = createWorkoutSessionRepository();
