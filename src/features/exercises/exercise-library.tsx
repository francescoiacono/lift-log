import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  ChartNoAxesCombined,
  Check,
  CirclePlus,
  Dumbbell,
  MoreHorizontal,
  NotebookText,
  Pencil,
  Plus,
  Star,
  TrendingDown,
  TrendingUp,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { ExerciseProgressChart } from "./exercise-progress-chart";
import {
  formatExerciseProgressValue,
  getExerciseProgressMetricLabel,
} from "./exercise-progress-formatters";
import {
  buildExerciseInsights,
  filterExerciseProgressPoints,
  type ExerciseProgressKind,
  type ExerciseProgressRange,
  type ExerciseWorkoutPerformance,
  type WeightedExerciseProgressKind,
} from "./exercise-insights";
import { styles } from "./exercise-library.styles";
import type {
  AppSettings,
  EntityId,
  Exercise,
  ExerciseConfidenceRating,
  ExerciseRepository,
  ExerciseTrackingMode,
  SettingsRepository,
  WeightUnit,
  WorkoutSession,
  WorkoutSessionRepository,
  WorkoutSet,
} from "@/db";
import {
  exerciseRepository,
  formatMuscleGroupLabel,
  settingsRepository,
  workoutSessionRepository,
} from "@/db";
import type { Messages } from "@/i18n";

/** Message dictionary used by the exercise library feature. */
type ExerciseLibraryMessages = Messages["exercises"];

/** Props for the exercise library feature. */
export type ExerciseLibraryProps = {
  /** Localized copy used by the exercise library UI. */
  messages: ExerciseLibraryMessages;

  /** Whether the exercise library is the currently visible app view. */
  isActive?: boolean;

  /** Repository used to persist exercise records. */
  repository?: ExerciseRepository;

  /** Repository used to read and prepare workout history for exercise details. */
  sessionRepository?: WorkoutSessionRepository;

  /** Repository used to read the preferred weight unit and rest fallback. */
  settingsStore?: SettingsRepository;

  /** Selected exercise id when selection is controlled by the app shell. */
  selectedExerciseId?: EntityId | null;

  /** Called when the selected exercise detail changes. */
  onSelectedExerciseChange?: (exerciseId: EntityId | null) => void;

  /** Called after the user wants to log this exercise in the active workout. */
  onOpenWorkout?: () => void;
};

/** Editable form state for create and edit exercise flows. */
type ExerciseFormState = {
  /** Exercise name input value. */
  name: string;

  /** Comma-separated muscle group input value. */
  muscleGroups: string;

  /** Equipment input value. */
  equipment: string;

  /** How sets are entered and compared for progress. */
  trackingMode: ExerciseTrackingMode;

  /** Confidence performing the exercise, when rated. */
  confidenceRating: ExerciseConfidenceRating | null;

  /** Notes textarea value. */
  notes: string;
};

/** Props for the reusable confidence-rating form field. */
type ConfidenceRatingFieldProps = {
  /** Current selected confidence rating. */
  value: ExerciseConfidenceRating | null;

  /** Unique radio-group name for the rendered form. */
  inputName: string;

  /** Localized exercise-library copy. */
  messages: ExerciseLibraryMessages;

  /** Called when the rating is selected or cleared. */
  onChange: (value: ExerciseConfidenceRating | null) => void;
};

/** Async loading states used by the exercise library. */
type LoadState = "loading" | "ready" | "error";

/** Selectable values in the five-point exercise-confidence scale. */
const confidenceRatings = [1, 2, 3, 4, 5] as const satisfies readonly ExerciseConfidenceRating[];

/** Renders the optional five-star confidence selector used by exercise forms. */
const ConfidenceRatingField = ({
  value,
  inputName,
  messages,
  onChange,
}: ConfidenceRatingFieldProps) => {
  return (
    <fieldset className={styles.confidenceField}>
      <legend className={styles.label}>{messages.confidenceLabel}</legend>
      <p className={styles.confidenceHint}>{messages.confidenceHint}</p>
      <div className={styles.confidenceControl}>
        <div className={styles.confidenceStars}>
          {confidenceRatings.map((rating) => (
            <label
              className={styles.confidenceStar({
                filled: value !== null && rating <= value,
              })}
              key={rating}
            >
              <input
                className={styles.visuallyHidden}
                type="radio"
                name={inputName}
                value={rating}
                checked={value === rating}
                onChange={() => onChange(rating)}
              />
              <Star aria-hidden="true" />
              <span className={styles.visuallyHidden}>
                {messages.confidenceRatingLabel.replace("{rating}", String(rating))}
              </span>
            </label>
          ))}
        </div>
        {value !== null ? (
          <button
            className={styles.clearConfidenceButton}
            type="button"
            onClick={() => onChange(null)}
          >
            {messages.clearConfidenceAction}
          </button>
        ) : null}
      </div>
      <div className={styles.confidenceEndpoints} aria-hidden="true">
        <span>{messages.confidenceLowLabel}</span>
        <span>{messages.confidenceHighLabel}</span>
      </div>
    </fieldset>
  );
};

/** Creates an empty exercise form state. */
const createEmptyFormState = (): ExerciseFormState => {
  return {
    name: "",
    muscleGroups: "",
    equipment: "",
    trackingMode: "weighted",
    confidenceRating: null,
    notes: "",
  };
};

/** Parses a comma-separated muscle group field into a clean persisted list. */
const parseMuscleGroups = (value: string): string[] => {
  return value
    .split(",")
    .map((muscleGroup) => muscleGroup.trim())
    .filter(Boolean);
};

