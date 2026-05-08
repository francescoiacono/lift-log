import { db as defaultDatabase, type LiftLogDatabase } from "../database";
import type { EntityId, IsoDateTime, WorkoutTemplate, WorkoutTemplateExercise } from "../entities";
import { createEntityId, createIsoDateTime } from "../persistence-utils";

/** Data required to create a workout template record. */
export type CreateWorkoutTemplateInput = {
  /** User-facing workout template name. */
  name: string;

  /** Ordered exercise entries included in the template. */
  exercises: WorkoutTemplateExercise[];
};

/** Data allowed when updating an existing workout template record. */
export type UpdateWorkoutTemplateInput = {
  /** User-facing workout template name. */
  name?: string;

  /** Ordered exercise entries included in the template. */
  exercises?: WorkoutTemplateExercise[];
};

/** Dependency overrides used to create a workout template repository instance. */
export type WorkoutTemplateRepositoryOptions = {
  /** Dexie database instance used by repository operations. */
  database?: LiftLogDatabase;

  /** Identifier factory used when creating records. */
  createId?: () => EntityId;

  /** Timestamp factory used when creating or updating records. */
  now?: () => IsoDateTime;
};

/** CRUD operations for workout templates. */
export type WorkoutTemplateRepository = {
  /** Lists all workout templates ordered by display name. */
  list: () => Promise<WorkoutTemplate[]>;

  /** Finds a workout template by id. */
  getById: (id: EntityId) => Promise<WorkoutTemplate | undefined>;

  /** Creates a new workout template. */
  create: (input: CreateWorkoutTemplateInput) => Promise<WorkoutTemplate>;

  /** Updates an existing workout template, returning undefined when it does not exist. */
  update: (id: EntityId, input: UpdateWorkoutTemplateInput) => Promise<WorkoutTemplate | undefined>;

  /** Deletes a workout template by id. */
  deleteById: (id: EntityId) => Promise<void>;
};

/** Builds a partial workout template patch while ignoring omitted update fields. */
const toWorkoutTemplatePatch = (
  input: UpdateWorkoutTemplateInput,
): Partial<Pick<WorkoutTemplate, "exercises" | "name">> => {
  const patch: Partial<Pick<WorkoutTemplate, "exercises" | "name">> = {};

  if (input.name !== undefined) {
    patch.name = input.name;
  }

  if (input.exercises !== undefined) {
    patch.exercises = input.exercises;
  }

  return patch;
};

/** Creates a typed workout template repository using the provided persistence dependencies. */
export const createWorkoutTemplateRepository = ({
  database = defaultDatabase,
  createId = createEntityId,
  now = createIsoDateTime,
}: WorkoutTemplateRepositoryOptions = {}): WorkoutTemplateRepository => {
  return {
    /** Lists all workout templates ordered by display name. */
    list: async () => {
      return database.workoutTemplates.orderBy("name").toArray();
    },

    /** Finds a workout template by id. */
    getById: async (id) => {
      return database.workoutTemplates.get(id);
    },

    /** Creates a new workout template. */
    create: async (input) => {
      const timestamp = now();
      const workoutTemplate: WorkoutTemplate = {
        id: createId(),
        name: input.name,
        exercises: input.exercises,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await database.workoutTemplates.add(workoutTemplate);

      return workoutTemplate;
    },

    /** Updates an existing workout template, returning undefined when it does not exist. */
    update: async (id, input) => {
      const existingWorkoutTemplate = await database.workoutTemplates.get(id);

      if (!existingWorkoutTemplate) {
        return undefined;
      }

      const updatedWorkoutTemplate: WorkoutTemplate = {
        ...existingWorkoutTemplate,
        ...toWorkoutTemplatePatch(input),
        updatedAt: now(),
      };

      await database.workoutTemplates.put(updatedWorkoutTemplate);

      return updatedWorkoutTemplate;
    },

    /** Deletes a workout template by id. */
    deleteById: async (id) => {
      await database.workoutTemplates.delete(id);
    },
  };
};

export const workoutTemplateRepository = createWorkoutTemplateRepository();
