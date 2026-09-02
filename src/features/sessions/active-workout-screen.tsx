import * as Dialog from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Cloud,
  ClipboardList,
  Copy,
  Dumbbell,
  Flame,
  History,
  HeartPulse,
  ListChecks,
  MoreVertical,
  Sparkles,
  Star,
  Timer,
  TrendingUp,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  buildMuscleRecoveryStatuses,
  calculateTrainingDayStreak,
  findLastSessionSets,
  getStaleWorkoutAgeHours,
  recommendWorkoutTemplate,
  type LastSessionSets,
  type MuscleRecoveryStatus,
} from "./active-workout-dashboard-metrics";
import { styles } from "./active-workout-screen.styles";
import type {
  ActiveRestTimer,
  AppSettings,
  ActiveWorkoutSnapshot,
  EntityId,
  Exercise,
  ExerciseRepository,
  SettingsRepository,
  WorkoutSet,
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSessionRepository,
  WorkoutTemplate,
  WorkoutTemplateRepository,
} from "@/db";
import {
  defaultWeeklyWorkoutTarget,
  exerciseRepository,
  formatMuscleGroupLabel,
  settingsRepository,
  workoutSessionRepository,
  workoutTemplateRepository,
} from "@/db";
import {
  buildExerciseProgress,
  buildWeeklyTrainingSummaries,
  convertWeight,
  type ExerciseProgressKind,
  type ExerciseProgressPoint,
} from "@/features/history";
import type { Messages } from "@/i18n";

/** Message dictionary used by the active workout feature. */
type ActiveWorkoutMessages = Messages["sessions"];

/** Props for the active workout screen. */
export type ActiveWorkoutScreenProps = {
  /** Localized copy used by the active workout UI. */
  messages: ActiveWorkoutMessages;

  /** Whether the active workout screen is the currently visible app view. */
  isActive?: boolean;

  /** Initial feedback shown when the screen is mounted after an app-level event. */
  initialFeedbackMessage?: string | null;

  /** Repository used to persist workout sessions. */
  repository?: WorkoutSessionRepository;

  /** Repository used to read workout plans for quick starts. */
  templateRepository?: WorkoutTemplateRepository;

  /** Repository used to read exercise names for session entries. */
  exerciseStore?: ExerciseRepository;

  /** Repository used to load dashboard insight preferences. */
  settingsStore?: SettingsRepository;

  /** Called when the user wants to inspect saved workout history. */
  onOpenHistory?: () => void;

  /** Called after the initial feedback message has been copied into local UI state. */
  onInitialFeedbackShown?: () => void;
};

/** Async loading states used by the active workout screen. */
type LoadState = "loading" | "ready" | "error";

/** Editable set logging fields for one exercise. */
type SetDraftState = {
  /** Controlled reps input value. */
  reps: string;

  /** Controlled hold duration input value for timed exercises. */
  durationSeconds: string;

  /** Controlled weight input value. */
  weight: string;

  /** Controlled rest duration input value. */
  restSeconds: string;
};

/** Editable set logging state keyed by exercise id. */
type SetDraftsByExerciseId = Partial<Record<EntityId, SetDraftState>>;

/** Numeric set fields editable from an active workout exercise. */
type SetDraftNumberField = "durationSeconds" | "reps" | "restSeconds" | "weight";

/** Target set currently being edited. */
type EditingSetTarget = {
  /** Exercise identifier that owns the edited set. */
  exerciseId: EntityId;

  /** Set identifier currently open in the settings dialog. */
  setId: EntityId;
};

/** Recent personal-best item shown on the focused Today dashboard. */
type RecentProgressHighlight = {
  /** Exercise that produced the improvement. */
  exercise: Exercise;

  /** Progress metric used to compare the exercise. */
  kind: ExerciseProgressKind;

  /** Most recent record-setting performance. */
  point: ExerciseProgressPoint;
};

/** Creates an empty draft for logging a completed set. */
const createEmptySetDraft = (): SetDraftState => {
  return {
    reps: "",
    durationSeconds: "",
    weight: "",
    restSeconds: "",
  };
};

/** Returns a set draft for an exercise, falling back to a blank draft. */
const getSetDraft = (drafts: SetDraftsByExerciseId, exerciseId: EntityId): SetDraftState => {
  return drafts[exerciseId] ?? createEmptySetDraft();
};

/** Formats a message template containing a single count placeholder. */
const formatCountMessage = (template: string, count: number): string => {
  return template.replace("{count}", String(count));
};

/** Formats a message template containing a number and unit placeholder. */
const formatWeightMessage = (template: string, weight: number, unit: string): string => {
  const formattedWeight = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(weight);

  return template.replace("{weight}", formattedWeight).replace("{unit}", unit);
};

/** Formats a nullable integer for a controlled number input. */
const formatOptionalInteger = (value: number | null): string => {
  return value === null ? "" : String(value);
};

/** Formats a nullable number for a controlled decimal input. */
const formatOptionalNumber = (value: number | null): string => {
  return value === null ? "" : String(value);
};

/** Formats a rest countdown as minutes and seconds. */
const formatTimerDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
};

/** Calculates the remaining seconds for a persisted rest timer. */
const getRemainingRestSeconds = (restTimer: ActiveRestTimer, nowMs: number): number => {
  return Math.max(0, Math.ceil((new Date(restTimer.endsAt).getTime() - nowMs) / 1000));
};

/** Formats a session title, falling back when the session has no custom name. */
const formatSessionTitle = (name: string | null, messages: ActiveWorkoutMessages): string => {
  return name ?? messages.sessionTitleFallback;
};

/** Formats a session start timestamp for quick visual scanning. */
const formatStartedAt = (startedAt: string, messages: ActiveWorkoutMessages): string => {
  const startedTime = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(startedAt));

  return messages.startedAt.replace("{time}", startedTime);
};

/** Formats the exercise count label shown in the header. */
const formatExerciseCount = (count: number, messages: ActiveWorkoutMessages): string => {
  return count === 1
    ? messages.exerciseCountSingular
    : formatCountMessage(messages.exerciseCountPlural, count);
};

/** Formats the set count label shown on each exercise row. */
const formatSetCount = (count: number, messages: ActiveWorkoutMessages): string => {
  if (count === 0) {
    return messages.noSets;
  }

  return count === 1
    ? messages.setCountSingular
    : formatCountMessage(messages.setCountPlural, count);
};

/** Formats completed set progress against a planned set target. */
const formatSetProgress = (
  completedSets: number,
  targetSets: number | null | undefined,
  messages: ActiveWorkoutMessages,
): string => {
  if (!targetSets) {
    return formatSetCount(completedSets, messages);
  }

  return messages.setProgress
    .replace("{completed}", String(completedSets))
    .replace("{target}", String(targetSets));
};

/** Formats the planned rest target for an active workout exercise. */
const formatRestTarget = (
  restSeconds: number | null | undefined,
  messages: ActiveWorkoutMessages,
): string | null => {
  if (!restSeconds) {
    return null;
  }

  return messages.restTarget.replace("{seconds}", String(restSeconds));
};

/** Formats exercise progress and rest target metadata. */
const formatExerciseMeta = (
  sessionExercise: WorkoutSessionExercise,
  messages: ActiveWorkoutMessages,
): string => {
  const restTarget = formatRestTarget(sessionExercise.restSeconds, messages);
  const setProgress = formatSetProgress(
    sessionExercise.sets.filter((set) => set.isCompleted).length,
    sessionExercise.targetSets,
    messages,
  );

  return restTarget ? `${setProgress} · ${restTarget}` : setProgress;
};

/** Formats a compact numeric stat for dashboard cards. */
const formatDashboardNumber = (value: number): string => {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 0,
  }).format(value);
};

/** Formats the reason attached to the recommended workout on Today. */
const formatRecommendationReason = (
  daysSinceLastSession: number | null,
  messages: ActiveWorkoutMessages,
): string => {
  if (daysSinceLastSession === null) {
    return messages.recommendationNeverCompleted;
  }

  if (daysSinceLastSession === 0) {
    return messages.recommendationCompletedToday;
  }

  if (daysSinceLastSession === 1) {
    return messages.recommendationCompletedYesterday;
  }

  return messages.recommendationCompletedDays.replace("{days}", String(daysSinceLastSession));
};

