import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CirclePlus,
  Clock3,
  Dumbbell,
  MoreHorizontal,
  Pencil,
  Plus,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { styles } from "./exercise-library.styles";
import type {
  EntityId,
  Exercise,
  ExerciseRepository,
  ExerciseTrackingMode,
  WeightUnit,
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSessionRepository,
  WorkoutSet,
} from "@/db";
import { exerciseRepository, formatMuscleGroupLabel, workoutSessionRepository } from "@/db";
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

  /** Called after the user wants to log this exercise in the active workout. */
  onOpenWorkout?: () => void;

  /** Called when the user wants to inspect full workout history. */
  onOpenHistory?: () => void;
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

  /** Notes textarea value. */
  notes: string;
};

/** Async loading states used by the exercise library. */
type LoadState = "loading" | "ready" | "error";

/** Logged set with the containing workout session attached. */
type ExerciseSetEntry = {
  /** Persisted workout session that contains the set. */
  session: WorkoutSession;

  /** Exercise block within the persisted workout session. */
  sessionExercise: WorkoutSessionExercise;

  /** Logged set for the selected exercise. */
  set: WorkoutSet;
};

const poundsPerKilogram = 2.204_622_621_8;

/** Creates an empty exercise form state. */
const createEmptyFormState = (): ExerciseFormState => {
  return {
    name: "",
    muscleGroups: "",
    equipment: "",
    trackingMode: "weighted",
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
    notes: formState.notes.trim() || null,
  };
};

/** Formats an exercise action label with the target exercise name. */
const formatExerciseActionLabel = (template: string, exerciseName: string): string => {
  return template.replace("{name}", exerciseName);
};

