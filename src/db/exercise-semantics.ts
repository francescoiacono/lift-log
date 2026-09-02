import type { ExerciseTrackingMode, MuscleGroupId } from "./entities";

/** Legacy progress flags accepted while migrating older exercise records. */
export type LegacyExerciseTrackingFlags = {
  /** Whether the older record tracked time instead of repetitions. */
  tracksDuration?: boolean;

  /** Whether the older record treated lower logged weight as better. */
  tracksAssistance?: boolean;
};

const trackingModes = new Set<ExerciseTrackingMode>([
  "assisted",
  "bodyweight",
  "timed",
  "weighted",
]);

const muscleGroupAliases: Readonly<Record<string, MuscleGroupId>> = {
  abs: "core",
  abdominals: "core",
  bicep: "biceps",
  calf: "calves",
  deltoid: "shoulders",
  deltoids: "shoulders",
  glute: "glutes",
  hamstring: "hamstrings",
  lat: "back",
  lats: "back",
  pec: "chest",
  pecs: "chest",
  pectorals: "chest",
  quad: "quadriceps",
  quads: "quadriceps",
  shoulder: "shoulders",
  tricep: "triceps",
};

/** Resolves current and legacy exercise fields into one canonical tracking mode. */
export const normalizeExerciseTrackingMode = (
  trackingMode: unknown,
  legacyFlags: LegacyExerciseTrackingFlags = {},
): ExerciseTrackingMode => {
  if (typeof trackingMode === "string" && trackingModes.has(trackingMode as ExerciseTrackingMode)) {
    return trackingMode as ExerciseTrackingMode;
  }

  if (legacyFlags.tracksDuration) {
    return "timed";
  }

  if (legacyFlags.tracksAssistance) {
    return "assisted";
  }

  return "weighted";
};

/** Converts free-form muscle-group text into a stable kebab-case identifier. */
export const normalizeMuscleGroupId = (value: string): MuscleGroupId => {
  const identifier = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return muscleGroupAliases[identifier] ?? identifier;
};

/** Normalizes, de-duplicates, and removes empty muscle-group identifiers. */
export const normalizeMuscleGroupIds = (values: readonly string[]): MuscleGroupId[] => {
  return [
    ...new Set(
      values.map((value) => normalizeMuscleGroupId(value)).filter((value) => value !== ""),
    ),
  ];
};

/** Formats a normalized muscle-group identifier for user-facing labels. */
export const formatMuscleGroupLabel = (identifier: MuscleGroupId): string => {
  return identifier
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
};
