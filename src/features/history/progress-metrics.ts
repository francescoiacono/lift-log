import type { EntityId, IsoDateTime, WeightUnit, WorkoutSession, WorkoutSet } from "@/db";
import { convertWeight } from "@/features/exercises/exercise-insights";
export { buildExerciseProgress, convertWeight } from "@/features/exercises/exercise-insights";
export type {
  ExerciseProgress,
  ExerciseProgressKind,
  ExerciseProgressPoint,
  WeightedExerciseProgressKind,
} from "@/features/exercises/exercise-insights";

const millisecondsPerDay = 86_400_000;

/** Options controlling the date window and filters for weekly progress summaries. */
export type WeeklySummaryOptions = {
  /** Number of Monday-based calendar weeks to return. */
  numberOfWeeks?: number;

  /** Date used to identify the current week. */
  now?: Date;

  /** Template identifier used to restrict included sessions, when selected. */
  templateId?: EntityId;

  /** Weight unit used to normalize volume before aggregation. */
  weightUnit?: WeightUnit;
};

/** Aggregated training activity for one Monday-based calendar week. */
export type WeeklyTrainingSummary = {
  /** Local timestamp for the Monday that starts this week. */
  weekStartedAt: IsoDateTime;

  /** Number of finished workout sessions in this week. */
  sessionCount: number;

  /** Number of completed sets logged in this week. */
  completedSetCount: number;

  /** Number of planned sets attached to session exercises in this week. */
  plannedSetCount: number;

  /** Completed sets belonging to exercise blocks that carried a set target. */
  completedPlannedSetCount: number;

  /** Weight-times-repetitions volume normalized to the selected weight unit. */
  volume: number;
};

/** Aggregate planned-versus-completed set adherence. */
export type PlanAdherence = {
  /** Number of planned sets in the selected period. */
  plannedSetCount: number;

  /** Completed sets in exercise blocks that had a plan target. */
  completedSetCount: number;

  /** Completed-to-planned percentage capped at 100, or null without targets. */
  percent: number | null;
};

/** Returns the local Monday at the start of the supplied date's calendar week. */
const getLocalWeekStart = (date: Date): Date => {
  const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayOffset = (weekStart.getDay() + 6) % 7;

  weekStart.setDate(weekStart.getDate() - dayOffset);

  return weekStart;
};

/** Returns a new local date offset by a whole number of calendar days. */
const addLocalDays = (date: Date, days: number): Date => {
  const nextDate = new Date(date);

  nextDate.setDate(nextDate.getDate() + days);

  return nextDate;
};

/** Calculates completed volume for a set in the requested display unit. */
const calculateSetVolume = (set: WorkoutSet, weightUnit: WeightUnit): number => {
  if (!set.isCompleted || set.weight === null || set.reps === null) {
    return 0;
  }

  return convertWeight(set.weight, set.weightUnit, weightUnit) * set.reps;
};

/** Builds fixed-width weekly training summaries, including weeks with no workouts. */
export const buildWeeklyTrainingSummaries = (
  sessions: WorkoutSession[],
  { numberOfWeeks = 8, now = new Date(), templateId, weightUnit = "kg" }: WeeklySummaryOptions = {},
): WeeklyTrainingSummary[] => {
  const weekCount = Math.max(1, Math.round(numberOfWeeks));
  const currentWeekStart = getLocalWeekStart(now);
  const firstWeekStart = addLocalDays(currentWeekStart, -(weekCount - 1) * 7);
  const summaryByWeek = new Map<number, WeeklyTrainingSummary>();

  for (let weekIndex = 0; weekIndex < weekCount; weekIndex += 1) {
    const weekStart = addLocalDays(firstWeekStart, weekIndex * 7);

    summaryByWeek.set(weekStart.getTime(), {
      weekStartedAt: weekStart.toISOString(),
      sessionCount: 0,
      completedSetCount: 0,
      plannedSetCount: 0,
      completedPlannedSetCount: 0,
      volume: 0,
    });
  }

  for (const session of sessions) {
    const sessionDate = new Date(session.startedAt);

    if (
      session.status !== "finished" ||
      sessionDate < firstWeekStart ||
      sessionDate > now ||
      (templateId !== undefined && session.templateId !== templateId)
    ) {
      continue;
    }

    const summary = summaryByWeek.get(getLocalWeekStart(sessionDate).getTime());

    if (!summary) {
      continue;
    }

    summary.sessionCount += 1;

    for (const sessionExercise of session.exercises) {
      const completedSets = sessionExercise.sets.filter((set) => set.isCompleted);

      summary.completedSetCount += completedSets.length;
      summary.volume += completedSets.reduce(
        (volume, set) => volume + calculateSetVolume(set, weightUnit),
        0,
      );

      if (sessionExercise.targetSets !== null) {
        summary.plannedSetCount += sessionExercise.targetSets;
        summary.completedPlannedSetCount += completedSets.length;
      }
    }
  }

  return [...summaryByWeek.values()];
};

/** Calculates planned-set adherence from one or more weekly summaries. */
export const calculatePlanAdherence = (summaries: WeeklyTrainingSummary[]): PlanAdherence => {
  const plannedSetCount = summaries.reduce((total, summary) => total + summary.plannedSetCount, 0);
  const completedSetCount = summaries.reduce(
    (total, summary) => total + summary.completedPlannedSetCount,
    0,
  );

  return {
    plannedSetCount,
    completedSetCount,
    percent:
      plannedSetCount === 0
        ? null
        : Math.min(100, Math.round((completedSetCount / plannedSetCount) * 100)),
  };
};

/** Returns whole local calendar days since the most recent finished workout. */
export const getDaysSinceLastWorkout = (
  sessions: WorkoutSession[],
  now = new Date(),
): number | null => {
  const latestSessionTime = sessions
    .filter((session) => session.status === "finished")
    .map((session) => new Date(session.finishedAt ?? session.startedAt).getTime())
    .filter((timestamp) => timestamp <= now.getTime())
    .sort((first, second) => second - first)[0];

  if (latestSessionTime === undefined) {
    return null;
  }

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const sessionDate = new Date(latestSessionTime);
  const sessionDayStart = new Date(
    sessionDate.getFullYear(),
    sessionDate.getMonth(),
    sessionDate.getDate(),
  ).getTime();

  return Math.round((todayStart - sessionDayStart) / millisecondsPerDay);
};
