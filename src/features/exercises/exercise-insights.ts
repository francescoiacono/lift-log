import type { EntityId, Exercise, IsoDateTime, WeightUnit, WorkoutSession, WorkoutSet } from "@/db";

const poundsPerKilogram = 2.204_622_621_8;

/** Metric used to compare performances for an exercise. */
export type ExerciseProgressKind =
  | "assistance"
  | "duration"
  | "estimatedStrength"
  | "repetitions"
  | "weight";

/** Selectable metric for exercises that record an external weight. */
export type WeightedExerciseProgressKind = "estimatedStrength" | "weight";

/** Date window available for an exercise progress chart. */
export type ExerciseProgressRange = "all" | "oneMonth" | "threeMonths";

/** One exercise's best comparable performance inside a finished workout. */
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

/** One finished workout's complete performance for an exercise. */
export type ExerciseWorkoutPerformance = {
  /** Session containing the exercise performance. */
  sessionId: EntityId;

  /** Saved workout name, when one was provided. */
  sessionName: string | null;

  /** Timestamp used to date the performance. */
  startedAt: IsoDateTime;

  /** Completed sets in their original workout order. */
  sets: WorkoutSet[];

  /** Planned set target copied into this workout, when available. */
  targetSets: number | null;

  /** Rest target copied into this workout, when available. */
  restSeconds: number | null;

  /** Exercise-specific notes saved for this workout. */
  exerciseNotes: string | null;

  /** Notes saved for the complete workout. */
  sessionNotes: string | null;

  /** Weight-times-repetitions volume normalized to the display unit. */
  volume: number;

  /** Total repetitions across completed sets. */
  totalReps: number;

  /** Total hold duration across completed sets. */
  totalDurationSeconds: number;
};

/** Derived exercise data used by detail and overview screens. */
export type ExerciseInsights = {
  /** Comparable session-by-session progress for the selected metric. */
  progress: ExerciseProgress;

  /** Complete workout performances ordered from newest to oldest. */
  performances: ExerciseWorkoutPerformance[];

  /** Most recent comparable performance point. */
  latestPoint: ExerciseProgressPoint | undefined;

  /** Comparable performance immediately before the latest point. */
  previousPoint: ExerciseProgressPoint | undefined;

  /** Best comparable performance across all finished workouts. */
  bestPoint: ExerciseProgressPoint | undefined;

  /** Signed latest-minus-previous metric change. */
  changeFromPrevious: number | null;

  /** Whether the latest change represents improvement for this tracking mode. */
  isImprovement: boolean | null;

  /** Number of finished workouts containing completed sets for this exercise. */
  workoutCount: number;

  /** Number of completed sets logged for this exercise. */
  completedSetCount: number;
};

/** Converts a weight value between the units supported by Lift Log. */
export const convertWeight = (weight: number, fromUnit: WeightUnit, toUnit: WeightUnit): number => {
  if (fromUnit === toUnit) {
    return weight;
  }

  return fromUnit === "kg" ? weight * poundsPerKilogram : weight / poundsPerKilogram;
};

/** Estimates one-repetition maximum with Epley for sensible rep ranges. */
export const estimateOneRepMax = (set: WorkoutSet, weightUnit: WeightUnit): number => {
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
  if (exercise.trackingMode === "timed") {
    return "duration";
  }

  if (exercise.trackingMode === "assisted") {
    return "assistance";
  }

  return exercise.trackingMode === "weighted" &&
    completedSets.some((set) => set.weight !== null && set.weight > 0)
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
            set.weight === null || set.weight < 0
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
    .filter(
      ({ value }) => Number.isFinite(value) && (kind === "assistance" ? value >= 0 : value > 0),
    )
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

/** Builds complete exercise performances grouped by finished workout. */
export const buildExercisePerformances = (
  exerciseId: EntityId,
  sessions: WorkoutSession[],
  weightUnit: WeightUnit,
): ExerciseWorkoutPerformance[] => {
  return sessions
    .filter((session) => session.status === "finished")
    .flatMap((session) =>
      session.exercises
        .filter((sessionExercise) => sessionExercise.exerciseId === exerciseId)
        .map((sessionExercise) => {
          const sets = sessionExercise.sets
            .filter((set) => set.isCompleted)
            .sort((first, second) => first.order - second.order);

          return {
            sessionId: session.id,
            sessionName: session.name,
            startedAt: session.startedAt,
            sets,
            targetSets: sessionExercise.targetSets,
            restSeconds: sessionExercise.restSeconds,
            exerciseNotes: sessionExercise.notes,
            sessionNotes: session.notes,
            volume: sets.reduce((total, set) => {
              if (set.weight === null || set.reps === null) {
                return total;
              }

              return total + convertWeight(set.weight, set.weightUnit, weightUnit) * set.reps;
            }, 0),
            totalReps: sets.reduce((total, set) => total + (set.reps ?? 0), 0),
            totalDurationSeconds: sets.reduce(
              (total, set) => total + (set.durationSeconds ?? 0),
              0,
            ),
          };
        }),
    )
    .filter((performance) => performance.sets.length > 0)
    .sort(
      (first, second) => new Date(second.startedAt).getTime() - new Date(first.startedAt).getTime(),
    );
};

/** Builds the full derived insight summary for one exercise. */
export const buildExerciseInsights = (
  exercise: Exercise,
  sessions: WorkoutSession[],
  weightUnit: WeightUnit,
  weightedKind: WeightedExerciseProgressKind = "estimatedStrength",
): ExerciseInsights => {
  const progress = buildExerciseProgress(exercise, sessions, weightUnit, weightedKind);
  const performances = buildExercisePerformances(exercise.id, sessions, weightUnit);
  const latestPoint = progress.points.at(-1);
  const previousPoint = progress.points.at(-2);
  const bestPoint = [...progress.points].sort((first, second) =>
    progress.kind === "assistance" ? first.value - second.value : second.value - first.value,
  )[0];
  const changeFromPrevious =
    latestPoint && previousPoint ? latestPoint.value - previousPoint.value : null;

  return {
    progress,
    performances,
    latestPoint,
    previousPoint,
    bestPoint,
    changeFromPrevious,
    isImprovement:
      changeFromPrevious === null || changeFromPrevious === 0
        ? null
        : progress.kind === "assistance"
          ? changeFromPrevious < 0
          : changeFromPrevious > 0,
    workoutCount: performances.length,
    completedSetCount: performances.reduce(
      (total, performance) => total + performance.sets.length,
      0,
    ),
  };
};

/** Restricts progress points to a recent chart date range. */
export const filterExerciseProgressPoints = (
  points: ExerciseProgressPoint[],
  range: ExerciseProgressRange,
  now = new Date(),
): ExerciseProgressPoint[] => {
  const eligiblePoints = points.filter((point) => new Date(point.startedAt) <= now);

  if (range === "all") {
    return eligiblePoints;
  }

  const boundary = new Date(now);
  const boundaryDay = boundary.getDate();

  // Setting the day to one avoids month-end rollover, such as 31 March minus one month
  // becoming 3 March instead of the intended final day of February.
  boundary.setDate(1);
  boundary.setMonth(boundary.getMonth() - (range === "oneMonth" ? 1 : 3));
  const lastBoundaryDay = new Date(boundary.getFullYear(), boundary.getMonth() + 1, 0).getDate();

  boundary.setDate(Math.min(boundaryDay, lastBoundaryDay));
  boundary.setHours(0, 0, 0, 0);

  return eligiblePoints.filter((point) => new Date(point.startedAt) >= boundary);
};