/** Formats persisted muscle groups for the editable comma-separated field. */
const formatMuscleGroups = (muscleGroups: string[]): string => {
  return muscleGroups.map((muscleGroup) => formatMuscleGroupLabel(muscleGroup)).join(", ");
};

/** Converts a persisted exercise into editable form state. */
const toFormState = (exercise: Exercise): ExerciseFormState => {
  return {
    name: exercise.name,
    muscleGroups: formatMuscleGroups(exercise.muscleGroups),
    equipment: exercise.equipment ?? "",
    trackingMode: exercise.trackingMode,
    confidenceRating: exercise.confidenceRating ?? null,
    notes: exercise.notes ?? "",
  };
};

/** Converts form state into create repository input. */
const toCreateInput = (formState: ExerciseFormState) => {
  return {
    name: formState.name.trim(),
    muscleGroups: parseMuscleGroups(formState.muscleGroups),
    equipment: formState.equipment.trim() || null,
    trackingMode: formState.trackingMode,
    confidenceRating: formState.confidenceRating,
    notes: formState.notes.trim() || null,
  };
};

/** Formats an exercise action label with the target exercise name. */
const formatExerciseActionLabel = (template: string, exerciseName: string): string => {
  return template.replace("{name}", exerciseName);
};

/** Formats seconds as a timer duration. */
const formatTimerDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
};

/** Formats a saved workout date for exercise performance cards. */
const formatShortDate = (timestamp: string): string => {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp));
};

/** Formats a workout set using the selected exercise's tracking semantics. */
const formatWorkoutSet = (
  set: WorkoutSet,
  trackingMode: ExerciseTrackingMode,
  messages: ExerciseLibraryMessages,
): string => {
  let setSummary: string;

  if (trackingMode === "timed") {
    setSummary = messages.workoutSetDuration.replace("{seconds}", String(set.durationSeconds ?? 0));
  } else if (trackingMode === "bodyweight" || set.weight === null) {
    setSummary =
      set.reps === null
        ? messages.noReps
        : messages.workoutSetReps.replace("{reps}", String(set.reps));
  } else {
    const weight = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
      set.weight,
    );

    setSummary =
      set.reps === null
        ? `${weight} ${set.weightUnit}`
        : messages.workoutSetWeightReps
            .replace("{weight}", weight)
            .replace("{unit}", set.weightUnit)
            .replace("{reps}", String(set.reps));
  }

  return set.effortRating
    ? `${setSummary} · ${messages.effortValue.replace("{rating}", String(set.effortRating))}`
    : setSummary;
};

/** Formats the aggregate line for one workout's exercise performance. */
const formatPerformanceSummary = (
  performance: ExerciseWorkoutPerformance,
  trackingMode: ExerciseTrackingMode,
  weightUnit: WeightUnit,
  messages: ExerciseLibraryMessages,
): string => {
  const setCount = performance.sets.length;
  const setLabel = messages.performanceSetCount.replace("{count}", String(setCount));

  if (trackingMode === "weighted") {
    const volume = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
      performance.volume,
    );

    return messages.performanceVolumeMeta
      .replace("{sets}", setLabel)
      .replace("{volume}", volume)
      .replace("{unit}", weightUnit);
  }

  if (trackingMode === "timed") {
    return messages.performanceDurationMeta
      .replace("{sets}", setLabel)
      .replace("{seconds}", String(performance.totalDurationSeconds));
  }

  return messages.performanceRepsMeta
    .replace("{sets}", setLabel)
    .replace("{reps}", String(performance.totalReps));
};

/** Formats every note attached to a saved exercise performance. */
const formatPerformanceNotes = (
  performance: ExerciseWorkoutPerformance,
  messages: ExerciseLibraryMessages,
): string => {
  return [
    performance.exerciseNotes
      ? messages.exercisePerformanceNote.replace("{note}", performance.exerciseNotes)
      : null,
    performance.sessionNotes
      ? messages.workoutPerformanceNote.replace("{note}", performance.sessionNotes)
      : null,
  ]
    .filter((note): note is string => note !== null)
    .join(" · ");
};

/** Formats a signed latest-versus-previous progress change. */
const formatProgressChange = (
  change: number | null,
  kind: ExerciseProgressKind,
  weightUnit: WeightUnit,
  messages: ExerciseLibraryMessages,
): string => {
  if (change === null) {
    return messages.noComparison;
  }

  const sign = change > 0 ? "+" : "";

  return `${sign}${formatExerciseProgressValue(change, kind, weightUnit, messages)}`;
};

