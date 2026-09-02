import { describe, expect, it } from "vitest";

import {
  formatMuscleGroupLabel,
  normalizeExerciseTrackingMode,
  normalizeMuscleGroupIds,
} from "./exercise-semantics";

describe("exercise semantics", () => {
  it("normalizes casing, aliases, separators, and duplicates", () => {
    expect(
      normalizeMuscleGroupIds(["Deltoids", "shoulders", "TRICEPS", "posterior chain"]),
    ).toEqual(["shoulders", "triceps", "posterior-chain"]);
  });

  it("formats normalized muscle groups for display", () => {
    expect(formatMuscleGroupLabel("posterior-chain")).toBe("Posterior Chain");
  });

  it("uses canonical modes before legacy flags", () => {
    expect(
      normalizeExerciseTrackingMode("bodyweight", {
        tracksAssistance: true,
        tracksDuration: true,
      }),
    ).toBe("bodyweight");
  });

  it("migrates timed and assisted legacy flags", () => {
    expect(normalizeExerciseTrackingMode(undefined, { tracksDuration: true })).toBe("timed");
    expect(normalizeExerciseTrackingMode(undefined, { tracksAssistance: true })).toBe("assisted");
    expect(normalizeExerciseTrackingMode(undefined)).toBe("weighted");
  });
});
