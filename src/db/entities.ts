/** Stable application-level identifier stored in IndexedDB records. */
export type EntityId = string;

/** ISO 8601 timestamp string used for persisted record dates. */
export type IsoDateTime = string;

/** Weight unit values supported by workout logging. */
export type WeightUnit = "kg" | "lb";

/** Lifecycle states for persisted workout sessions. */
export type WorkoutSessionStatus = "active" | "finished" | "discarded";

/** Exercise available for templates and workout sessions. */
export type Exercise = {
  /** Stable exercise identifier. */
  id: EntityId;

  /** User-facing exercise name. */
  name: string;

  /** Muscle groups associated with the exercise. */
  muscleGroups: string[];

  /** Equipment required for the exercise, when any. */
  equipment: string | null;

  /** Optional user notes for setup, cues, or substitutions. */
  notes: string | null;

  /** Timestamp for when the exercise was created. */
  createdAt: IsoDateTime;

  /** Timestamp for the most recent exercise change. */
  updatedAt: IsoDateTime;
};

/** Exercise entry within a reusable workout template. */
export type WorkoutTemplateExercise = {
  /** Exercise identifier referenced by this template entry. */
  exerciseId: EntityId;

  /** Zero-based display order inside the template. */
  order: number;

  /** Planned number of sets, when the template specifies one. */
  targetSets: number | null;

  /** Planned rest duration after each set, when specified. */
  restSeconds: number | null;

  /** Optional template-specific notes for this exercise. */
  notes: string | null;
};

/** Reusable workout template such as Push, Pull, or Legs. */
export type WorkoutTemplate = {
  /** Stable workout template identifier. */
  id: EntityId;

  /** User-facing workout template name. */
  name: string;

  /** Ordered exercise entries included in the template. */
  exercises: WorkoutTemplateExercise[];

  /** Timestamp for when the template was created. */
  createdAt: IsoDateTime;

  /** Timestamp for the most recent template change. */
  updatedAt: IsoDateTime;
};

/** Logged set within a workout session exercise. */
export type WorkoutSet = {
  /** Stable set identifier scoped to the session payload. */
  id: EntityId;

  /** Zero-based display order inside the exercise. */
  order: number;

  /** Logged repetition count, when entered. */
  reps: number | null;

  /** Logged weight, when entered. */
  weight: number | null;

  /** Unit used for the logged weight. */
  weightUnit: WeightUnit;

  /** Whether the set has been completed by the user. */
  isCompleted: boolean;

  /** Timestamp for when the set was completed. */
  completedAt: IsoDateTime | null;

  /** Rest duration started after this set, when one was used. */
  restSeconds: number | null;

  /** Optional notes for the logged set. */
  notes: string | null;
};

/** Exercise block logged inside a workout session. */
export type WorkoutSessionExercise = {
  /** Exercise identifier referenced by this session entry. */
  exerciseId: EntityId;

  /** Zero-based display order inside the workout session. */
  order: number;

  /** Planned number of sets copied into this session, when available. */
  targetSets: number | null;

  /** Planned rest duration copied into this session, when available. */
  restSeconds: number | null;

  /** Sets logged for this exercise during the session. */
  sets: WorkoutSet[];

  /** Optional session-specific notes for this exercise. */
  notes: string | null;
};

/** Workout session saved to local history or currently in progress. */
export type WorkoutSession = {
  /** Stable workout session identifier. */
  id: EntityId;

  /** Template used to start the session, when any. */
  templateId: EntityId | null;

  /** User-facing session name, when customized. */
  name: string | null;

  /** Current lifecycle state for the workout session. */
  status: WorkoutSessionStatus;

  /** Ordered exercise blocks logged in the session. */
  exercises: WorkoutSessionExercise[];

  /** Optional notes for the full workout session. */
  notes: string | null;

  /** Timestamp for when the workout session started. */
  startedAt: IsoDateTime;

  /** Timestamp for when the workout session finished. */
  finishedAt: IsoDateTime | null;

  /** Timestamp for when the session record was created. */
  createdAt: IsoDateTime;

  /** Timestamp for the most recent session change. */
  updatedAt: IsoDateTime;
};

/** App-level settings persisted locally for the current device. */
export type AppSettings = {
  /** Singleton settings record identifier. */
  id: "app";

  /** Preferred unit for newly logged weights. */
  weightUnit: WeightUnit;

  /** Default rest duration offered after completing a set. */
  defaultRestSeconds: number;

  /** Timestamp for when the settings record was created. */
  createdAt: IsoDateTime;

  /** Timestamp for the most recent settings change. */
  updatedAt: IsoDateTime;
};

/** Active rest timer state persisted with the active workout. */
export type ActiveRestTimer = {
  /** Timestamp for when the timer started. */
  startedAt: IsoDateTime;

  /** Timer duration selected by the user. */
  durationSeconds: number;

  /** Timestamp for when the timer is expected to finish. */
  endsAt: IsoDateTime;

  /** Set identifier that started the timer, when available. */
  relatedSetId: EntityId | null;
};

/** Pointer to the current in-progress workout and timer state. */
export type ActiveWorkout = {
  /** Singleton active workout record identifier. */
  id: "current";

  /** Active workout session identifier. */
  sessionId: EntityId;

  /** Active rest timer state, when one is running. */
  restTimer: ActiveRestTimer | null;

  /** Timestamp for when active workout tracking started. */
  startedAt: IsoDateTime;

  /** Timestamp for the most recent active workout change. */
  updatedAt: IsoDateTime;
};
