import type { WorkoutSession, WorkoutSessionExercise, WorkoutSet } from "@/db";

/** Aggregate values displayed before an active workout is saved. */
export type WorkoutFinishReviewSummary = {
  /** Number of exercises included in the workout. */
  exerciseCount: number;

  /** Number of completed sets logged across the workout. */
  completedSetCount: number;

  /** Number of planned sets that have not been completed. */
  incompleteSetCount: number;

  /** Mean effort across completed sets carrying a rating. */
  averageEffort: number | null;
};

/** Returns completed sets for one workout exercise in display order. */
export const getCompletedWorkoutSets = (exercise: WorkoutSessionExercise): WorkoutSet[] => {
  return exercise.sets
    .filter((set) => set.isCompleted)
    .sort((firstSet, secondSet) => firstSet.order - secondSet.order);
};

/** Calculates mean perceived effort from completed, rated sets. */
export const calculateAverageSetEffort = (sets: WorkoutSet[]): number | null => {
  const effortRatings = sets.flatMap((set) =>
    set.isCompleted && set.effortRating ? [set.effortRating] : [],
  );

  if (effortRatings.length === 0) {
    return null;
  }

  return effortRatings.reduce((total, rating) => total + rating, 0) / effortRatings.length;
};

/** Builds the aggregate review shown before finishing a workout. */
export const buildWorkoutFinishReviewSummary = (
  session: WorkoutSession,
): WorkoutFinishReviewSummary => {
  const completedSets = session.exercises.flatMap(getCompletedWorkoutSets);
  const incompleteSetCount = session.exercises.reduce((total, exercise) => {
    if (exercise.targetSets === null) {
      return total;
    }

    return total + Math.max(0, exercise.targetSets - getCompletedWorkoutSets(exercise).length);
  }, 0);

  return {
    exerciseCount: session.exercises.length,
    completedSetCount: completedSets.length,
    incompleteSetCount,
    averageEffort: calculateAverageSetEffort(completedSets),
  };
};
