import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { createLiftLogDatabase, type LiftLogDatabase } from "../database";
import type { EntityId, IsoDateTime, WorkoutTemplateExercise } from "../entities";
import { createWorkoutTemplateRepository } from "./workout-templates-repository";

let database: LiftLogDatabase | undefined;
let databaseIndex = 0;

/** Creates an isolated test database for repository tests. */
const createTestDatabase = () => {
  databaseIndex += 1;
  database = createLiftLogDatabase(`lift-log-workout-template-test-${databaseIndex}`);

  return database;
};

/** Creates a deterministic id factory for repository tests. */
const createIdFactory = (ids: EntityId[]) => {
  let index = 0;

  return () => {
    const id = ids[index];

    if (!id) {
      throw new Error("Test id factory ran out of ids.");
    }

    index += 1;

    return id;
  };
};

/** Creates a deterministic timestamp factory for repository tests. */
const createTimestampFactory = (timestamps: IsoDateTime[]) => {
  let index = 0;

  return () => {
    const timestamp = timestamps[index];

    if (!timestamp) {
      throw new Error("Test timestamp factory ran out of timestamps.");
    }

    index += 1;

    return timestamp;
  };
};

const pushExercises = [
  {
    exerciseId: "exercise-1",
    order: 0,
    targetSets: 3,
    restSeconds: 120,
    notes: null,
  },
] satisfies WorkoutTemplateExercise[];

afterEach(async () => {
  await database?.delete();
  database = undefined;
});

describe("createWorkoutTemplateRepository", () => {
  it("creates workout templates with generated ids and timestamps", async () => {
    const repository = createWorkoutTemplateRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["template-1"]),
      now: createTimestampFactory(["2026-05-07T10:00:00.000Z"]),
    });

    const workoutTemplate = await repository.create({
      name: "Push",
      exercises: pushExercises,
    });

    expect(workoutTemplate).toEqual({
      id: "template-1",
      name: "Push",
      exercises: pushExercises,
      createdAt: "2026-05-07T10:00:00.000Z",
      updatedAt: "2026-05-07T10:00:00.000Z",
    });
    await expect(repository.getById("template-1")).resolves.toEqual(workoutTemplate);
  });

  it("lists workout templates ordered by name", async () => {
    const repository = createWorkoutTemplateRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["template-1", "template-2"]),
      now: createTimestampFactory(["2026-05-07T10:00:00.000Z", "2026-05-07T10:01:00.000Z"]),
    });

    await repository.create({ name: "Pull", exercises: [] });
    await repository.create({ name: "Legs", exercises: [] });

    await expect(repository.list()).resolves.toMatchObject([
      { id: "template-2", name: "Legs" },
      { id: "template-1", name: "Pull" },
    ]);
  });

  it("updates existing workout templates without changing createdAt", async () => {
    const repository = createWorkoutTemplateRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["template-1"]),
      now: createTimestampFactory(["2026-05-07T10:00:00.000Z", "2026-05-07T10:02:00.000Z"]),
    });

    await repository.create({
      name: "Upper",
      exercises: [],
    });

    const updatedExercises = [
      {
        exerciseId: "exercise-2",
        order: 0,
        targetSets: 4,
        restSeconds: 90,
        notes: "Start conservative.",
      },
    ] satisfies WorkoutTemplateExercise[];

    const updatedWorkoutTemplate = await repository.update("template-1", {
      name: "Upper Body",
      exercises: updatedExercises,
    });

    expect(updatedWorkoutTemplate).toMatchObject({
      id: "template-1",
      name: "Upper Body",
      exercises: updatedExercises,
      createdAt: "2026-05-07T10:00:00.000Z",
      updatedAt: "2026-05-07T10:02:00.000Z",
    });
  });

  it("returns undefined when updating a missing workout template", async () => {
    const repository = createWorkoutTemplateRepository({
      database: createTestDatabase(),
      now: createTimestampFactory(["2026-05-07T10:00:00.000Z"]),
    });

    await expect(repository.update("missing", { name: "Full Body" })).resolves.toBeUndefined();
  });

  it("deletes workout templates by id", async () => {
    const repository = createWorkoutTemplateRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["template-1"]),
      now: createTimestampFactory(["2026-05-07T10:00:00.000Z"]),
    });

    await repository.create({ name: "Full Body", exercises: [] });
    await repository.deleteById("template-1");

    await expect(repository.getById("template-1")).resolves.toBeUndefined();
  });
});
