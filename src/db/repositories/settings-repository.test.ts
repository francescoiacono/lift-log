import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import { createLiftLogDatabase, type LiftLogDatabase } from "../database";
import { createSettingsRepository } from "./settings-repository";

let database: LiftLogDatabase | undefined;
let databaseIndex = 0;

/** Creates an isolated settings database for each test. */
const createTestDatabase = () => {
  databaseIndex += 1;
  database = createLiftLogDatabase(`lift-log-settings-test-${databaseIndex}`);

  return database;
};

afterEach(async () => {
  await database?.delete();
  database = undefined;
});

describe("createSettingsRepository", () => {
  it("creates default settings when none are stored", async () => {
    const repository = createSettingsRepository({
      database: createTestDatabase(),
      now: () => "2026-08-26T10:00:00.000Z",
    });

    await expect(repository.get()).resolves.toEqual({
      id: "app",
      defaultRestSeconds: 120,
      weeklyWorkoutTarget: 3,
      weightUnit: "kg",
      createdAt: "2026-08-26T10:00:00.000Z",
      updatedAt: "2026-08-26T10:00:00.000Z",
    });
  });

  it("updates and clamps the weekly target", async () => {
    const timestamps = ["2026-08-26T10:00:00.000Z", "2026-08-26T10:05:00.000Z"];
    const repository = createSettingsRepository({
      database: createTestDatabase(),
      now: () => timestamps.shift() ?? "2026-08-26T10:05:00.000Z",
    });

    const settings = await repository.updateWeeklyWorkoutTarget(12);

    expect(settings.weeklyWorkoutTarget).toBe(7);
    expect(settings.updatedAt).toBe("2026-08-26T10:05:00.000Z");
    await expect(repository.get()).resolves.toEqual(settings);
  });

  it("repairs invalid persisted and requested targets", async () => {
    const testDatabase = createTestDatabase();
    const repository = createSettingsRepository({
      database: testDatabase,
      now: () => "2026-08-26T10:00:00.000Z",
    });

    await testDatabase.settings.put({
      id: "app",
      defaultRestSeconds: 120,
      weeklyWorkoutTarget: 0,
      weightUnit: "kg",
      createdAt: "2026-08-26T09:00:00.000Z",
      updatedAt: "2026-08-26T09:00:00.000Z",
    });

    await expect(repository.get()).resolves.toMatchObject({ weeklyWorkoutTarget: 1 });
    await expect(repository.updateWeeklyWorkoutTarget(Number.NaN)).resolves.toMatchObject({
      weeklyWorkoutTarget: 3,
    });
    await expect(testDatabase.settings.get("app")).resolves.toMatchObject({
      weeklyWorkoutTarget: 3,
    });
  });
});
