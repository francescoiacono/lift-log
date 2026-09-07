import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import {
  filterPlanExercises,
  formatPlanSummary,
  getLastPlanCompletions,
  movePlanExercise,
  toPlanDraft,
  toPlanExercises,
  validatePlanDraft,
} from "./workout-plan-utils";
import {
  createLiftLogDatabase,
  createTemplateExerciseBlocks,
  createWorkoutSessionRepository,
  createWorkoutTemplateRepository,
  type Exercise,
  type WorkoutSession,
  type WorkoutTemplateExercise,
} from "@/db";
import { getMessages } from "@/i18n";

const messages = getMessages().workouts;
const timestamp = "2026-09-07T10:00:00.000Z";
const plannedExercises: WorkoutTemplateExercise[] = [
  {
    exerciseId: "squat",
    order: 0,
    targetSets: 3,
    restSeconds: 120,
    notes: "Keep the same stance.\nPause at the bottom.",
  },
  { exerciseId: "plank", order: 1, targetSets: null, restSeconds: 0, notes: null },
];

/** Creates a complete exercise fixture for search and filtering. */
const exercise = (
  id: string,
  name: string,
  muscleGroups: string[],
  equipment: string | null,
): Exercise => ({
  id,
  name,
  muscleGroups,
  equipment,
  trackingMode: "weighted",
  notes: null,
  createdAt: timestamp,
  updatedAt: timestamp,
});

/** Creates a finished session fixture with overridable lifecycle and dates. */
const session = (overrides: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id: "session",
  templateId: "plan",
  name: "Full body",
  status: "finished",
  notes: null,
  exercises: [],
  startedAt: timestamp,
  finishedAt: timestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
  ...overrides,
});

describe("plan editing", () => {
  it("keeps notes, optional targets, zero rest, and workout order through a rename", () => {
    const draft = toPlanDraft("Full body", [...plannedExercises].reverse());
    draft.name = "Full body A";
    expect(toPlanExercises(draft)).toEqual(plannedExercises);
    expect(draft.exercises.map((entry) => entry.exerciseId)).toEqual(["squat", "plank"]);
  });

  it("moves the entire prescription without mutating the source or accepting out-of-bounds moves", () => {
    const draft = toPlanDraft("Full body", plannedExercises);
    const reordered = movePlanExercise(draft, 1, -1);
    expect(toPlanExercises(reordered)).toEqual([
      { ...plannedExercises[1], order: 0 },
      { ...plannedExercises[0], order: 1 },
    ]);
    expect(toPlanExercises(draft)).toEqual(plannedExercises);
    expect(movePlanExercise(draft, 0, -1)).toBe(draft);
    expect(movePlanExercise(draft, 1, 1)).toBe(draft);
  });

  it.each(["0", "-1", "2.5", "1e2", "Infinity", "9007199254740992"])(
    "rejects invalid set target %s instead of silently changing it",
    (value) => {
      const draft = toPlanDraft("Full body", plannedExercises);
      draft.exercises[0].targetSets = value;
      expect(validatePlanDraft(draft, new Set(["squat", "plank"]))).toBe("validationTargets");
    },
  );

  it("accepts optional targets and zero rest, and identifies missing exercises", () => {
    const draft = toPlanDraft("Full body", plannedExercises);
    expect(validatePlanDraft(draft, new Set(["squat", "plank"]))).toBeNull();
    expect(validatePlanDraft(draft, new Set(["squat"]))).toBe("validationMissingExercises");
    draft.exercises[0].restSeconds = "-10";
    expect(validatePlanDraft(draft, new Set(["squat", "plank"]))).toBe("validationTargets");
  });

  it("requires a name and at least one exercise", () => {
    expect(validatePlanDraft({ name: " ", exercises: [] }, new Set())).toBe(
      "validationNameRequired",
    );
    expect(validatePlanDraft({ name: "Upper A", exercises: [] }, new Set())).toBe(
      "validationExercisesRequired",
    );
  });

  it("saves edits and duplicates independently while existing workout snapshots stay intact", async () => {
    const database = createLiftLogDatabase("lift-log-plan-editing-regression");
    try {
      const plans = createWorkoutTemplateRepository({ database });
      const workouts = createWorkoutSessionRepository({ database });
      const original = await plans.create({ name: "Full body", exercises: plannedExercises });
      const active = await workouts.startFromTemplate(original.id);
      const draft = movePlanExercise(toPlanDraft(original.name, original.exercises), 1, -1);
      await plans.update(original.id, { name: "Full body A", exercises: toPlanExercises(draft) });
      const duplicate = await plans.create({
        name: "Full body B",
        exercises: toPlanExercises(draft),
      });
      draft.exercises[1].notes = "Different cue for B";
      await plans.update(duplicate.id, { exercises: toPlanExercises(draft) });

      const savedOriginal = await plans.getById(original.id);
      const savedCopy = await plans.getById(duplicate.id);
      expect(duplicate.id).not.toBe(original.id);
      expect(savedOriginal?.exercises.map((entry) => entry.exerciseId)).toEqual(["plank", "squat"]);
      expect(savedOriginal?.exercises[1].notes).toBe(plannedExercises[0].notes);
      expect(savedCopy?.exercises[1].notes).toBe("Different cue for B");
      expect((await workouts.getActive())?.session).toEqual(active?.session);
      expect(
        (await workouts.getActive())?.session.exercises.map((entry) => entry.exerciseId),
      ).toEqual(["squat", "plank"]);
    } finally {
      await database.delete();
    }
  });

  it("uses the same history conversion as repositories and leaves the source workout untouched", () => {
    const source = session({
      exercises: [
        {
          exerciseId: "squat",
          order: 0,
          targetSets: null,
          restSeconds: null,
          notes: "Use the safety bars",
          sets: [
            {
              id: "set",
              order: 0,
              reps: 8,
              weight: 80,
              weightUnit: "kg",
              isCompleted: true,
              completedAt: timestamp,
              restSeconds: 90,
              notes: null,
            },
          ],
        },
      ],
    });
    const before = structuredClone(source);
    const draft = toPlanDraft("New routine", createTemplateExerciseBlocks(source.exercises));
    expect(toPlanExercises(draft)).toEqual([
      {
        exerciseId: "squat",
        order: 0,
        targetSets: 1,
        restSeconds: 90,
        notes: "Use the safety bars",
      },
    ]);
    draft.exercises[0].notes = "Edited plan cue";
    expect(source).toEqual(before);
  });
});