/** Formats one recent progress highlight using its metric semantics. */
const formatProgressHighlight = (
  highlight: RecentProgressHighlight,
  weightUnit: AppSettings["weightUnit"],
  messages: ActiveWorkoutMessages,
): string => {
  const value = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
    highlight.point.value,
  );

  if (highlight.kind === "duration") {
    return messages.progressTimed
      .replace("{name}", highlight.exercise.name)
      .replace("{value}", value);
  }

  if (highlight.kind === "assistance") {
    return messages.progressAssisted
      .replace("{name}", highlight.exercise.name)
      .replace("{value}", value)
      .replace("{unit}", weightUnit);
  }

  if (highlight.kind === "repetitions") {
    return messages.progressRepetitions
      .replace("{name}", highlight.exercise.name)
      .replace("{value}", value);
  }

  return messages.progressWeighted
    .replace("{name}", highlight.exercise.name)
    .replace("{value}", value)
    .replace("{unit}", weightUnit);
};

/** Formats a compact previous-best value for the active workout. */
const formatPreviousBestValue = (
  highlight: RecentProgressHighlight,
  weightUnit: AppSettings["weightUnit"],
  messages: ActiveWorkoutMessages,
): string => {
  const value = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
    highlight.point.value,
  );

  if (highlight.kind === "duration") {
    return messages.previousBestDuration.replace("{value}", value);
  }

  if (highlight.kind === "repetitions") {
    return messages.previousBestRepetitions.replace("{value}", value);
  }

  return messages.previousBestWeight.replace("{value}", value).replace("{unit}", weightUnit);
};

/** Formats the compact recency line for one muscle-recovery item. */
const formatRecoveryRecency = (
  status: MuscleRecoveryStatus,
  messages: ActiveWorkoutMessages,
): string => {
  if (status.daysSinceTrained === null) {
    return messages.recoveryNeverTrained;
  }

  if (status.daysSinceTrained === 0) {
    return messages.recoveryTrainedToday;
  }

  if (status.daysSinceTrained === 1) {
    return messages.recoveryTrainedYesterday;
  }

  return messages.recoveryTrainedDays.replace("{days}", String(status.daysSinceTrained));
};

/** Returns localized copy for a muscle-recovery state. */
const getRecoveryStateLabel = (
  status: MuscleRecoveryStatus,
  messages: ActiveWorkoutMessages,
): string => {
  if (status.state === "ready") {
    return messages.recoveryReady;
  }

  if (status.state === "recent") {
    return messages.recoveryRecent;
  }

  return messages.recoveryRest;
};

/** Returns completed and planned set totals for active-session progress. */
const getWorkoutSetProgress = (
  session: WorkoutSession,
): { completedSets: number; plannedSets: number } => {
  const plannedSets = session.exercises.reduce(
    (total, exercise) => total + (exercise.targetSets ?? 0),
    0,
  );
  const exercisesInProgress =
    plannedSets > 0
      ? session.exercises.filter((exercise) => exercise.targetSets !== null)
      : session.exercises;
  const completedSets = exercisesInProgress.reduce(
    (total, exercise) => total + exercise.sets.filter((set) => set.isCompleted).length,
    0,
  );

  return { completedSets, plannedSets };
};

/** Calculates percent completion for the active workout card. */
const calculateWorkoutCompletionPercent = (session: WorkoutSession | undefined): number => {
  if (!session) {
    return 0;
  }

  const { completedSets, plannedSets } = getWorkoutSetProgress(session);

  if (plannedSets === 0) {
    return completedSets > 0 ? 100 : 0;
  }

  return Math.min(100, Math.round((completedSets / plannedSets) * 100));
};

/** Formats a set's primary effort as either a hold duration or a rep count. */
const formatSetEffort = (set: WorkoutSet, messages: ActiveWorkoutMessages): string => {
  if (set.durationSeconds != null) {
    return messages.durationValue.replace("{seconds}", String(set.durationSeconds));
  }

  return set.reps === null ? messages.noReps : formatCountMessage(messages.repsCount, set.reps);
};

/** Formats a completed set into a compact workout log summary. */
const formatLoggedSet = (set: WorkoutSet, messages: ActiveWorkoutMessages): string => {
  const setLabel = messages.setNumberLabel.replace("{number}", String(set.order + 1));
  const repsLabel = formatSetEffort(set, messages);
  const weightLabel =
    set.weight === null
      ? messages.noWeight
      : formatWeightMessage(messages.weightValue, set.weight, set.weightUnit);
  const restLabel =
    set.restSeconds === null
      ? messages.noRestLogged
      : messages.restValue.replace("{seconds}", String(set.restSeconds));

  return `${setLabel} · ${repsLabel} · ${weightLabel} · ${restLabel}`;
};

/** Formats one previous set as a compact weight × reps (or hold duration) summary. */
const formatLastSessionSet = (set: WorkoutSet, messages: ActiveWorkoutMessages): string => {
  if (set.durationSeconds != null) {
    const durationText = messages.durationValue.replace("{seconds}", String(set.durationSeconds));

    return set.weight === null
      ? durationText
      : `${formatWeightMessage(messages.weightValue, set.weight, set.weightUnit)} · ${durationText}`;
  }

  const repsText = set.reps === null ? messages.noReps : String(set.reps);

  if (set.weight === null) {
    return repsText;
  }

  return `${formatWeightMessage(messages.weightValue, set.weight, set.weightUnit)} × ${repsText}`;
};

/** Formats an exercise toggle label with the target exercise name. */
const formatExerciseToggleLabel = (template: string, exerciseName: string): string => {
  return template.replace("{name}", exerciseName);
};

/** Formats a set action label with the target set and exercise names. */
const formatSetActionLabel = (template: string, set: WorkoutSet, exerciseName: string): string => {
  return template.replace("{number}", String(set.order + 1)).replace("{exercise}", exerciseName);
};

/** Sorts persisted session exercises by their display order. */
const sortSessionExercises = (exercises: WorkoutSessionExercise[]): WorkoutSessionExercise[] => {
  return [...exercises].sort(
    (firstExercise, secondExercise) => firstExercise.order - secondExercise.order,
  );
};

/** Sorts persisted workout sets by their display order. */
const sortWorkoutSets = (sets: WorkoutSet[]): WorkoutSet[] => {
  return [...sets].sort((firstSet, secondSet) => firstSet.order - secondSet.order);
};

/** Sorts workout sessions by newest start time first. */
const sortWorkoutSessionsByStartedAt = (sessions: WorkoutSession[]): WorkoutSession[] => {
  return [...sessions].sort(
    (firstSession, secondSession) =>
      new Date(secondSession.startedAt).getTime() - new Date(firstSession.startedAt).getTime(),
  );
};

/** Sorts workout templates by display name. */
const sortWorkoutTemplatesByName = (templates: WorkoutTemplate[]): WorkoutTemplate[] => {
  return [...templates].sort((firstTemplate, secondTemplate) =>
    firstTemplate.name.localeCompare(secondTemplate.name),
  );
};

/** Creates a useful default name when saving an ad-hoc workout as a plan. */
const createDefaultPlanName = (
  session: WorkoutSession,
  messages: ActiveWorkoutMessages,
): string => {
  const sessionName = session.name?.trim();

  return sessionName && sessionName !== messages.emptyWorkoutName
    ? sessionName
    : messages.saveAsPlanNameFallback;
};

/** Parses a required positive integer from a controlled input value. */
const toPositiveInteger = (value: string): number | undefined => {
  const trimmedValue = value.trim();
  const numericValue = Number(trimmedValue);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return undefined;
  }

  return Math.trunc(numericValue);
};

/** Parses an optional non-negative integer from a controlled input value. */
const toOptionalNonNegativeInteger = (value: string): number | null | undefined => {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return null;
  }

  const numericValue = Number(trimmedValue);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return undefined;
  }

  return Math.trunc(numericValue);
};

/** Parses an optional non-negative number from a controlled input value. */
const toOptionalNonNegativeNumber = (value: string): number | null | undefined => {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return null;
  }

  const numericValue = Number(trimmedValue);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return undefined;
  }

  return numericValue;
};

