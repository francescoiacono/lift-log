import type { ExerciseProgressKind } from "./exercise-insights";
import type { WeightUnit } from "@/db";
import type { Messages } from "@/i18n";

/** Formats a compact progress value with its unit. */
export const formatExerciseProgressValue = (
  value: number,
  kind: ExerciseProgressKind,
  weightUnit: WeightUnit,
  messages: Messages["exercises"],
): string => {
  const formattedValue = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  }).format(value);

  if (kind === "duration") {
    return `${formattedValue} ${messages.secondsSuffix}`;
  }

  if (kind === "repetitions") {
    return `${formattedValue} ${messages.repsSuffix}`;
  }

  return `${formattedValue} ${weightUnit}`;
};

/** Returns the localized label for an exercise progress metric. */
export const getExerciseProgressMetricLabel = (
  kind: ExerciseProgressKind,
  messages: Messages["exercises"],
): string => {
  if (kind === "duration") {
    return messages.durationProgressLabel;
  }

  if (kind === "assistance") {
    return messages.assistanceProgressLabel;
  }

  if (kind === "repetitions") {
    return messages.repetitionsProgressLabel;
  }

  return kind === "weight" ? messages.weightProgressLabel : messages.estimatedStrengthProgressLabel;
};
