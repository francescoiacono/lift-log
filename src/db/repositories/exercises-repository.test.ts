import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { createLiftLogDatabase, type LiftLogDatabase } from "../database";
import type { EntityId, IsoDateTime } from "../entities";
import { createExerciseRepository } from "./exercises-repository";

let database: LiftLogDatabase | undefined;
let databaseIndex = 0;

/** Creates an isolated test database for repository tests. */
const createTestDatabase = () => {
  databaseIndex += 1;
  database = createLiftLogDatabase(`lift-log-test-${databaseIndex}`);

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

afterEach(async () => {
  await database?.delete();
  database = undefined;
});

describe("createExerciseRepository", () => {
  it("creates exercises with generated ids and timestamps", async () => {
    const repository = createExerciseRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["exercise-1"]),
      now: createTimestampFactory(["2026-05-07T10:00:00.000Z"]),
    });

    const exercise = await repository.create({
      name: "Bench Press",
      muscleGroups: ["chest", "triceps"],
      equipment: "barbell",
    });

    expect(exercise).toEqual({
      id: "exercise-1",
      name: "Bench Press",
      muscleGroups: ["chest", "triceps"],
      equipment: "barbell",
      notes: null,
      createdAt: "2026-05-07T10:00:00.000Z",
      updatedAt: "2026-05-07T10:00:00.000Z",
    });
    await expect(repository.getById("exercise-1")).resolves.toEqual(exercise);
  });

  it("lists exercises ordered by name", async () => {
    const repository = createExerciseRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["exercise-1", "exercise-2"]),
      now: createTimestampFactory(["2026-05-07T10:00:00.000Z", "2026-05-07T10:01:00.000Z"]),
    });

    await repository.create({ name: "Squat", muscleGroups: ["legs"] });
    await repository.create({ name: "Bench Press", muscleGroups: ["chest"] });

    await expect(repository.list()).resolves.toMatchObject([
      { id: "exercise-2", name: "Bench Press" },
      { id: "exercise-1", name: "Squat" },
    ]);
  });

  it("updates existing exercises without changing createdAt", async () => {
    const repository = createExerciseRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["exercise-1"]),
      now: createTimestampFactory(["2026-05-07T10:00:00.000Z", "2026-05-07T10:02:00.000Z"]),
    });

    await repository.create({
      name: "Deadlift",
      muscleGroups: ["posterior-chain"],
      equipment: "barbell",
    });

    const updatedExercise = await repository.update("exercise-1", {
      name: "Romanian Deadlift",
      notes: "Keep the bar close.",
    });

    expect(updatedExercise).toMatchObject({
      id: "exercise-1",
      name: "Romanian Deadlift",
      muscleGroups: ["posterior-chain"],
      equipment: "barbell",
      notes: "Keep the bar close.",
      createdAt: "2026-05-07T10:00:00.000Z",
      updatedAt: "2026-05-07T10:02:00.000Z",
    });
  });

  it("returns undefined when updating a missing exercise", async () => {
    const repository = createExerciseRepository({
      database: createTestDatabase(),
      now: createTimestampFactory(["2026-05-07T10:00:00.000Z"]),
    });

    await expect(repository.update("missing", { name: "Squat" })).resolves.toBeUndefined();
  });

  it("deletes exercises by id", async () => {
    const repository = createExerciseRepository({
      database: createTestDatabase(),
      createId: createIdFactory(["exercise-1"]),
      now: createTimestampFactory(["2026-05-07T10:00:00.000Z"]),
    });

    await repository.create({ name: "Pull Up", muscleGroups: ["back"] });
    await repository.deleteById("exercise-1");

    await expect(repository.getById("exercise-1")).resolves.toBeUndefined();
  });
});
