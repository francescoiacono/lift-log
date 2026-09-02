import type {
  EntityId,
  Exercise,
  IsoDateTime,
  MuscleGroupId,
  WorkoutSession,
  WorkoutSet,
  WorkoutTemplate,
} from "@/db";

const millisecondsPerDay = 86_400_000;
const millisecondsPerHour = 3_600_000;

/** Recovery labels shown for normalized muscle groups on Today. */
export type MuscleRecoveryState = "ready" | "recent" | "rest";

/** Recovery status derived from the most recent completed work for one muscle group. */
export type MuscleRecoveryStatus = {
  /** Stable normalized muscle-group identifier. */
  muscleGroupId: MuscleGroupId;

  /** Number of local calendar days since training, or null when never trained. */
  daysSinceTrained: number | null;

  /** Compact readiness bucket used by the Today screen. */
  state: MuscleRecoveryState;
};

/** Workout plan selected as the most useful next action. */
export type WorkoutRecommendation = {
  /** Suggested reusable workout template. */
  template: WorkoutTemplate;

  /** Calendar days since this plan was last completed, or null when it is new. */
  daysSinceLastSession: number | null;
};

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
    const completedSets = session.exercises
      .filter((exercise) => exercise.exerciseId === exerciseId)
      .flatMap((exercise) => exercise.sets)
      .filter((set) => set.isCompleted);

    if (session.status !== "finished" || completedSets.length === 0) {
      continue;
    }

    const sessionStartedAtMs = new Date(session.startedAt).getTime();

    if (
      !Number.isFinite(sessionStartedAtMs) ||
      (latest && sessionStartedAtMs <= new Date(latest.startedAt).getTime())
    ) {
      continue;
    }

    latest = {
      startedAt: session.startedAt,
      sets: completedSets.sort((first, second) => first.order - second.order),
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
        .filter((session) => session.status === "finished")
        .map((session) => getLocalDayStartMs(session.finishedAt ?? session.startedAt))
        .filter((dayStartMs) => Number.isFinite(dayStartMs) && dayStartMs <= todayStartMs),
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

/** Chooses the plan that has gone the longest without a completed session. */
export const recommendWorkoutTemplate = (
  templates: WorkoutTemplate[],
  sessions: WorkoutSession[],
  now = new Date(),
): WorkoutRecommendation | undefined => {
  const nowMs = now.getTime();
  const latestSessionByTemplateId = new Map<EntityId, number>();

  for (const session of sessions) {
    if (session.status !== "finished" || !session.templateId) {
      continue;
    }

    const sessionMs = new Date(session.finishedAt ?? session.startedAt).getTime();

    if (!Number.isFinite(sessionMs) || sessionMs > nowMs) {
      continue;
    }

    const latestSessionMs = latestSessionByTemplateId.get(session.templateId);

    if (latestSessionMs === undefined || sessionMs > latestSessionMs) {
      latestSessionByTemplateId.set(session.templateId, sessionMs);
    }
  }

  const recommendation = [...templates].sort((firstTemplate, secondTemplate) => {
    const firstSessionMs = latestSessionByTemplateId.get(firstTemplate.id);
    const secondSessionMs = latestSessionByTemplateId.get(secondTemplate.id);

    if (firstSessionMs === undefined && secondSessionMs !== undefined) {
      return -1;
    }

    if (firstSessionMs !== undefined && secondSessionMs === undefined) {
      return 1;
    }

    if (firstSessionMs !== secondSessionMs) {
      return (firstSessionMs ?? 0) - (secondSessionMs ?? 0);
    }

    return firstTemplate.name.localeCompare(secondTemplate.name);
  })[0];

  if (!recommendation) {
    return undefined;
  }

  const latestSessionMs = latestSessionByTemplateId.get(recommendation.id);

  return {
    template: recommendation,
    daysSinceLastSession:
      latestSessionMs === undefined
        ? null
        : getCalendarDayDistance(
            getLocalDateStartMs(now),
            getLocalDateStartMs(new Date(latestSessionMs)),
          ),
  };
};

/** Builds compact recovery buckets from each muscle group's latest completed workout. */
export const buildMuscleRecoveryStatuses = (
  exercises: Exercise[],
  sessions: WorkoutSession[],
  now = new Date(),
): MuscleRecoveryStatus[] => {
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const latestTrainingByMuscleGroup = new Map<MuscleGroupId, number>();
  const allMuscleGroups = new Set(exercises.flatMap((exercise) => exercise.muscleGroups));
  const nowMs = now.getTime();

  for (const session of sessions) {
    if (session.status !== "finished") {
      continue;
    }

    const sessionMs = new Date(session.finishedAt ?? session.startedAt).getTime();

    if (!Number.isFinite(sessionMs) || sessionMs > nowMs) {
      continue;
    }

    for (const sessionExercise of session.exercises) {
      if (!sessionExercise.sets.some((set) => set.isCompleted)) {
        continue;
      }

      for (const muscleGroupId of exerciseById.get(sessionExercise.exerciseId)?.muscleGroups ??
        []) {
        const latestTrainingMs = latestTrainingByMuscleGroup.get(muscleGroupId);

        if (latestTrainingMs === undefined || sessionMs > latestTrainingMs) {
          latestTrainingByMuscleGroup.set(muscleGroupId, sessionMs);
        }
      }
    }
  }

  const todayStartMs = getLocalDateStartMs(now);

  return [...allMuscleGroups]
    .map((muscleGroupId): MuscleRecoveryStatus => {
      const latestTrainingMs = latestTrainingByMuscleGroup.get(muscleGroupId);
      const daysSinceTrained =
        latestTrainingMs === undefined
          ? null
          : getCalendarDayDistance(todayStartMs, getLocalDateStartMs(new Date(latestTrainingMs)));
      const state: MuscleRecoveryState =
        daysSinceTrained === null || daysSinceTrained >= 4
          ? "ready"
          : daysSinceTrained >= 2
            ? "recent"
            : "rest";

      return { muscleGroupId, daysSinceTrained, state };
    })
    .sort((firstStatus, secondStatus) => {
      const stateOrder: Record<MuscleRecoveryState, number> = { ready: 0, recent: 1, rest: 2 };
      const stateDifference = stateOrder[firstStatus.state] - stateOrder[secondStatus.state];

      return stateDifference || firstStatus.muscleGroupId.localeCompare(secondStatus.muscleGroupId);
    });
};

/** Returns the session age when an active workout appears abandoned, otherwise null. */
export const getStaleWorkoutAgeHours = (
  session: WorkoutSession | undefined,
  now = new Date(),
): number | null => {
  if (!session || session.status !== "active") {
    return null;
  }

  const nowMs = now.getTime();
  const startedAtMs = new Date(session.startedAt).getTime();
  const latestActivityMs = Math.max(
    new Date(session.updatedAt).getTime(),
    ...session.exercises
      .flatMap((exercise) => exercise.sets)
      .map((set) => new Date(set.completedAt ?? session.startedAt).getTime()),
  );
  const ageHours = Math.floor((nowMs - startedAtMs) / millisecondsPerHour);
  const idleHours = (nowMs - latestActivityMs) / millisecondsPerHour;

  return ageHours >= 6 && idleHours >= 2 ? ageHours : null;
};