/** Root exercise library feature with create, edit, list, and delete flows. */
export const ExerciseLibrary = ({
  messages,
  isActive = true,
  repository = exerciseRepository,
  sessionRepository = workoutSessionRepository,
  settingsStore = settingsRepository,
  selectedExerciseId: controlledSelectedExerciseId,
  onSelectedExerciseChange,
  onOpenWorkout,
}: ExerciseLibraryProps) => {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [finishedSessions, setFinishedSessions] = useState<WorkoutSession[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [formState, setFormState] = useState<ExerciseFormState>(createEmptyFormState);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingExerciseId, setEditingExerciseId] = useState<EntityId | null>(null);
  const [internalSelectedExerciseId, setInternalSelectedExerciseId] = useState<EntityId | null>(
    null,
  );
  const [weightedProgressKind, setWeightedProgressKind] =
    useState<WeightedExerciseProgressKind>("estimatedStrength");
  const [progressRange, setProgressRange] = useState<ExerciseProgressRange>("all");
  const [isFullPerformanceHistoryOpen, setIsFullPerformanceHistoryOpen] = useState(false);
  const [isPreparingWorkout, setIsPreparingWorkout] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<EntityId | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const selectedExerciseId =
    controlledSelectedExerciseId === undefined
      ? internalSelectedExerciseId
      : controlledSelectedExerciseId;
  const editingExercise = useMemo(() => {
    return exercises.find((exercise) => exercise.id === editingExerciseId);
  }, [editingExerciseId, exercises]);
  const selectedExercise = useMemo(() => {
    return exercises.find((exercise) => exercise.id === selectedExerciseId);
  }, [exercises, selectedExerciseId]);
  const selectedExerciseInsights = useMemo(() => {
    return selectedExercise && settings
      ? buildExerciseInsights(
          selectedExercise,
          finishedSessions,
          settings.weightUnit,
          weightedProgressKind,
        )
      : null;
  }, [finishedSessions, selectedExercise, settings, weightedProgressKind]);

  const isEditing = editingExerciseId !== null;
  const canSubmit = formState.name.trim().length > 0;
  const formFeedbackMessage = isFormOpen ? feedbackMessage : null;
  const pageFeedbackMessage = isFormOpen ? null : feedbackMessage;
  const visibleProgressPoints = useMemo(() => {
    return filterExerciseProgressPoints(
      selectedExerciseInsights?.progress.points ?? [],
      progressRange,
    );
  }, [progressRange, selectedExerciseInsights]);

  /** Updates local and app-controlled exercise selection together. */
  const updateSelectedExercise = (exerciseId: EntityId | null) => {
    setInternalSelectedExerciseId(exerciseId);
    onSelectedExerciseChange?.(exerciseId);
  };

  /** Refreshes the local exercise list from IndexedDB. */
  const refreshData = useCallback(async () => {
    try {
      const [nextExercises, nextFinishedSessions, nextSettings] = await Promise.all([
        repository.list(),
        sessionRepository.listFinished(),
        settingsStore.get(),
      ]);

      setExercises(nextExercises);
      setFinishedSessions(nextFinishedSessions);
      setSettings(nextSettings);
      setLoadState("ready");
    } catch {
      setLoadState("error");
      setFeedbackMessage(messages.loadError);
    }
  }, [messages.loadError, repository, sessionRepository, settingsStore]);

  useEffect(() => {
    if (isActive) {
      void refreshData();
    }
  }, [isActive, refreshData]);

  useEffect(() => {
    if (isActive) {
      return;
    }

    setFormState(createEmptyFormState());
    setEditingExerciseId(null);
    setInternalSelectedExerciseId(null);
    setIsFullPerformanceHistoryOpen(false);
    setIsPreparingWorkout(false);
    setPendingDeleteId(null);
    setFeedbackMessage(null);
    setIsFormOpen(false);
  }, [isActive]);

  /** Opens the form in create mode. */
  const openCreateForm = () => {
    setFormState(createEmptyFormState());
    setEditingExerciseId(null);
    setPendingDeleteId(null);
    setFeedbackMessage(null);
    setIsFormOpen(true);
  };

  /** Opens the form in edit mode for an existing exercise. */
  const openEditForm = (exercise: Exercise) => {
    setFormState(toFormState(exercise));
    setEditingExerciseId(exercise.id);
    setPendingDeleteId(null);
    setFeedbackMessage(null);
    setIsFormOpen(true);
  };

  /** Closes the form and clears unsaved form state. */
  const closeForm = () => {
    setFormState(createEmptyFormState());
    setEditingExerciseId(null);
    setFeedbackMessage(null);
    setIsFormOpen(false);
  };

  /** Updates the controlled form dialog state. */
  const updateFormDialog = (isOpen: boolean) => {
    if (isOpen) {
      setIsFormOpen(true);
      return;
    }

    closeForm();
  };

  /** Updates one field in the exercise form state. */
  const updateFormField = <Field extends keyof ExerciseFormState>(
    field: Field,
    value: ExerciseFormState[Field],
  ) => {
    setFormState((currentFormState) => ({
      ...currentFormState,
      [field]: value,
    }));
  };

  /** Saves a new or edited exercise from the current form state. */
  const saveExercise = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canSubmit) {
      setFeedbackMessage(messages.validationNameRequired);
      return;
    }

    try {
      if (isEditing) {
        if (!editingExercise) {
          setFeedbackMessage(messages.saveError);
          return;
        }

        await repository.update(editingExercise.id, toCreateInput(formState));
      } else {
        await repository.create(toCreateInput(formState));
      }

      await refreshData();
      closeForm();
    } catch {
      setFeedbackMessage(messages.saveError);
    }
  };

  /** Updates the controlled delete dialog state for an exercise row. */
  const updateDeleteDialog = (isOpen: boolean, exerciseId: EntityId) => {
    setPendingDeleteId(isOpen ? exerciseId : null);
    setFeedbackMessage(null);
  };

  /** Deletes the confirmed exercise. */
  const confirmDelete = async (exerciseId: EntityId) => {
    try {
      await repository.deleteById(exerciseId);
      if (selectedExerciseId === exerciseId) {
        updateSelectedExercise(null);
      }
      setPendingDeleteId(null);
      await refreshData();
    } catch {
      setFeedbackMessage(messages.deleteError);
    }
  };

  /** Opens the full exercise detail page. */
  const openDetail = (exercise: Exercise) => {
    setFeedbackMessage(null);
    setWeightedProgressKind("estimatedStrength");
    setProgressRange("all");
    setIsFullPerformanceHistoryOpen(false);
    updateSelectedExercise(exercise.id);
  };

  /** Prepares the selected exercise in the active workout and opens the workout screen. */
  const logSelectedExercise = async () => {
    if (!selectedExercise) {
      setFeedbackMessage(messages.logSetError);
      return;
    }

    setIsPreparingWorkout(true);
    setFeedbackMessage(null);

    try {
      const activeSnapshot =
        (await sessionRepository.getActive()) ??
        (await sessionRepository.startEmpty({ name: messages.quickWorkoutName }));
      const hasExercise = activeSnapshot.session.exercises.some(
        (sessionExercise) => sessionExercise.exerciseId === selectedExercise.id,
      );

      if (!hasExercise) {
        const nextSnapshot = await sessionRepository.addExercise(
          activeSnapshot.session.id,
          selectedExercise.id,
        );

        if (!nextSnapshot) {
          setFeedbackMessage(messages.logSetError);
          return;
        }
      }

      onOpenWorkout?.();
    } catch {
      setFeedbackMessage(messages.logSetError);
    } finally {
      setIsPreparingWorkout(false);
    }
  };

  if (selectedExercise) {
    const latestPerformance = selectedExerciseInsights?.performances[0];
    const allEarlierPerformances = selectedExerciseInsights?.performances.slice(1) ?? [];
    const earlierPerformances = isFullPerformanceHistoryOpen
      ? allEarlierPerformances
      : allEarlierPerformances.slice(0, 5);
    const progressKind = selectedExerciseInsights?.progress.kind ?? "repetitions";
    const latestRestSeconds = latestPerformance
      ? ([...latestPerformance.sets].reverse().find((set) => set.restSeconds !== null)
          ?.restSeconds ??
        latestPerformance.restSeconds ??
        settings?.defaultRestSeconds ??
        120)
      : (settings?.defaultRestSeconds ?? 120);

    return (
      <section className={styles.detailRoot} aria-labelledby="exercise-detail-title">
        <header className={styles.detailTopBar}>
          <button
            className={styles.iconButton({ variant: "ghost" })}
            type="button"
            onClick={() => updateSelectedExercise(null)}
          >
            <ArrowLeft className={styles.icon} aria-hidden="true" />
            <span className={styles.visuallyHidden}>{messages.backAction}</span>
          </button>
          <p className={styles.detailTopTitle}>{messages.detailTitle}</p>
          <button
            className={styles.iconButton({ variant: "ghost" })}
            type="button"
            onClick={() => openEditForm(selectedExercise)}
          >
            <MoreHorizontal className={styles.icon} aria-hidden="true" />
            <span className={styles.visuallyHidden}>
              {formatExerciseActionLabel(messages.editExerciseAriaLabel, selectedExercise.name)}
            </span>
          </button>
        </header>

        {pageFeedbackMessage ? <p className={styles.feedback}>{pageFeedbackMessage}</p> : null}

        <div className={styles.detailHero}>
          <div className={styles.exerciseIllustration} aria-hidden="true">
            <Dumbbell className={styles.exerciseIllustrationIcon} />
          </div>
          <div className={styles.detailSummary}>
            <h1 className={styles.detailName} id="exercise-detail-title">
              {selectedExercise.name}
            </h1>
            <div className={styles.detailPills}>
              {selectedExercise.muscleGroups.length > 0 ? (
                selectedExercise.muscleGroups.map((muscleGroup, index) => (
                  <span
                    className={styles.detailPill({ tone: index === 0 ? "accent" : "muted" })}
                    key={muscleGroup}
                  >
                    {formatMuscleGroupLabel(muscleGroup)}
                  </span>
                ))
              ) : (
                <span className={styles.detailPill({ tone: "muted" })}>
                  {messages.noMuscleGroups}
                </span>
              )}
              <span className={styles.detailPill({ tone: "equipment" })}>
                <Dumbbell className={styles.detailPillIcon} aria-hidden="true" />
                {selectedExercise.equipment ?? messages.noEquipment}
              </span>
              {selectedExercise.confidenceRating ? (
                <span className={styles.detailPill({ tone: "confidence" })}>
                  <Star className={styles.detailPillIcon} aria-hidden="true" />
                  {messages.confidenceValue.replace(
                    "{rating}",
                    String(selectedExercise.confidenceRating),
                  )}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className={styles.performanceCard} aria-label={messages.exerciseSummaryLabel}>
          <div className={styles.performanceMetric}>
            <CalendarDays className={styles.summaryMetricIcon} aria-hidden="true" />
            <strong className={styles.performanceValue}>
              {latestPerformance ? formatShortDate(latestPerformance.startedAt) : "-"}
            </strong>
            <span className={styles.performanceLabel}>{messages.lastTrainedLabel}</span>
          </div>
          <div className={styles.performanceMetric}>
            <Activity className={styles.summaryMetricIcon} aria-hidden="true" />
            <strong className={styles.performanceValue}>
              {selectedExerciseInsights?.workoutCount ?? 0}
            </strong>
            <span className={styles.performanceLabel}>{messages.workoutsLoggedLabel}</span>
          </div>
          <div className={styles.performanceMetric}>
            <Dumbbell className={styles.summaryMetricIcon} aria-hidden="true" />
            <strong className={styles.performanceValue}>
              {selectedExerciseInsights?.completedSetCount ?? 0}
            </strong>
            <span className={styles.performanceLabel}>{messages.completedSetsLabel}</span>
          </div>
        </div>

        {selectedExercise.notes ? (
          <aside className={styles.exerciseNotes}>
            <NotebookText className={styles.exerciseNotesIcon} aria-hidden="true" />
            <div>
              <strong>{messages.exerciseNotesTitle}</strong>
              <p>{selectedExercise.notes}</p>
            </div>
          </aside>
        ) : null}

        <section className={styles.detailSection} aria-labelledby="last-performance-title">
          <h2 className={styles.detailSectionTitle} id="last-performance-title">
            {messages.lastPerformanceTitle}
          </h2>
          {latestPerformance ? (
            <article className={styles.workoutPerformanceCard}>
              <div className={styles.workoutPerformanceHeader}>
                <div>
                  <strong>{latestPerformance.sessionName ?? messages.noWorkoutName}</strong>
                  <span>{formatShortDate(latestPerformance.startedAt)}</span>
                </div>
                <span className={styles.restBadge}>
                  {messages.restTargetValue.replace(
                    "{duration}",
                    formatTimerDuration(latestRestSeconds),
                  )}
                </span>
              </div>
              <p className={styles.workoutPerformanceMeta}>
                {formatPerformanceSummary(
                  latestPerformance,
                  selectedExercise.trackingMode,
                  settings?.weightUnit ?? "kg",
                  messages,
                )}
              </p>
              <ol className={styles.performanceSetList}>
                {latestPerformance.sets.map((set) => (
                  <li className={styles.performanceSetRow} key={set.id}>
                    <span className={styles.performanceSetNumber}>{set.order + 1}</span>
                    <span>
                      <strong>
                        {formatWorkoutSet(set, selectedExercise.trackingMode, messages)}
                      </strong>
                      {set.notes ? <small>{set.notes}</small> : null}
                    </span>
                  </li>
                ))}
              </ol>
              {latestPerformance.exerciseNotes || latestPerformance.sessionNotes ? (
                <div className={styles.performanceNotes}>
                  <NotebookText aria-hidden="true" />
                  <span>{formatPerformanceNotes(latestPerformance, messages)}</span>
                </div>
              ) : null}
            </article>
          ) : (
            <p className={styles.detailEmpty}>{messages.lastPerformanceEmpty}</p>
          )}
        </section>

        <section className={styles.detailSection} aria-labelledby="exercise-progress-title">
          <div className={styles.detailSectionHeader}>
            <div>
              <h2 className={styles.detailSectionTitle} id="exercise-progress-title">
                {messages.progressTitle}
              </h2>
              <p className={styles.detailSectionDescription}>{messages.progressDescription}</p>
            </div>
            <ChartNoAxesCombined className={styles.detailSectionIcon} aria-hidden="true" />
          </div>
          {selectedExerciseInsights && selectedExerciseInsights.progress.points.length > 0 ? (
            <div className={styles.progressCard}>
              <div className={styles.progressControls}>
                {selectedExercise.trackingMode === "weighted" ? (
                  <label className={styles.progressField}>
                    <span>{messages.progressMetricLabel}</span>
                    <select
                      value={weightedProgressKind}
                      onChange={(event) =>
                        setWeightedProgressKind(
                          event.currentTarget.value as WeightedExerciseProgressKind,
                        )
                      }
                    >
                      <option value="estimatedStrength">
                        {messages.estimatedStrengthProgressLabel}
                      </option>
                      <option value="weight">{messages.weightProgressLabel}</option>
                    </select>
                  </label>
                ) : (
                  <span className={styles.progressMetricName}>
                    {getExerciseProgressMetricLabel(progressKind, messages)}
                  </span>
                )}
                <label className={styles.progressField}>
                  <span>{messages.progressRangeLabel}</span>
                  <select
                    value={progressRange}
                    onChange={(event) =>
                      setProgressRange(event.currentTarget.value as ExerciseProgressRange)
                    }
                  >
                    <option value="oneMonth">{messages.progressRangeOneMonth}</option>
                    <option value="threeMonths">{messages.progressRangeThreeMonths}</option>
                    <option value="all">{messages.progressRangeAll}</option>
                  </select>
                </label>
              </div>
              <div className={styles.progressStats}>
                <div>
                  <span>{messages.latestPerformanceLabel}</span>
                  <strong>
                    {selectedExerciseInsights.latestPoint
                      ? formatExerciseProgressValue(
                          selectedExerciseInsights.latestPoint.value,
                          progressKind,
                          settings?.weightUnit ?? "kg",
                          messages,
                        )
                      : "-"}
                  </strong>
                </div>
                <div>
                  <span>{messages.changeFromPreviousLabel}</span>
                  <strong
                    className={styles.progressChange({
                      trend:
                        selectedExerciseInsights.isImprovement === null
                          ? "neutral"
                          : selectedExerciseInsights.isImprovement
                            ? "positive"
                            : "negative",
                    })}
                  >
                    {selectedExerciseInsights.isImprovement === true ? (
                      <TrendingUp aria-hidden="true" />
                    ) : selectedExerciseInsights.isImprovement === false ? (
                      <TrendingDown aria-hidden="true" />
                    ) : null}
                    {formatProgressChange(
                      selectedExerciseInsights.changeFromPrevious,
                      progressKind,
                      settings?.weightUnit ?? "kg",
                      messages,
                    )}
                  </strong>
                </div>
                <div>
                  <span>{messages.bestPerformanceLabel}</span>
                  <strong>
                    {selectedExerciseInsights.bestPoint
                      ? formatExerciseProgressValue(
                          selectedExerciseInsights.bestPoint.value,
                          progressKind,
                          settings?.weightUnit ?? "kg",
                          messages,
                        )
                      : "-"}
                  </strong>
                  {selectedExerciseInsights.bestPoint ? (
                    <small>{formatShortDate(selectedExerciseInsights.bestPoint.startedAt)}</small>
                  ) : null}
                </div>
              </div>
              {visibleProgressPoints.length > 0 ? (
                <ExerciseProgressChart
                  key={progressKind + "-" + progressRange}
                  points={visibleProgressPoints}
                  kind={progressKind}
                  weightUnit={settings?.weightUnit ?? "kg"}
                  exerciseName={selectedExercise.name}
                  messages={messages}
                />
              ) : (
                <p className={styles.progressRangeEmpty}>{messages.noProgressInRange}</p>
              )}
              {selectedExerciseInsights.progress.points.some((point) => point.isPersonalRecord) ? (
                <span className={styles.prLegend}>
                  <Star aria-hidden="true" />
                  {messages.personalRecordMarker}
                </span>
              ) : null}
            </div>
          ) : (
            <p className={styles.detailEmpty}>{messages.noExerciseProgress}</p>
          )}
        </section>

        <section className={styles.detailSection} aria-labelledby="earlier-performances-title">
          <div className={styles.detailSectionHeader}>
            <div>
              <h2 className={styles.detailSectionTitle} id="earlier-performances-title">
                {messages.earlierPerformancesTitle}
              </h2>
              <p className={styles.detailSectionDescription}>
                {messages.earlierPerformancesDescription}
              </p>
            </div>
            {allEarlierPerformances.length > 5 ? (
              <button
                className={styles.detailTextButton}
                type="button"
                aria-expanded={isFullPerformanceHistoryOpen}
                onClick={() => setIsFullPerformanceHistoryOpen((isOpen) => !isOpen)}
              >
                {isFullPerformanceHistoryOpen ? messages.showRecentAction : messages.viewAllAction}
              </button>
            ) : null}
          </div>
          {earlierPerformances.length > 0 ? (
            <ol className={styles.performanceHistoryList}>
              {earlierPerformances.map((performance) => (
                <li className={styles.performanceHistoryCard} key={performance.sessionId}>
                  <div className={styles.performanceHistoryHeader}>
                    <div>
                      <strong>{performance.sessionName ?? messages.noWorkoutName}</strong>
                      <span>{formatShortDate(performance.startedAt)}</span>
                    </div>
                    <span>
                      {formatPerformanceSummary(
                        performance,
                        selectedExercise.trackingMode,
                        settings?.weightUnit ?? "kg",
                        messages,
                      )}
                    </span>
                  </div>
                  <div className={styles.performanceHistorySets}>
                    {performance.sets.map((set) => (
                      <span key={set.id}>
                        {formatWorkoutSet(set, selectedExercise.trackingMode, messages)}
                      </span>
                    ))}
                  </div>
                  {performance.exerciseNotes || performance.sessionNotes ? (
                    <p className={styles.performanceHistoryNotes}>
                      {formatPerformanceNotes(performance, messages)}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.detailEmpty}>{messages.noEarlierPerformances}</p>
          )}
        </section>

        <button
          className={styles.detailLogButton}
          type="button"
          disabled={isPreparingWorkout}
          onClick={() => void logSelectedExercise()}
        >
          <span>{isPreparingWorkout ? messages.loggingSetAction : messages.logSetAction}</span>
          <Plus className={styles.detailLogIcon} aria-hidden="true" />
        </button>

        <Dialog.Root open={isFormOpen} onOpenChange={updateFormDialog}>
          <Dialog.Portal>
            <Dialog.Overlay className={styles.dialogOverlay} />
            <div className={styles.dialogViewport}>
              <Dialog.Content className={styles.formDialogContent}>
                <form className={styles.formPanel} onSubmit={saveExercise}>
                  <div className={styles.formHeader}>
                    <Dialog.Title className={styles.formTitle}>
                      {isEditing ? messages.formEditTitle : messages.formCreateTitle}
                    </Dialog.Title>
                    <Dialog.Close asChild>
                      <button className={styles.iconButton({ variant: "ghost" })} type="button">
                        <X className={styles.icon} aria-hidden="true" />
                        <span className={styles.visuallyHidden}>{messages.cancelAction}</span>
                      </button>
                    </Dialog.Close>
                  </div>

                  <Dialog.Description className={styles.visuallyHidden}>
                    {messages.description}
                  </Dialog.Description>

                  {formFeedbackMessage ? (
                    <p className={styles.feedback}>{formFeedbackMessage}</p>
                  ) : null}

                  <label className={styles.field}>
                    <span className={styles.label}>{messages.nameLabel}</span>
                    <input
                      className={styles.input}
                      value={formState.name}
                      placeholder={messages.namePlaceholder}
                      onChange={(event) => updateFormField("name", event.currentTarget.value)}
                    />
                  </label>

                  <label className={styles.field}>
                    <span className={styles.label}>{messages.muscleGroupsLabel}</span>
                    <input
                      className={styles.input}
                      value={formState.muscleGroups}
                      placeholder={messages.muscleGroupsPlaceholder}
                      onChange={(event) =>
                        updateFormField("muscleGroups", event.currentTarget.value)
                      }
                    />
                  </label>

                  <label className={styles.field}>
                    <span className={styles.label}>{messages.equipmentLabel}</span>
                    <input
                      className={styles.input}
                      value={formState.equipment}
                      placeholder={messages.equipmentPlaceholder}
                      onChange={(event) => updateFormField("equipment", event.currentTarget.value)}
                    />
                  </label>

                  <label className={styles.field}>
                    <span className={styles.label}>{messages.notesLabel}</span>
                    <textarea
                      className={styles.textarea}
                      value={formState.notes}
                      placeholder={messages.notesPlaceholder}
                      onChange={(event) => updateFormField("notes", event.currentTarget.value)}
                    />
                  </label>

                  <label className={styles.field}>
                    <span className={styles.label}>{messages.trackingModeLabel}</span>
                    <select
                      className={styles.input}
                      value={formState.trackingMode}
                      onChange={(event) =>
                        updateFormField(
                          "trackingMode",
                          event.currentTarget.value as ExerciseTrackingMode,
                        )
                      }
                    >
                      <option value="weighted">{messages.trackingModeWeighted}</option>
                      <option value="assisted">{messages.trackingModeAssisted}</option>
                      <option value="bodyweight">{messages.trackingModeBodyweight}</option>
                      <option value="timed">{messages.trackingModeTimed}</option>
                    </select>
                    <span className={styles.checkboxHint}>{messages.trackingModeHint}</span>
                  </label>

                  <ConfidenceRatingField
                    inputName="exercise-detail-confidence"
                    value={formState.confidenceRating}
                    messages={messages}
                    onChange={(rating) => updateFormField("confidenceRating", rating)}
                  />

                  <div className={styles.formActions}>
                    <button className={styles.button({ variant: "primary" })} type="submit">
                      <Check className={styles.icon} aria-hidden="true" />
                      <span>{isEditing ? messages.saveEditAction : messages.saveCreateAction}</span>
                    </button>
                    <Dialog.Close asChild>
                      <button className={styles.button({ variant: "secondary" })} type="button">
                        {messages.cancelAction}
                      </button>
                    </Dialog.Close>
                  </div>
                </form>
              </Dialog.Content>
            </div>
          </Dialog.Portal>
        </Dialog.Root>
      </section>
    );
  }

  return (
    <section className={styles.root} aria-labelledby="exercise-library-title">
      <header className={styles.header}>
        <div className={styles.headerText}>
          <p className={styles.eyebrow}>{messages.eyebrow}</p>
          <h1 className={styles.title} id="exercise-library-title">
            {messages.title}
          </h1>
          <p className={styles.description}>{messages.description}</p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.countBadge} aria-label={messages.totalLabel}>
            <span className={styles.countValue}>{exercises.length}</span>
            <span className={styles.countLabel}>{messages.totalLabel}</span>
          </div>
          <button
            className={styles.button({ variant: "primary" })}
            type="button"
            onClick={openCreateForm}
          >
            <CirclePlus className={styles.icon} aria-hidden="true" />
            <span>{messages.addAction}</span>
          </button>
        </div>
      </header>

      {pageFeedbackMessage ? <p className={styles.feedback}>{pageFeedbackMessage}</p> : null}

      <Dialog.Root open={isFormOpen} onOpenChange={updateFormDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <div className={styles.dialogViewport}>
            <Dialog.Content className={styles.formDialogContent}>
              <form className={styles.formPanel} onSubmit={saveExercise}>
                <div className={styles.formHeader}>
                  <Dialog.Title className={styles.formTitle}>
                    {isEditing ? messages.formEditTitle : messages.formCreateTitle}
                  </Dialog.Title>
                  <Dialog.Close asChild>
                    <button className={styles.iconButton({ variant: "ghost" })} type="button">
                      <X className={styles.icon} aria-hidden="true" />
                      <span className={styles.visuallyHidden}>{messages.cancelAction}</span>
                    </button>
                  </Dialog.Close>
                </div>

                <Dialog.Description className={styles.visuallyHidden}>
                  {messages.description}
                </Dialog.Description>

                {formFeedbackMessage ? (
                  <p className={styles.feedback}>{formFeedbackMessage}</p>
                ) : null}

                <label className={styles.field}>
                  <span className={styles.label}>{messages.nameLabel}</span>
                  <input
                    className={styles.input}
                    value={formState.name}
                    placeholder={messages.namePlaceholder}
                    onChange={(event) => updateFormField("name", event.currentTarget.value)}
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.label}>{messages.muscleGroupsLabel}</span>
                  <input
                    className={styles.input}
                    value={formState.muscleGroups}
                    placeholder={messages.muscleGroupsPlaceholder}
                    onChange={(event) => updateFormField("muscleGroups", event.currentTarget.value)}
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.label}>{messages.equipmentLabel}</span>
                  <input
                    className={styles.input}
                    value={formState.equipment}
                    placeholder={messages.equipmentPlaceholder}
                    onChange={(event) => updateFormField("equipment", event.currentTarget.value)}
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.label}>{messages.notesLabel}</span>
                  <textarea
                    className={styles.textarea}
                    value={formState.notes}
                    placeholder={messages.notesPlaceholder}
                    onChange={(event) => updateFormField("notes", event.currentTarget.value)}
                  />
                </label>

                <label className={styles.field}>
                  <span className={styles.label}>{messages.trackingModeLabel}</span>
                  <select
                    className={styles.input}
                    value={formState.trackingMode}
                    onChange={(event) =>
                      updateFormField(
                        "trackingMode",
                        event.currentTarget.value as ExerciseTrackingMode,
                      )
                    }
                  >
                    <option value="weighted">{messages.trackingModeWeighted}</option>
                    <option value="assisted">{messages.trackingModeAssisted}</option>
                    <option value="bodyweight">{messages.trackingModeBodyweight}</option>
                    <option value="timed">{messages.trackingModeTimed}</option>
                  </select>
                  <span className={styles.checkboxHint}>{messages.trackingModeHint}</span>
                </label>

                <ConfidenceRatingField
                  inputName="exercise-library-confidence"
                  value={formState.confidenceRating}
                  messages={messages}
                  onChange={(rating) => updateFormField("confidenceRating", rating)}
                />

                <div className={styles.formActions}>
                  <button className={styles.button({ variant: "primary" })} type="submit">
                    <Check className={styles.icon} aria-hidden="true" />
                    <span>{isEditing ? messages.saveEditAction : messages.saveCreateAction}</span>
                  </button>
                  <Dialog.Close asChild>
                    <button className={styles.button({ variant: "secondary" })} type="button">
                      {messages.cancelAction}
                    </button>
                  </Dialog.Close>
                </div>
              </form>
            </Dialog.Content>
          </div>
        </Dialog.Portal>
      </Dialog.Root>

      {loadState === "ready" && exercises.length === 0 ? (
        <div className={styles.emptyState}>
          <Dumbbell className={styles.emptyIcon} aria-hidden="true" />
          <h2 className={styles.emptyTitle}>{messages.emptyTitle}</h2>
          <p className={styles.emptyDescription}>{messages.emptyDescription}</p>
          <button
            className={styles.button({ variant: "primary" })}
            type="button"
            onClick={openCreateForm}
          >
            <CirclePlus className={styles.icon} aria-hidden="true" />
            <span>{messages.addAction}</span>
          </button>
        </div>
      ) : null}

      {loadState === "ready" && exercises.length > 0 ? (
        <ul className={styles.exerciseList}>
          {exercises.map((exercise) => (
            <li className={styles.exerciseCard} key={exercise.id}>
              <button
                aria-label={formatExerciseActionLabel(
                  messages.viewExerciseAriaLabel,
                  exercise.name,
                )}
                className={styles.exerciseDetailButton}
                type="button"
                onClick={() => openDetail(exercise)}
              >
                <div className={styles.exerciseHeading}>
                  <h2 className={styles.exerciseName}>{exercise.name}</h2>
                  <div className={styles.exerciseMetaRow}>
                    <p className={styles.equipment}>{exercise.equipment ?? messages.noEquipment}</p>
                    {exercise.confidenceRating ? (
                      <span className={styles.confidenceBadge}>
                        <Star aria-hidden="true" />
                        {messages.confidenceValue.replace(
                          "{rating}",
                          String(exercise.confidenceRating),
                        )}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className={styles.muscleGroups}>
                  {exercise.muscleGroups.length > 0 ? (
                    exercise.muscleGroups.map((muscleGroup) => (
                      <span className={styles.muscleGroup} key={muscleGroup}>
                        {formatMuscleGroupLabel(muscleGroup)}
                      </span>
                    ))
                  ) : (
                    <span className={styles.muscleGroupMuted}>{messages.noMuscleGroups}</span>
                  )}
                </div>

                {exercise.notes ? <p className={styles.notes}>{exercise.notes}</p> : null}
              </button>

              <div className={styles.cardActions}>
                <button
                  aria-label={formatExerciseActionLabel(
                    messages.editExerciseAriaLabel,
                    exercise.name,
                  )}
                  className={styles.iconButton({ variant: "secondary" })}
                  type="button"
                  onClick={() => openEditForm(exercise)}
                >
                  <Pencil className={styles.icon} aria-hidden="true" />
                </button>
                <AlertDialog.Root
                  open={pendingDeleteId === exercise.id}
                  onOpenChange={(isOpen) => updateDeleteDialog(isOpen, exercise.id)}
                >
                  <AlertDialog.Trigger asChild>
                    <button
                      aria-label={formatExerciseActionLabel(
                        messages.deleteExerciseAriaLabel,
                        exercise.name,
                      )}
                      className={styles.iconButton({ variant: "danger" })}
                      type="button"
                    >
                      <Trash2 className={styles.icon} aria-hidden="true" />
                    </button>
                  </AlertDialog.Trigger>

                  <AlertDialog.Portal>
                    <AlertDialog.Overlay className={styles.dialogOverlay} />
                    <div className={styles.dialogViewport}>
                      <AlertDialog.Content className={styles.dialogContent}>
                        <AlertDialog.Title className={styles.dialogTitle}>
                          {messages.deleteConfirmTitle}
                        </AlertDialog.Title>
                        <AlertDialog.Description className={styles.dialogDescription}>
                          <strong>{exercise.name}</strong>
                          <span>{messages.deleteConfirmDescription}</span>
                        </AlertDialog.Description>
                        <div className={styles.dialogActions}>
                          <AlertDialog.Action asChild>
                            <button
                              className={styles.button({ variant: "danger" })}
                              type="button"
                              onClick={() => void confirmDelete(exercise.id)}
                            >
                              <Trash2 className={styles.icon} aria-hidden="true" />
                              <span>{messages.deleteConfirmAction}</span>
                            </button>
                          </AlertDialog.Action>
                          <AlertDialog.Cancel asChild>
                            <button
                              className={styles.button({ variant: "secondary" })}
                              type="button"
                            >
                              {messages.deleteCancelAction}
                            </button>
                          </AlertDialog.Cancel>
                        </div>
                      </AlertDialog.Content>
                    </div>
                  </AlertDialog.Portal>
                </AlertDialog.Root>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};
