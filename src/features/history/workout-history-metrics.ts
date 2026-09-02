import type { WorkoutSession } from "@/db";

/** Recency buckets used to group finished workouts in the history list. */
export type WorkoutDateGroup = "today" | "thisWeek" | "earlier";

const millisecondsPerDay = 86_400_000;
const millisecondsPerMinute = 60_000;

/** Longest session duration treated as reliable without completed-set evidence. */
export const maximumReliableWorkoutDurationMinutes = 240;

/** Returns the local calendar-day start time for a date. */
const getLocalDateStartMs = (date: Date): number => {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/** Returns the Monday-based start time of the calendar week containing a date. */
const getWeekStartMs = (date: Date): number => {
  const weekStart = new Date(date);
  const dayOffset = (weekStart.getDay() + 6) % 7;

  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - dayOffset);

  return weekStart.getTime();
};

/** Returns the timestamp used to date a finished session, falling back to its start. */
const getSessionTimestamp = (session: WorkoutSession): string => {
  return session.finishedAt ?? session.startedAt;
};

/** Returns whole calendar days between a finished workout and now (0 means today). */
export const getWorkoutDayDistance = (session: WorkoutSession, now = new Date()): number => {
  const sessionDayStart = getLocalDateStartMs(new Date(getSessionTimestamp(session)));

  return Math.round((getLocalDateStartMs(now) - sessionDayStart) / millisecondsPerDay);
};

/** Groups a finished workout by recency for sectioned history lists. */
export const getWorkoutDateGroup = (
  session: WorkoutSession,
  now = new Date(),
): WorkoutDateGroup => {
  if (getWorkoutDayDistance(session, now) === 0) {
    return "today";
  }

  const sessionMs = new Date(getSessionTimestamp(session)).getTime();

  return sessionMs >= getWeekStartMs(now) ? "thisWeek" : "earlier";
};

/** A recency section of finished workouts rendered in the history list. */
export type WorkoutSessionGroup = {
  /** Recency bucket this section represents. */
  key: WorkoutDateGroup;

  /** Sessions that fall into this recency bucket, in their incoming order. */
  sessions: WorkoutSession[];
};

/** Fixed display order for recency sections, newest first. */
const groupOrder: WorkoutDateGroup[] = ["today", "thisWeek", "earlier"];

/**
 * Partitions finished sessions into ordered recency sections, dropping empty ones.
 *
 * Grouping keys off `finishedAt`, so callers must not rely on the incoming sort order
 * (which may be by `startedAt`) to keep same-group sessions adjacent.
 */
export const groupSessionsByRecency = (
  sessions: WorkoutSession[],
  now = new Date(),
): WorkoutSessionGroup[] => {
  const buckets: Record<WorkoutDateGroup, WorkoutSession[]> = {
    today: [],
    thisWeek: [],
    earlier: [],
  };

  for (const session of sessions) {
    buckets[getWorkoutDateGroup(session, now)].push(session);
  }

  return groupOrder
    .map((key) => ({ key, sessions: buckets[key] }))
    .filter((group) => group.sessions.length > 0);
};

/** Sums logged training volume (weight times reps) across every set in a session. */
export const calculateSessionVolume = (session: WorkoutSession): number => {
  return session.exercises.reduce((sessionVolume, exercise) => {
    const exerciseVolume = exercise.sets
      .filter((set) => set.isCompleted)
      .reduce((setVolume, set) => {
        return setVolume + (set.weight ?? 0) * (set.reps ?? 0);
      }, 0);

    return sessionVolume + exerciseVolume;
  }, 0);
};

/**
 * Estimates active training time from completed-set timestamps and rejects obvious stale outliers.
 */
export const calculateSessionDurationMinutes = (session: WorkoutSession): number | null => {
  const startedAtMs = new Date(session.startedAt).getTime();
  const finishedAtMs = session.finishedAt ? new Date(session.finishedAt).getTime() : Number.NaN;
  const completedSetTimes = session.exercises
    .flatMap((exercise) => exercise.sets)
    .filter((set) => set.isCompleted && set.completedAt !== null)
    .map((set) => new Date(set.completedAt ?? "").getTime())
    .filter((timestamp) => Number.isFinite(timestamp))
    .sort((first, second) => first - second);

  let durationMs: number;

  if (completedSetTimes.length >= 2) {
    durationMs = (completedSetTimes.at(-1) ?? 0) - (completedSetTimes[0] ?? 0);
  } else if (completedSetTimes.length === 1) {
    durationMs = (completedSetTimes[0] ?? 0) - startedAtMs;
  } else {
    durationMs = finishedAtMs - startedAtMs;
  }

  const durationMinutes = Math.round(durationMs / millisecondsPerMinute);

  if (
    !Number.isFinite(durationMinutes) ||
    durationMinutes < 0 ||
    durationMinutes > maximumReliableWorkoutDurationMinutes
  ) {
    return null;
  }

  return Math.max(1, durationMinutes);
};