describe("plan library context", () => {
  it("combines search words with muscle and equipment filters without changing order", () => {
    const exercises = [
      exercise("bench", "Incline press", ["chest", "shoulders"], "Barbell"),
      exercise("dumbbells", "Incline press", ["chest"], "Dumbbells"),
      exercise("squat", "Squat", ["quadriceps"], "Barbell"),
    ];
    expect(
      filterPlanExercises(exercises, " INCLINE chest ", "shoulders", "Barbell").map(
        (entry) => entry.id,
      ),
    ).toEqual(["bench"]);
    expect(filterPlanExercises(exercises, "incline", "", "").map((entry) => entry.id)).toEqual([
      "bench",
      "dumbbells",
    ]);
    expect(filterPlanExercises(exercises, "", "chest", "Cable")).toEqual([]);
  });

  it("uses the latest valid finished timestamp for each plan, excluding ad-hoc and unfinished sessions", () => {
    const sessions = [
      session({ finishedAt: "2026-09-05T10:00:00.000Z" }),
      session({ finishedAt: "2026-09-07T10:00:00.000Z", startedAt: "2026-08-01T10:00:00.000Z" }),
      session({ finishedAt: "2026-09-06T10:00:00.000Z" }),
      session({ templateId: "other", status: "active" }),
      session({ templateId: null }),
      session({ templateId: "invalid", finishedAt: "invalid" }),
      session({ templateId: "discarded", status: "discarded" }),
    ];
    expect([...getLastPlanCompletions(sessions)]).toEqual([["plan", "2026-09-07T10:00:00.000Z"]]);
  });

  it("avoids presenting a partial set total as the full workout target", () => {
    expect(formatPlanSummary(plannedExercises, messages)).toContain("Some set targets unset");
    expect(formatPlanSummary([plannedExercises[0]], messages)).toBe(
      "Exercises: 1 · Planned sets: 3",
    );
  });
});
