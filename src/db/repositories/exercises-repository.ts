import { db as defaultDatabase, type LiftLogDatabase } from "../database";
import type { EntityId, Exercise, IsoDateTime } from "../entities";
import { createEntityId, createIsoDateTime } from "../persistence-utils";

/** Data required to create an exercise record. */
export type CreateExerciseInput = {
  /** User-facing exercise name. */
  name: string;

  /** Muscle groups associated with the exercise. */
  muscleGroups: string[];

  /** Equipment required for the exercise, when any. */
  equipment?: string | null;

  /** Optional user notes for setup, cues, or substitutions. */
  notes?: string | null;
};

/** Data allowed when updating an existing exercise record. */
export type UpdateExerciseInput = {
  /** User-facing exercise name. */
  name?: string;

  /** Muscle groups associated with the exercise. */
  muscleGroups?: string[];

  /** Equipment required for the exercise, when any. */
  equipment?: string | null;

  /** Optional user notes for setup, cues, or substitutions. */
  notes?: string | null;
};

/** Dependency overrides used to create an exercise repository instance. */
export type ExerciseRepositoryOptions = {
  /** Dexie database instance used by repository operations. */
  database?: LiftLogDatabase;

  /** Identifier factory used when creating records. */
  createId?: () => EntityId;

  /** Timestamp factory used when creating or updating records. */
  now?: () => IsoDateTime;
};

/** CRUD operations for exercises. */
export type ExerciseRepository = {
  /** Lists all exercises ordered by display name. */
  list: () => Promise<Exercise[]>;

  /** Finds an exercise by id. */
  getById: (id: EntityId) => Promise<Exercise | undefined>;

  /** Creates a new exercise. */
  create: (input: CreateExerciseInput) => Promise<Exercise>;

  /** Updates an existing exercise, returning undefined when it does not exist. */
  update: (id: EntityId, input: UpdateExerciseInput) => Promise<Exercise | undefined>;

  /** Deletes an exercise by id. */
  deleteById: (id: EntityId) => Promise<void>;
};

/** Converts optional text input into the nullable shape stored in IndexedDB. */
const toNullableText = (value: string | null | undefined): string | null => {
  return value ?? null;
};

/** Builds a partial exercise patch while ignoring omitted update fields. */
const toExercisePatch = (
  input: UpdateExerciseInput,
): Partial<Pick<Exercise, "equipment" | "muscleGroups" | "name" | "notes">> => {
  const patch: Partial<Pick<Exercise, "equipment" | "muscleGroups" | "name" | "notes">> = {};

  if (input.name !== undefined) {
    patch.name = input.name;
  }

  if (input.muscleGroups !== undefined) {
    patch.muscleGroups = input.muscleGroups;
  }

  if (input.equipment !== undefined) {
    patch.equipment = input.equipment;
  }

  if (input.notes !== undefined) {
    patch.notes = input.notes;
  }

  return patch;
};

/** Creates a typed exercise repository using the provided persistence dependencies. */
export const createExerciseRepository = ({
  database = defaultDatabase,
  createId = createEntityId,
  now = createIsoDateTime,
}: ExerciseRepositoryOptions = {}): ExerciseRepository => {
  return {
    /** Lists all exercises ordered by display name. */
    list: async () => {
      return database.exercises.orderBy("name").toArray();
    },

    /** Finds an exercise by id. */
    getById: async (id) => {
      return database.exercises.get(id);
    },

    /** Creates a new exercise. */
    create: async (input) => {
      const timestamp = now();
      const exercise: Exercise = {
        id: createId(),
        name: input.name,
        muscleGroups: input.muscleGroups,
        equipment: toNullableText(input.equipment),
        notes: toNullableText(input.notes),
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await database.exercises.add(exercise);

      return exercise;
    },

    /** Updates an existing exercise, returning undefined when it does not exist. */
    update: async (id, input) => {
      const existingExercise = await database.exercises.get(id);

      if (!existingExercise) {
        return undefined;
      }

      const updatedExercise: Exercise = {
        ...existingExercise,
        ...toExercisePatch(input),
        updatedAt: now(),
      };

      await database.exercises.put(updatedExercise);

      return updatedExercise;
    },

    /** Deletes an exercise by id. */
    deleteById: async (id) => {
      await database.exercises.delete(id);
    },
  };
};

export const exerciseRepository = createExerciseRepository();
