import type { EntityId, Exercise, IsoDateTime, WeightUnit, WorkoutSession, WorkoutSet } from "@/db";

const poundsPerKilogram = 2.204_622_621_8;
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

/** Metric used to describe progress for an exercise. */
export type ExerciseProgressKind =
  | "assistance"
  | "duration"
  | "estimatedStrength"
  | "repetitions"
  | "weight";

/** Selectable metric for exercises that record an external weight. */
export type WeightedExerciseProgressKind = "estimatedStrength" | "weight";

/** One exercise's best performance inside a finished workout. */
export type ExerciseProgressPoint = {
  /** Session containing the performance. */
  sessionId: EntityId;

  /** Saved workout name associated with the performance. */
  sessionName: string | null;

  /** Session start timestamp used on the progress timeline. */
  startedAt: IsoDateTime;

  /** Comparable metric value for this session. */
  value: number;

  /** Whether this point improved on every earlier recorded session. */
  isPersonalRecord: boolean;

  /** Weight from the set that produced this point, when applicable. */
  weight: number | null;

  /** Repetition count from the set that produced this point, when applicable. */
  reps: number | null;

  /** Hold duration from the set that produced this point, when applicable. */
  durationSeconds: number | null;
};

/** Comparable progress timeline for one exercise. */
export type ExerciseProgress = {
  /** Metric semantics used by every point. */
  kind: ExerciseProgressKind;

  /** Session-level performance points ordered from oldest to newest. */
  points: ExerciseProgressPoint[];
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

/** Converts a weight value between the units supported by Lift Log. */
export const convertWeight = (weight: number, fromUnit: WeightUnit, toUnit: WeightUnit): number => {
  if (fromUnit === toUnit) {
    return weight;
  }

  return fromUnit === "kg" ? weight * poundsPerKilogram : weight / poundsPerKilogram;
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

/** Estimates one-repetition maximum for a weighted set using the Epley formula. */
const estimateOneRepMax = (set: WorkoutSet, weightUnit: WeightUnit): number => {
  if (
    set.weight === null ||
    set.reps === null ||
    set.weight <= 0 ||
    set.reps <= 0 ||
    set.reps > 30
  ) {
    return 0;
  }

  return convertWeight(set.weight, set.weightUnit, weightUnit) * (1 + set.reps / 30);
};

/** Selects the metric semantics that best match an exercise and its logged sets. */
const getExerciseProgressKind = (
  exercise: Exercise,
  completedSets: WorkoutSet[],
  weightedKind: WeightedExerciseProgressKind,
): ExerciseProgressKind => {
  if (exercise.tracksDuration) {
    return "duration";
  }

  if (exercise.tracksAssistance) {
    return "assistance";
  }

  return completedSets.some((set) => set.weight !== null && set.weight > 0)
    ? weightedKind
    : "repetitions";
};

/** Returns the set and comparable value that best represent one session. */
const findSessionBest = (
  sets: WorkoutSet[],
  kind: ExerciseProgressKind,
  weightUnit: WeightUnit,
): { set: WorkoutSet; value: number } | undefined => {
  const comparableSets = sets
    .map((set) => {
      if (kind === "duration") {
        return { set, value: set.durationSeconds ?? 0 };
      }

      if (kind === "assistance") {
        return {
          set,
          value:
            set.weight === null || set.weight <= 0
              ? Number.POSITIVE_INFINITY
              : convertWeight(set.weight, set.weightUnit, weightUnit),
        };
      }

      if (kind === "estimatedStrength") {
        return { set, value: estimateOneRepMax(set, weightUnit) };
      }

      if (kind === "weight") {
        return {
          set,
          value: set.weight === null ? 0 : convertWeight(set.weight, set.weightUnit, weightUnit),
        };
      }

      return { set, value: set.reps ?? 0 };
    })
    .filter(({ value }) => Number.isFinite(value) && value > 0)
    .sort((first, second) => {
      return kind === "assistance" ? first.value - second.value : second.value - first.value;
    });

  return comparableSets[0];
};

/** Builds a session-by-session progress timeline for one exercise. */
export const buildExerciseProgress = (
  exercise: Exercise,
  sessions: WorkoutSession[],
  weightUnit: WeightUnit = "kg",
  weightedKind: WeightedExerciseProgressKind = "weight",
): ExerciseProgress => {
  const relevantSessions = sessions
    .filter((session) => session.status === "finished")
    .map((session) => ({
      session,
      sets: session.exercises
        .filter((sessionExercise) => sessionExercise.exerciseId === exercise.id)
        .flatMap((sessionExercise) => sessionExercise.sets)
        .filter((set) => set.isCompleted),
    }))
    .filter(({ sets }) => sets.length > 0)
    .sort(
      (first, second) =>
        new Date(first.session.startedAt).getTime() - new Date(second.session.startedAt).getTime(),
    );
  const kind = getExerciseProgressKind(
    exercise,
    relevantSessions.flatMap(({ sets }) => sets),
    weightedKind,
  );
  let runningBest: number | undefined;
  const points: ExerciseProgressPoint[] = [];

  for (const { session, sets } of relevantSessions) {
    const best = findSessionBest(sets, kind, weightUnit);

    if (!best) {
      continue;
    }

    const isImprovement =
      runningBest !== undefined &&
      (kind === "assistance" ? best.value < runningBest : best.value > runningBest);

    if (
      runningBest === undefined ||
      (kind === "assistance" ? best.value < runningBest : best.value > runningBest)
    ) {
      runningBest = best.value;
    }

    points.push({
      sessionId: session.id,
      sessionName: session.name,
      startedAt: session.startedAt,
      value: best.value,
      isPersonalRecord: isImprovement,
      weight:
        best.set.weight === null
          ? null
          : convertWeight(best.set.weight, best.set.weightUnit, weightUnit),
      reps: best.set.reps,
      durationSeconds: best.set.durationSeconds ?? null,
    });
  }

  return { kind, points };
};