/** Formats a nullable weight value for detail metrics. */
const formatWeight = (weight: number | null, unit = "kg"): string => {
  if (weight === null) {
    return "-";
  }

  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  }).format(weight)} ${unit}`;
};

/** Formats a set's repetition count for display. */
const formatReps = (reps: number | null, messages: ExerciseLibraryMessages): string => {
  return reps === null ? messages.noReps : messages.repsValue.replace("{count}", String(reps));
};

/** Formats a set's primary effort as either a hold duration or a rep count. */
const formatSetEffort = (set: WorkoutSet, messages: ExerciseLibraryMessages): string => {
  if (set.durationSeconds != null) {
    return messages.durationValue.replace("{seconds}", String(set.durationSeconds));
  }

  return formatReps(set.reps, messages);
};

/** Formats seconds as a timer duration. */
const formatTimerDuration = (seconds: number): string => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
};

/** Formats a saved workout date for personal-best cards. */
const formatShortDate = (timestamp: string): string => {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp));
};

/** Converts a logged weight into a consistent comparison or display unit. */
const convertWeight = (weight: number, fromUnit: WeightUnit, toUnit: WeightUnit): number => {
  if (fromUnit === toUnit) {
    return weight;
  }

  return fromUnit === "kg" ? weight * poundsPerKilogram : weight / poundsPerKilogram;
};

/** Estimates one-rep max using the Epley formula in the requested unit. */
const estimateOneRepMax = (set: WorkoutSet, weightUnit: WeightUnit = set.weightUnit): number => {
  if (set.weight === null || set.reps === null || set.weight <= 0 || set.reps <= 0) {
    return 0;
  }

  return convertWeight(set.weight, set.weightUnit, weightUnit) * (1 + set.reps / 30);
};

/** Returns all sets logged for one exercise, newest first. */
const getExerciseSetEntries = (
  exerciseId: EntityId,
  sessions: WorkoutSession[],
): ExerciseSetEntry[] => {
  return sessions
    .flatMap((session) =>
      session.exercises
        .filter((sessionExercise) => sessionExercise.exerciseId === exerciseId)
        .flatMap((sessionExercise) =>
          sessionExercise.sets
            .filter((set) => set.isCompleted)
            .map((set) => ({
              session,
              sessionExercise,
              set,
            })),
        ),
    )
    .sort((firstEntry, secondEntry) => {
      const firstTimestamp = firstEntry.set.completedAt ?? firstEntry.session.startedAt;
      const secondTimestamp = secondEntry.set.completedAt ?? secondEntry.session.startedAt;

      return new Date(secondTimestamp).getTime() - new Date(firstTimestamp).getTime();
    });
};

/** Calculates normalized total volume for a list of completed sets. */
const calculateVolume = (entries: ExerciseSetEntry[], weightUnit: WeightUnit): number => {
  return entries.reduce((volume, entry) => {
    const weight =
      entry.set.weight === null
        ? 0
        : convertWeight(entry.set.weight, entry.set.weightUnit, weightUnit);

    return volume + weight * (entry.set.reps ?? 0);
  }, 0);
};

/** Finds the best set using the selected exercise's progress semantics. */
const findBestSetEntry = (
  entries: ExerciseSetEntry[],
  exercise: Exercise | undefined,
): ExerciseSetEntry | undefined => {
  return [...entries].sort((firstEntry, secondEntry) => {
    if (exercise?.trackingMode === "timed") {
      return (secondEntry.set.durationSeconds ?? 0) - (firstEntry.set.durationSeconds ?? 0);
    }

    if (exercise?.trackingMode === "assisted") {
      const firstWeight =
        firstEntry.set.weight === null
          ? Number.POSITIVE_INFINITY
          : convertWeight(firstEntry.set.weight, firstEntry.set.weightUnit, "kg");
      const secondWeight =
        secondEntry.set.weight === null
          ? Number.POSITIVE_INFINITY
          : convertWeight(secondEntry.set.weight, secondEntry.set.weightUnit, "kg");

      return firstWeight - secondWeight;
    }

    if (exercise?.trackingMode === "bodyweight") {
      return (secondEntry.set.reps ?? 0) - (firstEntry.set.reps ?? 0);
    }

    return estimateOneRepMax(secondEntry.set, "kg") - estimateOneRepMax(firstEntry.set, "kg");
  })[0];
};

/** Finds a useful default rest duration from recent logged sets. */
const getDefaultRestSeconds = (entries: ExerciseSetEntry[]): number => {
  const entryWithRest = entries.find(
    (entry) => entry.set.restSeconds !== null || entry.sessionExercise.restSeconds !== null,
  );

  return entryWithRest?.set.restSeconds ?? entryWithRest?.sessionExercise.restSeconds ?? 150;
};

/** Root exercise library feature with create, edit, list, and delete flows. */
export const ExerciseLibrary = ({
  messages,
  isActive = true,
  repository = exerciseRepository,
  sessionRepository = workoutSessionRepository,
  onOpenWorkout,
  onOpenHistory,
}: ExerciseLibraryProps) => {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [finishedSessions, setFinishedSessions] = useState<WorkoutSession[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [formState, setFormState] = useState<ExerciseFormState>(createEmptyFormState);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingExerciseId, setEditingExerciseId] = useState<EntityId | null>(null);
  const [selectedExerciseId, setSelectedExerciseId] = useState<EntityId | null>(null);
  const [isPreparingWorkout, setIsPreparingWorkout] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<EntityId | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const editingExercise = useMemo(() => {
    return exercises.find((exercise) => exercise.id === editingExerciseId);
  }, [editingExerciseId, exercises]);
  const selectedExercise = useMemo(() => {
    return exercises.find((exercise) => exercise.id === selectedExerciseId);
  }, [exercises, selectedExerciseId]);
  const selectedSetEntries = useMemo(() => {
    return selectedExercise ? getExerciseSetEntries(selectedExercise.id, finishedSessions) : [];
  }, [finishedSessions, selectedExercise]);

  const isEditing = editingExerciseId !== null;
  const canSubmit = formState.name.trim().length > 0;
  const formFeedbackMessage = isFormOpen ? feedbackMessage : null;
  const pageFeedbackMessage = isFormOpen ? null : feedbackMessage;
  const latestSetEntry = selectedSetEntries[0];
  const bestSetEntry = findBestSetEntry(selectedSetEntries, selectedExercise);
  const volumeWeightUnit = latestSetEntry?.set.weightUnit ?? "kg";
  const estimatedOneRepMax =
    bestSetEntry && selectedExercise?.trackingMode === "weighted"
      ? estimateOneRepMax(bestSetEntry.set)
      : 0;
  const totalVolume = calculateVolume(selectedSetEntries, volumeWeightUnit);
  const defaultRestSeconds = getDefaultRestSeconds(selectedSetEntries);

  /** Refreshes the local exercise list from IndexedDB. */
  const refreshData = useCallback(async () => {
    try {
      const [nextExercises, nextFinishedSessions] = await Promise.all([
        repository.list(),
        sessionRepository.listFinished(),
      ]);

      setExercises(nextExercises);
      setFinishedSessions(nextFinishedSessions);
      setLoadState("ready");
    } catch {
      setLoadState("error");
      setFeedbackMessage(messages.loadError);
    }
  }, [messages.loadError, repository, sessionRepository]);

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
    setSelectedExerciseId(null);
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
      setSelectedExerciseId((currentExerciseId) =>
        currentExerciseId === exerciseId ? null : currentExerciseId,
      );
      setPendingDeleteId(null);
      await refreshData();
    } catch {
      setFeedbackMessage(messages.deleteError);
    }
  };

  /** Opens the full exercise detail page. */
  const openDetail = (exercise: Exercise) => {
    setFeedbackMessage(null);
    setSelectedExerciseId(exercise.id);
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
    const recentSetEntries = selectedSetEntries.slice(0, 5);

    return (
      <section className={styles.detailRoot} aria-labelledby="exercise-detail-title">
        <header className={styles.detailTopBar}>
          <button
            className={styles.iconButton({ variant: "ghost" })}
            type="button"
            onClick={() => setSelectedExerciseId(null)}
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
            </div>
          </div>
        </div>

        <section className={styles.detailSection} aria-labelledby="previous-performance-title">
          <div className={styles.detailSectionHeader}>
            <h2 className={styles.detailSectionTitle} id="previous-performance-title">
              {messages.previousPerformanceTitle}
            </h2>
            {onOpenHistory ? (
              <button className={styles.detailTextButton} type="button" onClick={onOpenHistory}>
                {messages.viewAllAction}
              </button>
            ) : null}
          </div>
          <div className={styles.performanceCard}>
            <div className={styles.performanceMetric}>
              <span className={styles.performanceLabel}>{messages.lastMetricLabel}</span>
              <strong className={styles.performanceValue}>
                {latestSetEntry
                  ? selectedExercise.trackingMode === "timed" ||
                    selectedExercise.trackingMode === "bodyweight"
                    ? formatSetEffort(latestSetEntry.set, messages)
                    : formatWeight(latestSetEntry.set.weight, latestSetEntry.set.weightUnit)
                  : "-"}
              </strong>
              <span className={styles.performanceMeta}>
                {latestSetEntry
                  ? selectedExercise.trackingMode === "timed"
                    ? latestSetEntry.set.weight === null
                      ? messages.trackingModeTimed
                      : formatWeight(latestSetEntry.set.weight, latestSetEntry.set.weightUnit)
                    : selectedExercise.trackingMode === "bodyweight"
                      ? messages.bodyweightMetricHint
                      : formatSetEffort(latestSetEntry.set, messages)
                  : messages.noSets}
              </span>
            </div>
            <div className={styles.performanceMetric}>
              <span className={styles.performanceLabel}>{messages.volumeMetricLabel}</span>
              <strong className={styles.performanceValue}>
                {selectedExercise.trackingMode === "weighted" && selectedSetEntries.length > 0
                  ? formatWeight(totalVolume, volumeWeightUnit)
                  : "-"}
              </strong>
              <span className={styles.performanceMeta}>{messages.totalMetricLabel}</span>
            </div>
            <div className={styles.performanceMetric}>
              <span className={styles.performanceLabel}>
                {selectedExercise.trackingMode === "timed"
                  ? messages.durationMetricLabel
                  : selectedExercise.trackingMode === "assisted"
                    ? messages.assistanceMetricLabel
                    : selectedExercise.trackingMode === "bodyweight"
                      ? messages.repetitionsMetricLabel
                      : messages.oneRepMaxMetricLabel}
              </span>
              <strong className={styles.performanceValue}>
                {selectedExercise.trackingMode === "timed" && bestSetEntry
                  ? formatSetEffort(bestSetEntry.set, messages)
                  : selectedExercise.trackingMode === "assisted" && bestSetEntry
                    ? formatWeight(bestSetEntry.set.weight, bestSetEntry.set.weightUnit)
                    : selectedExercise.trackingMode === "bodyweight" && bestSetEntry
                      ? formatSetEffort(bestSetEntry.set, messages)
                      : estimatedOneRepMax > 0
                        ? formatWeight(estimatedOneRepMax, bestSetEntry?.set.weightUnit ?? "kg")
                        : "-"}
              </strong>
              <span className={styles.performanceMeta}>
                {selectedExercise.trackingMode === "timed"
                  ? messages.durationMetricHint
                  : selectedExercise.trackingMode === "assisted"
                    ? messages.assistanceMetricHint
                    : selectedExercise.trackingMode === "bodyweight"
                      ? messages.bodyweightMetricHint
                      : messages.oneRepMaxFormulaLabel}
              </span>
            </div>
          </div>
        </section>

        <section className={styles.detailSection} aria-labelledby="recent-sets-title">
          <h2 className={styles.detailSectionTitle} id="recent-sets-title">
            {messages.recentSetsTitle}
          </h2>
          {recentSetEntries.length > 0 ? (
            <ol className={styles.recentSetList}>
              {recentSetEntries.map((entry, index) => (
                <li className={styles.recentSetRow} key={`${entry.session.id}-${entry.set.id}`}>
                  <CheckCircle2 className={styles.recentSetIcon} aria-hidden="true" />
                  <span className={styles.recentSetNumber}>{index + 1}</span>
                  <span className={styles.recentSetWeight}>
                    {formatWeight(entry.set.weight, entry.set.weightUnit)}
                  </span>
                  <span className={styles.recentSetReps}>
                    {formatSetEffort(entry.set, messages)}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className={styles.detailEmpty}>{messages.noRecentSets}</p>
          )}
        </section>

        <div className={styles.detailCards}>
          <article className={styles.detailInfoCard}>
            <div className={styles.detailInfoHeader}>
              <span className={styles.detailInfoLabel}>{messages.personalBestTitle}</span>
              <Star className={styles.detailInfoIcon} aria-hidden="true" />
            </div>
            <strong className={styles.detailInfoValue}>
              {bestSetEntry
                ? selectedExercise.trackingMode === "timed" ||
                  selectedExercise.trackingMode === "bodyweight"
                  ? formatSetEffort(bestSetEntry.set, messages)
                  : formatWeight(bestSetEntry.set.weight, bestSetEntry.set.weightUnit)
                : "-"}
            </strong>
            <span className={styles.detailInfoMeta}>
              {bestSetEntry
                ? selectedExercise.trackingMode === "timed"
                  ? bestSetEntry.set.weight === null
                    ? messages.trackingModeTimed
                    : formatWeight(bestSetEntry.set.weight, bestSetEntry.set.weightUnit)
                  : selectedExercise.trackingMode === "bodyweight"
                    ? messages.bodyweightMetricHint
                    : formatSetEffort(bestSetEntry.set, messages)
                : messages.noSets}
            </span>
            <span className={styles.detailInfoDate}>
              {bestSetEntry
                ? formatShortDate(bestSetEntry.set.completedAt ?? bestSetEntry.session.startedAt)
                : messages.noPerformanceDate}
            </span>
          </article>
          <article className={styles.detailInfoCard}>
            <div className={styles.detailInfoHeader}>
              <span className={styles.detailInfoLabel}>{messages.defaultRestTitle}</span>
              <Clock3 className={styles.detailInfoIconMuted} aria-hidden="true" />
            </div>
            <strong className={styles.detailInfoValue}>
              {formatTimerDuration(defaultRestSeconds)}
            </strong>
            <span className={styles.detailInfoMeta}>{messages.timerUnitLabel}</span>
          </article>
        </div>

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
                  <p className={styles.equipment}>{exercise.equipment ?? messages.noEquipment}</p>
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
