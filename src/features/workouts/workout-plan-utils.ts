import type { EntityId, Exercise, WorkoutSession, WorkoutTemplateExercise } from "@/db";
import type { Messages } from "@/i18n";

/** Localized copy shared by the plan library and editor. */
export type PlanMessages = Messages["workouts"];

/** Editable prescription for an exercise in a plan. */
export type PlanExerciseDraft = {
  /** Exercise referenced by this entry. */
  exerciseId: EntityId;
  /** Optional set target as entered by the user. */
  targetSets: string;
  /** Optional rest target in seconds as entered by the user. */
  restSeconds: string;
  /** Plan-specific exercise notes, preserved through edits. */
  notes: string;
};

/** Unsaved plan with exercises in their intended workout order. */
export type PlanDraft = {
  /** Display name for the plan. */
  name: string;
  /** Selected exercises in workout order. */
  exercises: PlanExerciseDraft[];
};

/** Creates an empty plan draft. */
export const createPlanDraft = (): PlanDraft => ({ name: "", exercises: [] });

/** Copies persisted plan data into an independent, ordered editing draft. */
export const toPlanDraft = (name: string, exercises: WorkoutTemplateExercise[]): PlanDraft => ({
  name,
  exercises: [...exercises]
    .sort((first, second) => first.order - second.order)
    .map((exercise) => ({
      exerciseId: exercise.exerciseId,
      targetSets: exercise.targetSets === null ? "" : String(exercise.targetSets),
      restSeconds: exercise.restSeconds === null ? "" : String(exercise.restSeconds),
      notes: exercise.notes ?? "",
    })),
});

/** Converts a validated draft into ordered records without losing exercise notes. */
export const toPlanExercises = (draft: PlanDraft): WorkoutTemplateExercise[] =>
  draft.exercises.map((exercise, order) => ({
    exerciseId: exercise.exerciseId,
    order,
    targetSets: exercise.targetSets.trim() === "" ? null : Number(exercise.targetSets),
    restSeconds: exercise.restSeconds.trim() === "" ? null : Number(exercise.restSeconds),
    notes: exercise.notes.trim() === "" ? null : exercise.notes,
  }));

/** Checks an optional integer without silently dropping or rounding invalid input. */
const isOptionalInteger = (value: string, minimum: number): boolean => {
  const trimmed = value.trim();
  return (
    trimmed === "" ||
    (/^\d+$/.test(trimmed) && Number.isSafeInteger(Number(trimmed)) && Number(trimmed) >= minimum)
  );
};

/** Validates prescriptions before they are saved or used to start a workout. */
export const validatePlanDraft = (
  draft: PlanDraft,
  exerciseIds: ReadonlySet<EntityId>,
):
  | "validationNameRequired"
  | "validationExercisesRequired"
  | "validationTargets"
  | "validationMissingExercises"
  | null => {
  if (!draft.name.trim()) return "validationNameRequired";
  if (draft.exercises.length === 0) return "validationExercisesRequired";
  if (draft.exercises.some((exercise) => !exerciseIds.has(exercise.exerciseId)))
    return "validationMissingExercises";
  if (
    draft.exercises.some(
      (exercise) =>
        !isOptionalInteger(exercise.targetSets, 1) || !isOptionalInteger(exercise.restSeconds, 0),
    )
  )
    return "validationTargets";
  return null;
};

/** Moves one selected exercise while preserving its prescription and the input draft. */
export const movePlanExercise = (draft: PlanDraft, index: number, direction: -1 | 1): PlanDraft => {
  const target = index + direction;
  if (
    index < 0 ||
    index >= draft.exercises.length ||
    target < 0 ||
    target >= draft.exercises.length
  )
    return draft;
  const exercises = [...draft.exercises];
  const [exercise] = exercises.splice(index, 1);
  exercises.splice(target, 0, exercise);
  return { ...draft, exercises };
};

/** Matches exercise search text and both optional picker filters. */
export const filterPlanExercises = (
  exercises: Exercise[],
  query: string,
  muscleGroup: string,
  equipment: string,
): Exercise[] => {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return exercises.filter((exercise) => {
    const text =
      `${exercise.name} ${exercise.equipment ?? ""} ${exercise.muscleGroups.join(" ").replaceAll("-", " ")}`.toLocaleLowerCase();
    return (
      words.every((word) => text.includes(word)) &&
      (!muscleGroup || exercise.muscleGroups.includes(muscleGroup)) &&
      (!equipment || exercise.equipment === equipment)
    );
  });
};

/** Finds each plan's latest completion independently of repository ordering. */
export const getLastPlanCompletions = (sessions: WorkoutSession[]): Map<EntityId, string> => {
  const latest = new Map<EntityId, string>();
  for (const session of sessions) {
    if (session.status !== "finished" || session.templateId === null || session.finishedAt === null)
      continue;
    const timestamp = Date.parse(session.finishedAt);
    if (!Number.isFinite(timestamp)) continue;
    const previous = latest.get(session.templateId);
    if (!previous || timestamp > Date.parse(previous))
      latest.set(session.templateId, session.finishedAt);
  }
  return latest;
};

/** Formats a localized message with named values without assembling translated sentences. */
export const planMessage = (message: string, values: Record<string, string | number>): string =>
  message.replace(/\{(\w+)\}/g, (placeholder, key: string) => String(values[key] ?? placeholder));

/** Summarizes specified set targets without implying that unplanned exercises have zero sets. */
export const formatPlanSummary = (
  exercises: WorkoutTemplateExercise[],
  messages: PlanMessages,
): string => {
  const sets = exercises.reduce((total, exercise) => total + (exercise.targetSets ?? 0), 0);
  const hasAllTargets =
    exercises.length > 0 && exercises.every((exercise) => exercise.targetSets !== null);
  return planMessage(hasAllTargets ? messages.planSummary : messages.planSummaryPartial, {
    exercises: exercises.length,
    sets,
  });
};