/** Validated reps/duration for a set, or a message when the effort field is invalid. */
type SetEffortResult = { reps: number | null; durationSeconds: number | null } | { error: string };

/** Reads reps or hold duration from a set draft based on the exercise tracking type. */
const readSetEffort = (
  tracksDuration: boolean,
  draft: Pick<SetDraftState, "durationSeconds" | "reps">,
  messages: ActiveWorkoutMessages,
): SetEffortResult => {
  if (tracksDuration) {
    const durationSeconds = toPositiveInteger(draft.durationSeconds);

    return durationSeconds === undefined
      ? { error: messages.validationDurationRequired }
      : { reps: null, durationSeconds };
  }

  const reps = toPositiveInteger(draft.reps);

  return reps === undefined
    ? { error: messages.validationRepsRequired }
    : { reps, durationSeconds: null };
};

/** Mobile-first screen for the current active workout session. */
export const ActiveWorkoutScreen = ({
  messages,
  isActive = true,
  initialFeedbackMessage = null,
  repository = workoutSessionRepository,
  templateRepository = workoutTemplateRepository,
  exerciseStore = exerciseRepository,
  settingsStore = settingsRepository,
  onOpenHistory,
  onInitialFeedbackShown,
}: ActiveWorkoutScreenProps) => {
  const [snapshot, setSnapshot] = useState<ActiveWorkoutSnapshot | undefined>();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [finishedSessions, setFinishedSessions] = useState<WorkoutSession[]>([]);
  const [settings, setSettings] = useState<AppSettings | undefined>();
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(initialFeedbackMessage);
  const [isStartingWorkout, setIsStartingWorkout] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isSavePlanDialogOpen, setIsSavePlanDialogOpen] = useState(false);
  const [savePlanName, setSavePlanName] = useState("");
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [isClearingTimer, setIsClearingTimer] = useState(false);
  const [addingExerciseId, setAddingExerciseId] = useState<EntityId | null>(null);
  const [savingSetExerciseId, setSavingSetExerciseId] = useState<EntityId | null>(null);
  const [setDrafts, setSetDrafts] = useState<SetDraftsByExerciseId>({});
  const [openExerciseIds, setOpenExerciseIds] = useState<EntityId[]>([]);
  const [initializedSessionId, setInitializedSessionId] = useState<EntityId | null>(null);
  const [editingSetTarget, setEditingSetTarget] = useState<EditingSetTarget | null>(null);
  const [setEditDraft, setSetEditDraft] = useState<SetDraftState>(createEmptySetDraft);
  const [isSetDialogOpen, setIsSetDialogOpen] = useState(false);
  const [isExerciseDialogOpen, setIsExerciseDialogOpen] = useState(false);
  const [isSavingSetEdit, setIsSavingSetEdit] = useState(false);
  const [isDeletingSet, setIsDeletingSet] = useState(false);
  const [timerNowMs, setTimerNowMs] = useState(() => Date.now());

  const exerciseById = useMemo(() => {
    return new Map(exercises.map((exercise) => [exercise.id, exercise]));
  }, [exercises]);

  const activeSession = snapshot?.session;
  const activeRestTimer = snapshot?.activeWorkout.restTimer;
  const sessionExercises = useMemo(() => {
    return activeSession ? sortSessionExercises(activeSession.exercises) : [];
  }, [activeSession]);
  const activeExerciseIds = useMemo(() => {
    return new Set(sessionExercises.map((sessionExercise) => sessionExercise.exerciseId));
  }, [sessionExercises]);
  const lastSessionByExerciseId = useMemo(() => {
    const entries = new Map<EntityId, LastSessionSets>();

    for (const sessionExercise of sessionExercises) {
      const lastSession = findLastSessionSets(sessionExercise.exerciseId, finishedSessions);

      if (lastSession) {
        entries.set(sessionExercise.exerciseId, lastSession);
      }
    }

    return entries;
  }, [finishedSessions, sessionExercises]);
  const availableExercises = useMemo(() => {
    return exercises.filter((exercise) => !activeExerciseIds.has(exercise.id));
  }, [activeExerciseIds, exercises]);
  const canStartEmptyWorkout = exercises.length > 0;
  const canAddExercise = activeSession !== undefined && availableExercises.length > 0;
  const canSaveActiveWorkoutAsPlan =
    activeSession !== undefined && activeSession.templateId === null && sessionExercises.length > 0;
  const currentWeekSummary = useMemo(() => {
    return buildWeeklyTrainingSummaries(finishedSessions, {
      numberOfWeeks: 1,
      weightUnit: settings?.weightUnit ?? "kg",
    })[0];
  }, [finishedSessions, settings?.weightUnit]);
  const weeklyWorkoutTarget = settings?.weeklyWorkoutTarget ?? defaultWeeklyWorkoutTarget;
  const workoutRecommendation = useMemo(
    () => recommendWorkoutTemplate(templates, finishedSessions),
    [finishedSessions, templates],
  );
  const primaryTemplate = workoutRecommendation?.template;
  const dashboardWorkoutName = primaryTemplate?.name ?? messages.dashboardWorkoutFallback;
  const dashboardExerciseCount = primaryTemplate?.exercises.length ?? 0;
  const dashboardCompletionPercent = calculateWorkoutCompletionPercent(activeSession);
  const trainingDayStreak = useMemo(
    () => calculateTrainingDayStreak(finishedSessions),
    [finishedSessions],
  );
  const recoveryStatuses = useMemo(
    () => buildMuscleRecoveryStatuses(exercises, finishedSessions).slice(0, 8),
    [exercises, finishedSessions],
  );
  const recentProgressHighlights = useMemo(() => {
    return exercises
      .flatMap((exercise): RecentProgressHighlight[] => {
        const progress = buildExerciseProgress(
          exercise,
          finishedSessions,
          settings?.weightUnit ?? "kg",
        );
        const latestPoint = progress.points.at(-1);

        return latestPoint?.isPersonalRecord
          ? [{ exercise, kind: progress.kind, point: latestPoint }]
          : [];
      })
      .sort(
        (firstHighlight, secondHighlight) =>
          new Date(secondHighlight.point.startedAt).getTime() -
          new Date(firstHighlight.point.startedAt).getTime(),
      )
      .slice(0, 2);
  }, [exercises, finishedSessions, settings?.weightUnit]);
  const previousBestByExerciseId = useMemo(() => {
    const previousBest = new Map<EntityId, RecentProgressHighlight>();

    for (const exercise of exercises) {
      const progress = buildExerciseProgress(
        exercise,
        finishedSessions,
        settings?.weightUnit ?? "kg",
      );
      const bestPoint = [...progress.points].sort((firstPoint, secondPoint) =>
        progress.kind === "assistance"
          ? firstPoint.value - secondPoint.value
          : secondPoint.value - firstPoint.value,
      )[0];

      if (bestPoint) {
        previousBest.set(exercise.id, { exercise, kind: progress.kind, point: bestPoint });
      }
    }

    return previousBest;
  }, [exercises, finishedSessions, settings?.weightUnit]);
  const activeSetProgress = activeSession
    ? getWorkoutSetProgress(activeSession)
    : { completedSets: 0, plannedSets: 0 };
  const staleWorkoutAgeHours = getStaleWorkoutAgeHours(activeSession);
  const isPersistingWorkout =
    isFinishing ||
    isSavingPlan ||
    isClearingTimer ||
    isSavingSetEdit ||
    isDeletingSet ||
    addingExerciseId !== null ||
    savingSetExerciseId !== null;
  const remainingRestSeconds = activeRestTimer
    ? getRemainingRestSeconds(activeRestTimer, timerNowMs)
    : 0;
  const editingSetContext = useMemo(() => {
    if (!activeSession || !editingSetTarget) {
      return undefined;
    }

    const sessionExercise = activeSession.exercises.find(
      (exercise) => exercise.exerciseId === editingSetTarget.exerciseId,
    );
    const set = sessionExercise?.sets.find(
      (workoutSet) => workoutSet.id === editingSetTarget.setId,
    );

    if (!sessionExercise || !set) {
      return undefined;
    }

    const exercise = exerciseById.get(sessionExercise.exerciseId);

    return {
      exerciseName: exercise?.name ?? messages.missingExercise,
      trackingMode: exercise?.trackingMode ?? "weighted",
      sessionExercise,
      set,
    };
  }, [activeSession, editingSetTarget, exerciseById, messages.missingExercise]);

  /** Refreshes the active workout and exercise names from IndexedDB. */
  const refreshData = useCallback(async () => {
    try {
      const [nextSnapshot, nextExercises, nextTemplates, nextFinishedSessions, nextSettings] =
        await Promise.all([
          repository.getActive(),
          exerciseStore.list(),
          templateRepository.list(),
          repository.listFinished(),
          settingsStore.get(),
        ]);

      setSnapshot(nextSnapshot);
      setExercises(nextExercises);
      setTemplates(nextTemplates);
      setFinishedSessions(nextFinishedSessions);
      setSettings(nextSettings);
      setLoadState("ready");
    } catch {
      setLoadState("error");
      setFeedbackMessage(messages.loadError);
    }
  }, [exerciseStore, messages.loadError, repository, settingsStore, templateRepository]);

  useEffect(() => {
    if (isActive) {
      void refreshData();
    }
  }, [isActive, refreshData]);

  useEffect(() => {
    if (isActive) {
      return;
    }

    setEditingSetTarget(null);
    setIsExerciseDialogOpen(false);
    setIsSavePlanDialogOpen(false);
    setIsSetDialogOpen(false);
    setSavePlanName("");
    setSetEditDraft(createEmptySetDraft());
    setFeedbackMessage(null);
  }, [isActive]);

  useEffect(() => {
    if (initialFeedbackMessage) {
      onInitialFeedbackShown?.();
    }
  }, [initialFeedbackMessage, onInitialFeedbackShown]);

  useEffect(() => {
    if (!activeSession) {
      setOpenExerciseIds([]);
      setInitializedSessionId(null);
      return;
    }

    if (initializedSessionId === activeSession.id) {
      return;
    }

    setOpenExerciseIds(sessionExercises[0] ? [sessionExercises[0].exerciseId] : []);
    setInitializedSessionId(activeSession.id);
  }, [activeSession, initializedSessionId, sessionExercises]);

  useEffect(() => {
    if (!activeRestTimer) {
      return undefined;
    }

    setTimerNowMs(Date.now());

    const intervalId = globalThis.setInterval(() => {
      setTimerNowMs(Date.now());
    }, 1_000);

    return () => globalThis.clearInterval(intervalId);
  }, [activeRestTimer]);

  /** Finishes the current active workout session. */
  const finishWorkout = async () => {
    setIsFinishing(true);
    setFeedbackMessage(null);

    try {
      const finishedWorkout = await repository.finishActive();

      if (!finishedWorkout) {
        setFeedbackMessage(messages.finishError);
        return;
      }

      setSnapshot(undefined);
      setFinishedSessions((currentSessions) =>
        sortWorkoutSessionsByStartedAt([
          finishedWorkout,
          ...currentSessions.filter((session) => session.id !== finishedWorkout.id),
        ]),
      );
      setFeedbackMessage(messages.finishSuccess);
    } catch {
      setFeedbackMessage(messages.finishError);
    } finally {
      setIsFinishing(false);
    }
  };

  /** Starts an empty ad-hoc workout session. */
  const startEmptyWorkout = async () => {
    if (!canStartEmptyWorkout) {
      setFeedbackMessage(messages.noExerciseLibraryDescription);
      return;
    }

    setIsStartingWorkout(true);
    setFeedbackMessage(null);

    try {
      const nextSnapshot = await repository.startEmpty({ name: messages.emptyWorkoutName });

      setSnapshot(nextSnapshot);
      setIsExerciseDialogOpen(true);
    } catch {
      setFeedbackMessage(messages.startError);
    } finally {
      setIsStartingWorkout(false);
    }
  };

  /** Starts an active workout from a saved plan. */
  const startTemplateWorkout = async (templateId: EntityId) => {
    setIsStartingWorkout(true);
    setFeedbackMessage(null);

    try {
      const nextSnapshot = await repository.startFromTemplate(templateId);

      if (!nextSnapshot) {
        setFeedbackMessage(messages.startError);
        return;
      }

      setSnapshot(nextSnapshot);
    } catch {
      setFeedbackMessage(messages.startError);
    } finally {
      setIsStartingWorkout(false);
    }
  };

  /** Starts the best available workout from the dashboard card. */
  const startDashboardWorkout = async () => {
    if (activeSession) {
      document.getElementById("active-session-panel")?.scrollIntoView({ block: "start" });
      return;
    }

    if (primaryTemplate) {
      await startTemplateWorkout(primaryTemplate.id);
      return;
    }

    await startEmptyWorkout();
  };

  /** Opens the active-workout exercise picker when an exercise can be added. */
  const openExerciseDialog = () => {
    if (!activeSession) {
      setFeedbackMessage(messages.addExerciseError);
      return;
    }

    if (availableExercises.length === 0) {
      setFeedbackMessage(messages.noExercisesAvailable);
      return;
    }

    setFeedbackMessage(null);
    setIsExerciseDialogOpen(true);
  };

  /** Opens the save-as-plan dialog for an ad-hoc active workout. */
  const openSavePlanDialog = () => {
    if (!activeSession || activeSession.templateId !== null) {
      setFeedbackMessage(messages.savePlanError);
      return;
    }

    if (sessionExercises.length === 0) {
      setFeedbackMessage(messages.noPlanExercises);
      return;
    }

    setSavePlanName(createDefaultPlanName(activeSession, messages));
    setFeedbackMessage(null);
    setIsSavePlanDialogOpen(true);
  };

  /** Closes the save-as-plan dialog and clears its transient form state. */
  const closeSavePlanDialog = () => {
    setIsSavePlanDialogOpen(false);
    setSavePlanName("");
    setFeedbackMessage(null);
  };

  /** Updates the controlled save-as-plan dialog state. */
  const updateSavePlanDialog = (isOpen: boolean) => {
    if (isOpen) {
      setIsSavePlanDialogOpen(true);
      return;
    }

    closeSavePlanDialog();
  };

  /** Saves the current ad-hoc active workout as a reusable workout plan. */
  const saveActiveWorkoutAsPlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!activeSession || activeSession.templateId !== null || sessionExercises.length === 0) {
      setFeedbackMessage(messages.savePlanError);
      return;
    }

    const name = savePlanName.trim();

    if (name.length === 0) {
      setFeedbackMessage(messages.validationPlanNameRequired);
      return;
    }

    setIsSavingPlan(true);
    setFeedbackMessage(null);

    try {
      const result = await repository.createTemplateFromActive(activeSession.id, { name });

      if (!result) {
        setFeedbackMessage(messages.savePlanError);
        return;
      }

      setSnapshot(result.snapshot);
      setTemplates((currentTemplates) =>
        sortWorkoutTemplatesByName([
          ...currentTemplates.filter((template) => template.id !== result.template.id),
          result.template,
        ]),
      );
      setIsSavePlanDialogOpen(false);
      setSavePlanName("");
      setFeedbackMessage(messages.planSavedSuccess);
    } catch {
      setFeedbackMessage(messages.savePlanError);
    } finally {
      setIsSavingPlan(false);
    }
  };

  /** Adds a selected exercise to the active workout. */
  const addExerciseToWorkout = async (exerciseId: EntityId) => {
    if (!activeSession) {
      setFeedbackMessage(messages.addExerciseError);
      return;
    }

    setAddingExerciseId(exerciseId);
    setFeedbackMessage(null);

    try {
      const nextSnapshot = await repository.addExercise(activeSession.id, exerciseId);

      if (!nextSnapshot) {
        setFeedbackMessage(messages.addExerciseError);
        return;
      }

      setSnapshot(nextSnapshot);
      setOpenExerciseIds((currentOpenExerciseIds) =>
        currentOpenExerciseIds.includes(exerciseId)
          ? currentOpenExerciseIds
          : [...currentOpenExerciseIds, exerciseId],
      );
      setIsExerciseDialogOpen(false);
    } catch {
      setFeedbackMessage(messages.addExerciseError);
    } finally {
      setAddingExerciseId(null);
    }
  };

  /** Updates one controlled set logging field for an exercise. */
  const updateSetDraft = (exerciseId: EntityId, field: SetDraftNumberField, value: string) => {
    setSetDrafts((currentDrafts) => ({
      ...currentDrafts,
      [exerciseId]: {
        ...createEmptySetDraft(),
        ...currentDrafts[exerciseId],
        [field]: value,
      },
    }));
  };

  /** Copies a matching set from the previous workout into the current entry fields. */
  const copyPreviousSet = (exerciseId: EntityId, previousSet: WorkoutSet) => {
    const weightUnit = settings?.weightUnit ?? "kg";
    const tracksWeight = exerciseById.get(exerciseId)?.trackingMode !== "bodyweight";
    const normalizedWeight =
      !tracksWeight || previousSet.weight === null
        ? null
        : convertWeight(previousSet.weight, previousSet.weightUnit, weightUnit);

    setSetDrafts((currentDrafts) => ({
      ...currentDrafts,
      [exerciseId]: {
        reps: formatOptionalInteger(previousSet.reps),
        durationSeconds: formatOptionalInteger(previousSet.durationSeconds ?? null),
        weight: formatOptionalNumber(normalizedWeight),
        restSeconds: formatOptionalInteger(previousSet.restSeconds),
      },
    }));
  };

  /** Toggles one exercise card between open and closed states. */
  const toggleExercise = (exerciseId: EntityId) => {
    setOpenExerciseIds((currentOpenExerciseIds) =>
      currentOpenExerciseIds.includes(exerciseId)
        ? currentOpenExerciseIds.filter((currentExerciseId) => currentExerciseId !== exerciseId)
        : [...currentOpenExerciseIds, exerciseId],
    );
  };

  /** Opens the set settings dialog with the selected set values. */
  const openSetSettings = (sessionExercise: WorkoutSessionExercise, set: WorkoutSet) => {
    setEditingSetTarget({
      exerciseId: sessionExercise.exerciseId,
      setId: set.id,
    });
    setSetEditDraft({
      reps: formatOptionalInteger(set.reps),
      durationSeconds: formatOptionalInteger(set.durationSeconds ?? null),
      weight: formatOptionalNumber(set.weight),
      restSeconds: formatOptionalInteger(set.restSeconds),
    });
    setFeedbackMessage(null);
    setIsSetDialogOpen(true);
  };

  /** Closes the set settings dialog and clears transient edit state. */
  const closeSetDialog = () => {
    setEditingSetTarget(null);
    setSetEditDraft(createEmptySetDraft());
    setFeedbackMessage(null);
    setIsSetDialogOpen(false);
  };

  /** Updates the controlled set settings dialog state. */
  const updateSetDialog = (isOpen: boolean) => {
    if (isOpen) {
      setIsSetDialogOpen(true);
      return;
    }

    closeSetDialog();
  };

  /** Updates one controlled set edit field. */
  const updateSetEditDraft = (field: SetDraftNumberField, value: string) => {
    setSetEditDraft((currentDraft) => ({
      ...currentDraft,
      [field]: value,
    }));
  };

  /** Logs a completed set for one exercise in the active workout. */
  const logWorkoutSet = async (
    event: FormEvent<HTMLFormElement>,
    sessionExercise: WorkoutSessionExercise,
  ) => {
    event.preventDefault();

    if (!activeSession) {
      setFeedbackMessage(messages.logSetError);
      return;
    }

    const draft = getSetDraft(setDrafts, sessionExercise.exerciseId);
    const trackingMode = exerciseById.get(sessionExercise.exerciseId)?.trackingMode ?? "weighted";
    const tracksDuration = trackingMode === "timed";
    const effort = readSetEffort(tracksDuration, draft, messages);
    const weight = trackingMode === "bodyweight" ? null : toOptionalNonNegativeNumber(draft.weight);
    const parsedRestSeconds = toOptionalNonNegativeInteger(draft.restSeconds);

    if ("error" in effort) {
      setFeedbackMessage(effort.error);
      return;
    }

    if (weight === undefined || parsedRestSeconds === undefined) {
      setFeedbackMessage(messages.validationSetNumbers);
      return;
    }

    const restSeconds = parsedRestSeconds ?? sessionExercise.restSeconds;

    setSavingSetExerciseId(sessionExercise.exerciseId);
    setFeedbackMessage(null);

    try {
      const workoutSession = await repository.logSet(activeSession.id, sessionExercise.exerciseId, {
        reps: effort.reps,
        durationSeconds: effort.durationSeconds,
        restSeconds,
        weight,
        weightUnit: settings?.weightUnit ?? "kg",
      });

      if (!workoutSession) {
        setFeedbackMessage(messages.logSetError);
        return;
      }

      const nextSnapshot = await repository.getActive();

      setSnapshot((currentSnapshot) => {
        if (nextSnapshot) {
          return nextSnapshot;
        }

        return currentSnapshot
          ? {
              ...currentSnapshot,
              session: workoutSession,
            }
          : currentSnapshot;
      });
    } catch {
      setFeedbackMessage(messages.logSetError);
    } finally {
      setSavingSetExerciseId(null);
    }
  };

  /** Clears the active rest timer after it finishes or when the user skips it. */
  const clearRestTimer = async () => {
    if (!activeSession) {
      setFeedbackMessage(messages.clearTimerError);
      return;
    }

    setIsClearingTimer(true);
    setFeedbackMessage(null);

    try {
      const nextSnapshot = await repository.clearRestTimer(activeSession.id);

      if (!nextSnapshot) {
        setFeedbackMessage(messages.clearTimerError);
        return;
      }

      setSnapshot(nextSnapshot);
    } catch {
      setFeedbackMessage(messages.clearTimerError);
    } finally {
      setIsClearingTimer(false);
    }
  };

  /** Saves the currently edited set values. */
  const saveSetEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!activeSession || !editingSetContext || !editingSetTarget) {
      setFeedbackMessage(messages.saveSetError);
      return;
    }

    const effort = readSetEffort(
      editingSetContext.trackingMode === "timed",
      setEditDraft,
      messages,
    );
    const weight =
      editingSetContext.trackingMode === "bodyweight"
        ? null
        : toOptionalNonNegativeNumber(setEditDraft.weight);
    const restSeconds = toOptionalNonNegativeInteger(setEditDraft.restSeconds);

    if ("error" in effort) {
      setFeedbackMessage(effort.error);
      return;
    }

    if (weight === undefined || restSeconds === undefined) {
      setFeedbackMessage(messages.validationSetNumbers);
      return;
    }

    setIsSavingSetEdit(true);
    setFeedbackMessage(null);

    try {
      const nextSnapshot = await repository.updateSet(
        activeSession.id,
        editingSetTarget.exerciseId,
        editingSetTarget.setId,
        {
          reps: effort.reps,
          durationSeconds: effort.durationSeconds,
          restSeconds,
          weight,
          weightUnit: editingSetContext.set.weightUnit,
        },
      );

      if (!nextSnapshot) {
        setFeedbackMessage(messages.saveSetError);
        return;
      }

      setSnapshot(nextSnapshot);
      closeSetDialog();
    } catch {
      setFeedbackMessage(messages.saveSetError);
    } finally {
      setIsSavingSetEdit(false);
    }
  };

  /** Deletes the currently edited set. */
  const deleteCurrentSet = async () => {
    if (!activeSession || !editingSetTarget) {
      setFeedbackMessage(messages.deleteSetError);
      return;
    }

    setIsDeletingSet(true);
    setFeedbackMessage(null);

    try {
      const nextSnapshot = await repository.deleteSet(
        activeSession.id,
        editingSetTarget.exerciseId,
        editingSetTarget.setId,
      );

      if (!nextSnapshot) {
        setFeedbackMessage(messages.deleteSetError);
        return;
      }

      setSnapshot(nextSnapshot);
      closeSetDialog();
    } catch {
      setFeedbackMessage(messages.deleteSetError);
    } finally {
      setIsDeletingSet(false);
    }
  };

  return (
    <section
      className={styles.root}
      aria-label={activeSession ? messages.title : undefined}
      aria-labelledby={activeSession ? undefined : "active-workout-title"}
    >
      {!activeSession ? (
        <header className={styles.dashboardHeader}>
          <div className={styles.dashboardGreeting}>
            <h1 className={styles.dashboardTitle} id="active-workout-title">
              {messages.greetingTitle}
            </h1>
            <p className={styles.dashboardSubtitle}>{messages.greetingSubtitle}</p>
          </div>
        </header>
      ) : null}

      {feedbackMessage ? <p className={styles.feedback}>{feedbackMessage}</p> : null}

      {loadState === "ready" && !activeSession ? (
        <div className={styles.dashboard}>
          <section className={styles.dashboardSection} aria-labelledby="today-workout-title">
            <h2 className={styles.sectionTitle} id="today-workout-title">
              {messages.todayWorkoutTitle}
            </h2>
            <article className={styles.todayWorkoutCard}>
              <span className={styles.todayWorkoutIcon}>
                <Dumbbell className={styles.todayWorkoutIconSvg} aria-hidden="true" />
              </span>
              <span className={styles.todayWorkoutText}>
                <span className={styles.todayWorkoutName}>{dashboardWorkoutName}</span>
                <span className={styles.todayWorkoutMeta}>
                  {workoutRecommendation
                    ? formatRecommendationReason(
                        workoutRecommendation.daysSinceLastSession,
                        messages,
                      )
                    : messages.recommendationBuildFirstPlan}
                </span>
                <span className={styles.todayWorkoutMeta}>
                  {formatExerciseCount(dashboardExerciseCount, messages)}
                </span>
              </span>
              <Sparkles className={styles.todayWorkoutChevron} aria-hidden="true" />
              <button
                className={styles.primaryStartButton}
                type="button"
                disabled={isStartingWorkout || (!primaryTemplate && !canStartEmptyWorkout)}
                onClick={() => void startDashboardWorkout()}
              >
                <span>
                  {isStartingWorkout ? messages.startingAction : messages.startWorkoutAction}
                </span>
                <ChevronRight className={styles.icon} aria-hidden="true" />
              </button>
            </article>
          </section>

          <section className={styles.dashboardSection} aria-labelledby="weekly-stats-title">
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle} id="weekly-stats-title">
                {messages.thisWeekTitle}
              </h2>
              {onOpenHistory ? (
                <button className={styles.textButton} type="button" onClick={onOpenHistory}>
                  {messages.viewAllAction}
                </button>
              ) : null}
            </div>
            <div className={styles.statGrid}>
              <article className={styles.statCard}>
                <TrendingUp className={styles.statIcon({ tone: "accent" })} aria-hidden="true" />
                <strong className={styles.statValue}>
                  {formatDashboardNumber(currentWeekSummary?.sessionCount ?? 0)}/
                  {formatDashboardNumber(weeklyWorkoutTarget)}
                </strong>
                <span className={styles.statLabel}>{messages.weeklyGoalStatLabel}</span>
              </article>
              <article className={styles.statCard}>
                <ListChecks className={styles.statIcon({ tone: "blue" })} aria-hidden="true" />
                <strong className={styles.statValue}>
                  {formatDashboardNumber(currentWeekSummary?.completedSetCount ?? 0)}
                </strong>
                <span className={styles.statLabel}>{messages.setsStatLabel}</span>
              </article>
              <article className={styles.statCard}>
                <Flame className={styles.statIcon({ tone: "orange" })} aria-hidden="true" />
                <strong className={styles.statValue}>
                  {formatDashboardNumber(trainingDayStreak)}
                </strong>
                <span className={styles.statLabel}>{messages.streakStatLabel}</span>
              </article>
            </div>
          </section>

          <section className={styles.dashboardSection} aria-labelledby="recent-progress-title">
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle} id="recent-progress-title">
                {messages.recentProgressTitle}
              </h2>
              {onOpenHistory ? (
                <button className={styles.textButton} type="button" onClick={onOpenHistory}>
                  {messages.insightsAction}
                </button>
              ) : null}
            </div>
            {recentProgressHighlights.length > 0 ? (
              <div className={styles.progressHighlightList}>
                {recentProgressHighlights.map((highlight) => (
                  <article className={styles.progressHighlight} key={highlight.exercise.id}>
                    <TrendingUp className={styles.progressHighlightIcon} aria-hidden="true" />
                    <span>
                      {formatProgressHighlight(highlight, settings?.weightUnit ?? "kg", messages)}
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <p className={styles.dashboardEmpty}>{messages.noRecentProgress}</p>
            )}
          </section>

          <section className={styles.dashboardSection} aria-labelledby="recovery-overview-title">
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle} id="recovery-overview-title">
                {messages.recoveryOverviewTitle}
              </h2>
              <HeartPulse className={styles.recoveryIcon} aria-hidden="true" />
            </div>
            {recoveryStatuses.length > 0 ? (
              <ul className={styles.recoveryList}>
                {recoveryStatuses.map((status) => (
                  <li className={styles.recoveryItem} key={status.muscleGroupId}>
                    <span className={styles.recoveryText}>
                      <strong>{formatMuscleGroupLabel(status.muscleGroupId)}</strong>
                      <span>{formatRecoveryRecency(status, messages)}</span>
                    </span>
                    <span className={styles.recoveryBadge({ state: status.state })}>
                      {getRecoveryStateLabel(status, messages)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={styles.dashboardEmpty}>{messages.noRecoveryData}</p>
            )}
          </section>
        </div>
      ) : null}

      {loadState === "loading" ? (
        <div className={styles.emptyState}>
          <Dumbbell className={styles.emptyIcon} aria-hidden="true" />
          <h2 className={styles.emptyTitle}>{messages.loadingTitle}</h2>
          <p className={styles.emptyDescription}>{messages.loadingDescription}</p>
        </div>
      ) : null}

      {loadState === "ready" && activeSession ? (
        <article
          id="active-session-panel"
          className={styles.sessionPanel}
          aria-label={formatSessionTitle(activeSession.name, messages)}
        >
          {staleWorkoutAgeHours !== null ? (
            <aside className={styles.staleWorkoutWarning}>
              <AlertTriangle className={styles.staleWorkoutIcon} aria-hidden="true" />
              <span>
                <strong>{messages.staleWorkoutTitle}</strong>
                {messages.staleWorkoutDescription.replace("{hours}", String(staleWorkoutAgeHours))}
              </span>
            </aside>
          ) : null}
          <div className={styles.sessionHeader}>
            <div className={styles.sessionHeading}>
              <p className={styles.sessionStatus}>{messages.inProgressLabel}</p>
              <h2 className={styles.sessionTitle}>
                {formatSessionTitle(activeSession.name, messages)}
              </h2>
              <p className={styles.sessionMeta}>
                {formatStartedAt(activeSession.startedAt, messages)} ·{" "}
                {formatExerciseCount(sessionExercises.length, messages)}
              </p>
              <p className={styles.saveStatus} aria-live="polite">
                <Cloud className={styles.saveStatusIcon} aria-hidden="true" />
                {isPersistingWorkout ? messages.savingOffline : messages.savedOffline}
              </p>
            </div>
            <div className={styles.sessionActions}>
              <button
                className={styles.button({ variant: "primary" })}
                type="button"
                disabled={!canAddExercise}
                onClick={openExerciseDialog}
              >
                <CirclePlus className={styles.icon} aria-hidden="true" />
                <span>{messages.addExerciseAction}</span>
              </button>
              {activeSession.templateId === null ? (
                <button
                  className={styles.button({ variant: "secondary" })}
                  type="button"
                  disabled={!canSaveActiveWorkoutAsPlan || isSavingPlan}
                  onClick={openSavePlanDialog}
                >
                  <ClipboardList className={styles.icon} aria-hidden="true" />
                  <span>
                    {isSavingPlan ? messages.savingPlanAction : messages.saveAsPlanAction}
                  </span>
                </button>
              ) : null}
              <button
                className={styles.button({ variant: "secondary" })}
                type="button"
                disabled={isFinishing}
                onClick={() => void finishWorkout()}
              >
                <CheckCircle2 className={styles.icon} aria-hidden="true" />
                <span>{isFinishing ? messages.finishingAction : messages.finishAction}</span>
              </button>
            </div>
          </div>

          <div className={styles.sessionProgress}>
            <span className={styles.sessionProgressText}>
              <strong>{messages.sessionProgressTitle}</strong>
              <span>
                {activeSetProgress.plannedSets > 0
                  ? messages.sessionPlannedProgress
                      .replace("{completed}", String(activeSetProgress.completedSets))
                      .replace("{planned}", String(activeSetProgress.plannedSets))
                  : messages.sessionCompletedProgress.replace(
                      "{completed}",
                      String(activeSetProgress.completedSets),
                    )}
              </span>
            </span>
            {activeSetProgress.plannedSets > 0 ? (
              <span className={styles.progressTrack} aria-hidden="true">
                <span
                  className={styles.progressFill}
                  style={{ inlineSize: `${dashboardCompletionPercent}%` }}
                />
              </span>
            ) : null}
          </div>

          {sessionExercises.length === 0 ? (
            <div className={styles.emptyState}>
              <Dumbbell className={styles.emptyIcon} aria-hidden="true" />
              <h3 className={styles.emptyTitle}>{messages.noExercisesTitle}</h3>
              <p className={styles.emptyDescription}>{messages.noExercisesDescription}</p>
              <button
                className={styles.button({ variant: "primary" })}
                type="button"
                disabled={!canAddExercise}
                onClick={openExerciseDialog}
              >
                <CirclePlus className={styles.icon} aria-hidden="true" />
                <span>{messages.addExerciseAction}</span>
              </button>
            </div>
          ) : (
            <ul className={styles.exerciseList}>
              {sessionExercises.map((sessionExercise) => {
                const exercise = exerciseById.get(sessionExercise.exerciseId);
                const exerciseName = exercise?.name ?? messages.missingExercise;
                const tracksDuration = exercise?.trackingMode === "timed";
                const tracksWeight = exercise?.trackingMode !== "bodyweight";
                const setDraft = getSetDraft(setDrafts, sessionExercise.exerciseId);
                const sets = sortWorkoutSets(sessionExercise.sets);
                const completedSetCount = sets.filter((set) => set.isCompleted).length;
                const isSavingSet = savingSetExerciseId === sessionExercise.exerciseId;
                const isExerciseOpen = openExerciseIds.includes(sessionExercise.exerciseId);
                const lastSession = lastSessionByExerciseId.get(sessionExercise.exerciseId);
                const previousSetToCopy =
                  lastSession?.sets[Math.min(completedSetCount, lastSession.sets.length - 1)];
                const previousBest = previousBestByExerciseId.get(sessionExercise.exerciseId);

                return (
                  <li className={styles.exerciseCard} key={sessionExercise.exerciseId}>
                    <button
                      className={styles.exerciseToggle}
                      type="button"
                      aria-expanded={isExerciseOpen}
                      aria-label={formatExerciseToggleLabel(
                        isExerciseOpen
                          ? messages.collapseExerciseAriaLabel
                          : messages.expandExerciseAriaLabel,
                        exerciseName,
                      )}
                      onClick={() => toggleExercise(sessionExercise.exerciseId)}
                    >
                      <span className={styles.exerciseHeading}>
                        <span className={styles.exerciseName}>{exerciseName}</span>
                        <span className={styles.exerciseMeta}>
                          {formatExerciseMeta(sessionExercise, messages)}
                        </span>
                      </span>
                      <ChevronDown
                        className={styles.exerciseChevron({ open: isExerciseOpen })}
                        aria-hidden="true"
                      />
                    </button>

                    {isExerciseOpen ? (
                      <div className={styles.exerciseDetails}>
                        {lastSession ? (
                          <div className={styles.lastSession}>
                            <History className={styles.lastSessionIcon} aria-hidden="true" />
                            <span className={styles.lastSessionText}>
                              {messages.lastSessionLabel}:{" "}
                              {lastSession.sets
                                .map((set) => formatLastSessionSet(set, messages))
                                .join(" · ")}
                            </span>
                            {previousSetToCopy ? (
                              <button
                                className={styles.copyPreviousButton}
                                type="button"
                                aria-label={messages.copyPreviousSetAction}
                                onClick={() =>
                                  copyPreviousSet(sessionExercise.exerciseId, previousSetToCopy)
                                }
                              >
                                <Copy className={styles.setActionIcon} aria-hidden="true" />
                                <span className={styles.copyPreviousLabel}>
                                  {messages.copyPreviousSetAction}
                                </span>
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                        {previousBest ? (
                          <p className={styles.previousBest}>
                            <Star className={styles.previousBestIcon} aria-hidden="true" />
                            <span>{messages.previousBestLabel}</span>
                            <strong>
                              {formatPreviousBestValue(
                                previousBest,
                                settings?.weightUnit ?? "kg",
                                messages,
                              )}
                            </strong>
                          </p>
                        ) : null}
                        {sets.length > 0 ? (
                          <ol className={styles.setList}>
                            {sets.map((set) => (
                              <li className={styles.setRow} key={set.id}>
                                <span className={styles.setSummary}>
                                  {formatLoggedSet(set, messages)}
                                </span>
                                <button
                                  className={styles.setActionButton}
                                  type="button"
                                  aria-label={formatSetActionLabel(
                                    messages.setSettingsAriaLabel,
                                    set,
                                    exerciseName,
                                  )}
                                  onClick={() => openSetSettings(sessionExercise, set)}
                                >
                                  <MoreVertical
                                    className={styles.setActionIcon}
                                    aria-hidden="true"
                                  />
                                </button>
                              </li>
                            ))}
                          </ol>
                        ) : null}

                        <form
                          className={styles.setForm}
                          onSubmit={(event) => void logWorkoutSet(event, sessionExercise)}
                        >
                          <div className={styles.setFields}>
                            <label className={styles.setField}>
                              <span className={styles.setLabel}>
                                {tracksDuration ? messages.durationLabel : messages.repsLabel}
                              </span>
                              <input
                                className={styles.setInput}
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={tracksDuration ? setDraft.durationSeconds : setDraft.reps}
                                placeholder={
                                  tracksDuration
                                    ? messages.durationPlaceholder
                                    : messages.repsPlaceholder
                                }
                                onChange={(event) =>
                                  updateSetDraft(
                                    sessionExercise.exerciseId,
                                    tracksDuration ? "durationSeconds" : "reps",
                                    event.currentTarget.value,
                                  )
                                }
                              />
                            </label>
                            {tracksWeight ? (
                              <label className={styles.setField}>
                                <span className={styles.setLabel}>
                                  {exercise?.trackingMode === "assisted"
                                    ? messages.assistanceLabel
                                    : messages.weightLabel}
                                </span>
                                <input
                                  className={styles.setInput}
                                  type="text"
                                  inputMode="decimal"
                                  value={setDraft.weight}
                                  placeholder={messages.weightPlaceholder}
                                  onChange={(event) =>
                                    updateSetDraft(
                                      sessionExercise.exerciseId,
                                      "weight",
                                      event.currentTarget.value,
                                    )
                                  }
                                />
                              </label>
                            ) : null}
                            <label className={styles.setField}>
                              <span className={styles.setLabel}>{messages.restSecondsLabel}</span>
                              <input
                                className={styles.setInput}
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={setDraft.restSeconds}
                                placeholder={String(
                                  sessionExercise.restSeconds ?? messages.restSecondsPlaceholder,
                                )}
                                onChange={(event) =>
                                  updateSetDraft(
                                    sessionExercise.exerciseId,
                                    "restSeconds",
                                    event.currentTarget.value,
                                  )
                                }
                              />
                            </label>
                          </div>
                          <button
                            className={styles.button({ variant: "primary" })}
                            type="submit"
                            disabled={isSavingSet}
                          >
                            <CirclePlus className={styles.icon} aria-hidden="true" />
                            <span>
                              {isSavingSet ? messages.loggingSetAction : messages.logSetAction}
                            </span>
                          </button>
                        </form>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </article>
      ) : null}

      {isActive && activeRestTimer ? (
        <div className={styles.restTimerPill}>
          <div className={styles.restTimerPillMain} aria-live="polite">
            <Timer className={styles.restTimerPillIcon} aria-hidden="true" />
            <span className={styles.restTimerPillLabel}>
              {remainingRestSeconds > 0 ? messages.restTimerLabel : messages.restTimerCompleteLabel}
            </span>
            <span className={styles.restTimerPillTime}>
              {formatTimerDuration(remainingRestSeconds)}
            </span>
          </div>
          <button
            className={styles.restTimerPillSkip}
            type="button"
            disabled={isClearingTimer}
            aria-label={messages.skipTimerAction}
            onClick={() => void clearRestTimer()}
          >
            <X className={styles.setActionIcon} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <Dialog.Root open={isSavePlanDialogOpen} onOpenChange={updateSavePlanDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <div className={styles.dialogViewport}>
            <Dialog.Content className={styles.setDialogContent}>
              <form
                className={styles.setEditForm}
                onSubmit={(event) => void saveActiveWorkoutAsPlan(event)}
              >
                <div className={styles.formHeader}>
                  <div className={styles.formHeading}>
                    <Dialog.Title className={styles.formTitle}>
                      {messages.saveAsPlanTitle}
                    </Dialog.Title>
                    <Dialog.Description className={styles.formDescription}>
                      {messages.saveAsPlanDescription}
                    </Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <button className={styles.iconButton({ variant: "ghost" })} type="button">
                      <X className={styles.icon} aria-hidden="true" />
                      <span className={styles.visuallyHidden}>{messages.cancelAction}</span>
                    </button>
                  </Dialog.Close>
                </div>

                {feedbackMessage ? <p className={styles.feedback}>{feedbackMessage}</p> : null}

                <label className={styles.planNameField}>
                  <span className={styles.setLabel}>{messages.planNameLabel}</span>
                  <input
                    className={styles.planNameInput}
                    value={savePlanName}
                    placeholder={messages.planNamePlaceholder}
                    onChange={(event) => setSavePlanName(event.currentTarget.value)}
                  />
                </label>

                <div className={styles.formActions}>
                  <button
                    className={styles.button({ variant: "primary" })}
                    type="submit"
                    disabled={isSavingPlan}
                  >
                    <Check className={styles.icon} aria-hidden="true" />
                    <span>
                      {isSavingPlan ? messages.savingPlanAction : messages.saveAsPlanAction}
                    </span>
                  </button>
                  <Dialog.Close asChild>
                    <button
                      className={styles.button({ variant: "secondary" })}
                      type="button"
                      disabled={isSavingPlan}
                    >
                      {messages.cancelAction}
                    </button>
                  </Dialog.Close>
                </div>
              </form>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={isExerciseDialogOpen} onOpenChange={setIsExerciseDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <div className={styles.dialogViewport}>
            <Dialog.Content className={styles.exerciseDialogContent}>
              <div className={styles.formHeader}>
                <div className={styles.formHeading}>
                  <Dialog.Title className={styles.formTitle}>
                    {messages.addExerciseTitle}
                  </Dialog.Title>
                  <Dialog.Description className={styles.formDescription}>
                    {messages.addExerciseDescription}
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button className={styles.iconButton({ variant: "ghost" })} type="button">
                    <X className={styles.icon} aria-hidden="true" />
                    <span className={styles.visuallyHidden}>{messages.cancelAction}</span>
                  </button>
                </Dialog.Close>
              </div>

              {availableExercises.length === 0 ? (
                <p className={styles.emptyDescription}>{messages.noExercisesAvailable}</p>
              ) : (
                <ul className={styles.exercisePickerList}>
                  {availableExercises.map((exercise) => (
                    <li className={styles.exercisePickerItem} key={exercise.id}>
                      <div className={styles.exerciseHeading}>
                        <span className={styles.exerciseName}>{exercise.name}</span>
                        <span className={styles.exerciseMeta}>
                          {exercise.equipment ?? messages.noEquipment}
                        </span>
                      </div>
                      <button
                        className={styles.button({ variant: "secondary" })}
                        type="button"
                        disabled={addingExerciseId === exercise.id}
                        onClick={() => void addExerciseToWorkout(exercise.id)}
                      >
                        <CirclePlus className={styles.icon} aria-hidden="true" />
                        <span>
                          {addingExerciseId === exercise.id
                            ? messages.addingExerciseAction
                            : messages.addExerciseAction}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={isSetDialogOpen} onOpenChange={updateSetDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <div className={styles.dialogViewport}>
            <Dialog.Content className={styles.setDialogContent}>
              {editingSetContext ? (
                <form className={styles.setEditForm} onSubmit={(event) => void saveSetEdit(event)}>
                  <div className={styles.formHeader}>
                    <div className={styles.formHeading}>
                      <Dialog.Title className={styles.formTitle}>
                        {messages.editSetTitle}
                      </Dialog.Title>
                      <Dialog.Description className={styles.formDescription}>
                        {formatSetActionLabel(
                          messages.editSetDescription,
                          editingSetContext.set,
                          editingSetContext.exerciseName,
                        )}
                      </Dialog.Description>
                    </div>
                    <Dialog.Close asChild>
                      <button className={styles.iconButton({ variant: "ghost" })} type="button">
                        <X className={styles.icon} aria-hidden="true" />
                        <span className={styles.visuallyHidden}>{messages.cancelAction}</span>
                      </button>
                    </Dialog.Close>
                  </div>

                  {feedbackMessage ? <p className={styles.feedback}>{feedbackMessage}</p> : null}

                  <div className={styles.setFields}>
                    <label className={styles.setField}>
                      <span className={styles.setLabel}>
                        {editingSetContext.trackingMode === "timed"
                          ? messages.durationLabel
                          : messages.repsLabel}
                      </span>
                      <input
                        className={styles.setInput}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={
                          editingSetContext.trackingMode === "timed"
                            ? setEditDraft.durationSeconds
                            : setEditDraft.reps
                        }
                        placeholder={
                          editingSetContext.trackingMode === "timed"
                            ? messages.durationPlaceholder
                            : messages.repsPlaceholder
                        }
                        onChange={(event) =>
                          updateSetEditDraft(
                            editingSetContext.trackingMode === "timed" ? "durationSeconds" : "reps",
                            event.currentTarget.value,
                          )
                        }
                      />
                    </label>
                    {editingSetContext.trackingMode !== "bodyweight" ? (
                      <label className={styles.setField}>
                        <span className={styles.setLabel}>
                          {editingSetContext.trackingMode === "assisted"
                            ? messages.assistanceLabel
                            : messages.weightLabel}
                        </span>
                        <input
                          className={styles.setInput}
                          type="text"
                          inputMode="decimal"
                          value={setEditDraft.weight}
                          placeholder={messages.weightPlaceholder}
                          onChange={(event) =>
                            updateSetEditDraft("weight", event.currentTarget.value)
                          }
                        />
                      </label>
                    ) : null}
                    <label className={styles.setField}>
                      <span className={styles.setLabel}>{messages.restSecondsLabel}</span>
                      <input
                        className={styles.setInput}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={setEditDraft.restSeconds}
                        placeholder={messages.restSecondsPlaceholder}
                        onChange={(event) =>
                          updateSetEditDraft("restSeconds", event.currentTarget.value)
                        }
                      />
                    </label>
                  </div>

                  <div className={styles.formActions}>
                    <button
                      className={styles.button({ variant: "primary" })}
                      type="submit"
                      disabled={isSavingSetEdit}
                    >
                      <Check className={styles.icon} aria-hidden="true" />
                      <span>
                        {isSavingSetEdit ? messages.savingSetAction : messages.saveSetAction}
                      </span>
                    </button>
                    <Dialog.Close asChild>
                      <button
                        className={styles.button({ variant: "secondary" })}
                        type="button"
                        disabled={isSavingSetEdit || isDeletingSet}
                      >
                        {messages.keepSetAction}
                      </button>
                    </Dialog.Close>
                    <button
                      className={styles.button({ variant: "danger" })}
                      type="button"
                      disabled={isSavingSetEdit || isDeletingSet}
                      onClick={() => void deleteCurrentSet()}
                    >
                      <Trash2 className={styles.icon} aria-hidden="true" />
                      <span>
                        {isDeletingSet ? messages.deletingSetAction : messages.deleteSetAction}
                      </span>
                    </button>
                  </div>
                </form>
              ) : null}
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
};
