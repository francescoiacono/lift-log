import type { WorkoutSession } from "@/db";

const millisecondsPerDay = 86_400_000;

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
