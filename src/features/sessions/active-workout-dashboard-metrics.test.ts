import { describe, expect, it } from "vitest";

import type { EntityId, IsoDateTime, WorkoutSession } from "@/db";
import { calculateTrainingDayStreak } from "./active-workout-dashboard-metrics";

/** Creates a finished workout session fixture for dashboard metric tests. */
const createFinishedSession = (id: EntityId, startedAt: IsoDateTime): WorkoutSession => ({
  id,
  templateId: null,
  name: "Lift",
  status: "finished",
  exercises: [],
  notes: null,
  startedAt,
  finishedAt: startedAt,
  createdAt: startedAt,
  updatedAt: startedAt,
});

describe("calculateTrainingDayStreak", () => {
  it("counts consecutive training days through today", () => {
    const now = new Date("2026-05-29T12:00:00.000Z");

    expect(
      calculateTrainingDayStreak(
        [
          createFinishedSession("session-today", "2026-05-29T08:00:00.000Z"),
          createFinishedSession("session-yesterday", "2026-05-28T08:00:00.000Z"),
          createFinishedSession("session-previous", "2026-05-27T08:00:00.000Z"),
        ],
        now,
      ),
    ).toBe(3);
  });

  it("keeps the current streak when the latest workout was yesterday", () => {
    const now = new Date("2026-05-29T12:00:00.000Z");

    expect(
      calculateTrainingDayStreak(
        [
          createFinishedSession("session-yesterday", "2026-05-28T08:00:00.000Z"),
          createFinishedSession("session-previous", "2026-05-27T08:00:00.000Z"),
        ],
        now,
      ),
    ).toBe(2);
  });

  it("returns zero when the latest workout is older than yesterday", () => {
    const now = new Date("2026-05-29T12:00:00.000Z");

    expect(
      calculateTrainingDayStreak(
        [
          createFinishedSession("session-old", "2026-05-27T08:00:00.000Z"),
          createFinishedSession("session-older", "2026-05-26T08:00:00.000Z"),
        ],
        now,
      ),
    ).toBe(0);
  });
});
