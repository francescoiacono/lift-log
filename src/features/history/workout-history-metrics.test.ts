import { describe, expect, it } from "vitest";

import type { WorkoutSession } from "@/db";
import {
  calculateSessionDurationMinutes,
  calculateSessionVolume,
  getWorkoutDateGroup,
  getWorkoutDayDistance,
  groupSessionsByRecency,
} from "./workout-history-metrics";

const now = new Date(2026, 6, 17, 12, 0, 0); // Friday 17 Jul 2026, local noon.

/** Builds a July 2026 timestamp from local components so tests stay timezone-independent. */
const iso = (day: number, hour = 12): string => new Date(2026, 6, day, hour, 0, 0).toISOString();

/** Builds a finished session with optional sets and a distinct start timestamp. */
const buildSession = (
  finishedAt: string,
  sets: {
    weight: number | null;
    reps: number | null;
    completedAt?: string | null;
    isCompleted?: boolean;
  }[] = [],
  startedAt: string = finishedAt,
): WorkoutSession => {
  return {
    id: `session-${startedAt}-${finishedAt}`,
    templateId: null,
    name: null,
    status: "finished",
    exercises: [
      {
        exerciseId: "exercise-1",
        order: 0,
        targetSets: null,
        restSeconds: null,
        notes: null,
        sets: sets.map((set, index) => ({
          id: `set-${index}`,
          order: index,
          reps: set.reps,
          weight: set.weight,
          weightUnit: "kg",
          isCompleted: set.isCompleted ?? true,
          completedAt: set.completedAt ?? null,
          restSeconds: null,
          notes: null,
        })),
      },
    ],
    notes: null,
    startedAt,
    finishedAt,
    createdAt: startedAt,
    updatedAt: finishedAt,
  };
};

describe("workout history metrics", () => {
  it("measures calendar-day distance from now", () => {
    expect(getWorkoutDayDistance(buildSession(iso(17)), now)).toBe(0);
    expect(getWorkoutDayDistance(buildSession(iso(16)), now)).toBe(1);
    expect(getWorkoutDayDistance(buildSession(iso(10)), now)).toBe(7);
  });

  it("groups sessions by recency using calendar-week boundaries", () => {
    expect(getWorkoutDateGroup(buildSession(iso(17)), now)).toBe("today");
    // Wednesday of the same Monday-based week is "this week".
    expect(getWorkoutDateGroup(buildSession(iso(15)), now)).toBe("thisWeek");
    // Previous Sunday falls outside the current week.
    expect(getWorkoutDateGroup(buildSession(iso(12)), now)).toBe("earlier");
  });

  it("partitions sessions into ordered groups when start and finish order differ", () => {
    // Ordered by startedAt DESC, the way listFinished returns them.
    const today = buildSession(iso(17, 9));
    const midweek = buildSession(iso(15, 12));
    // Started Monday but finished today: grouped as "today" by finishedAt despite the early start.
    const longRun = buildSession(iso(17, 10), [], iso(13, 9));

    const groups = groupSessionsByRecency([today, midweek, longRun], now);

    expect(groups.map((group) => group.key)).toEqual(["today", "thisWeek"]);
    expect(groups[0].sessions.map((session) => session.id)).toEqual([today.id, longRun.id]);
    expect(groups[1].sessions.map((session) => session.id)).toEqual([midweek.id]);
  });

  it("sums weight times reps across all sets, treating nulls as zero", () => {
    const session = buildSession(iso(17), [
      { weight: 100, reps: 5 },
      { weight: 60, reps: 10 },
      { weight: null, reps: 8 },
    ]);

    expect(calculateSessionVolume(session)).toBe(1100);
  });

  it("returns zero volume for a session with no logged sets", () => {
    expect(calculateSessionVolume(buildSession(iso(17)))).toBe(0);
  });

  it("excludes uncompleted set drafts from session volume", () => {
    const session = buildSession(iso(17), [
      { weight: 100, reps: 5 },
      { weight: 120, reps: 5, isCompleted: false },
    ]);

    expect(calculateSessionVolume(session)).toBe(500);
  });

  it("uses completed-set timestamps instead of a stale session finish time", () => {
    const session = buildSession(
      iso(17, 20),
      [
        { weight: 50, reps: 8, completedAt: iso(17, 9) },
        { weight: 50, reps: 8, completedAt: iso(17, 10) },
      ],
      iso(17, 8),
    );

    expect(calculateSessionDurationMinutes(session)).toBe(60);
  });

  it("excludes an obvious duration outlier without completed-set timestamps", () => {
    expect(calculateSessionDurationMinutes(buildSession(iso(17, 20), [], iso(17, 8)))).toBeNull();
  });

  it("falls back to a reasonable start-to-finish duration", () => {
    expect(calculateSessionDurationMinutes(buildSession(iso(17, 10), [], iso(17, 9)))).toBe(60);
  });
});
