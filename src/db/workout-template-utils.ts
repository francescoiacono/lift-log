import type { WorkoutSessionExercise, WorkoutSet, WorkoutTemplateExercise } from "./entities";

/** Returns the most recent logged rest duration for a session exercise, when available. */
const getMostRecentLoggedRestSeconds = (sets: WorkoutSet[]): number | null => {
  const mostRecentSetWithRest = [...sets]
    .sort((firstSet, secondSet) => secondSet.order - firstSet.order)
    .find((set) => set.restSeconds !== null);

  return mostRecentSetWithRest?.restSeconds ?? null;
};

/** Converts workout exercise blocks into reusable template exercise entries. */
export const createTemplateExerciseBlocks = (
  exercises: WorkoutSessionExercise[],
): WorkoutTemplateExercise[] => {
  return [...exercises]
    .sort((first, second) => first.order - second.order)
    .map((exercise, index) => ({
      exerciseId: exercise.exerciseId,
      notes: exercise.notes,
      order: index,
      restSeconds: exercise.restSeconds ?? getMostRecentLoggedRestSeconds(exercise.sets),
      targetSets: exercise.targetSets ?? (exercise.sets.length > 0 ? exercise.sets.length : null),
    }));
};
