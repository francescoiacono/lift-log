import type { EntityId, IsoDateTime, WorkoutSession, WorkoutSet } from "@/db";

const millisecondsPerDay = 86_400_000;

/** Sets logged for an exercise in its most recent finished session. */
export type LastSessionSets = {
  /** Start timestamp of the session the sets came from. */
  startedAt: IsoDateTime;

  /** Sets logged for the exercise, in display order. */
  sets: WorkoutSet[];
};

/** Finds the sets logged for an exercise in the most recent finished session. */
export const findLastSessionSets = (
  exerciseId: EntityId,
  finishedSessions: WorkoutSession[],
): LastSessionSets | undefined => {
  let latest: LastSessionSets | undefined;

  for (const session of finishedSessions) {
    const sessionExercise = session.exercises.find(
      (exercise) => exercise.exerciseId === exerciseId && exercise.sets.length > 0,
    );

    if (!sessionExercise) {
      continue;
    }

    if (latest && new Date(session.startedAt).getTime() <= new Date(latest.startedAt).getTime()) {
      continue;
    }

    latest = {
      startedAt: session.startedAt,
      sets: [...sessionExercise.sets].sort((first, second) => first.order - second.order),
    };
  }

  return latest;
};

/** Returns the local calendar-day start time for a date. */
const getLocalDateStartMs = (date: Date): number => {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
};

/** Returns the local calendar-day start time for a persisted timestamp. */
const getLocalDayStartMs = (timestamp: string): number => {
  return getLocalDateStartMs(new Date(timestamp));
};

/** Returns the calendar-day distance between two local day starts. */
const getCalendarDayDistance = (laterDayMs: number, earlierDayMs: number): number => {
  return Math.round((laterDayMs - earlierDayMs) / millisecondsPerDay);
};

/** Counts consecutive training days in the current streak window. */
export const calculateTrainingDayStreak = (
  sessions: WorkoutSession[],
  now = new Date(),
): number => {
  const todayStartMs = getLocalDateStartMs(now);
  const sortedDays = [
    ...new Set(
      sessions
        .map((session) => getLocalDayStartMs(session.startedAt))
        .filter((dayStartMs) => dayStartMs <= todayStartMs),
    ),
  ].sort((firstDay, secondDay) => secondDay - firstDay);

  if (sortedDays.length === 0) {
    return 0;
  }

  const latestWorkoutDay = sortedDays[0];

  if (getCalendarDayDistance(todayStartMs, latestWorkoutDay) > 1) {
    return 0;
  }

  let streak = 1;
  let previousDay = latestWorkoutDay;

  for (const day of sortedDays.slice(1)) {
    if (getCalendarDayDistance(previousDay, day) !== 1) {
      break;
    }

    streak += 1;
    previousDay = day;
  }

  return streak;
};
