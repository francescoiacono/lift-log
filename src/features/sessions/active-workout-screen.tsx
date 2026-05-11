import * as Dialog from "@radix-ui/react-dialog";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  CirclePlus,
  Dumbbell,
  MoreVertical,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { styles } from "./active-workout-screen.styles";
import type {
  ActiveRestTimer,
  ActiveWorkoutSnapshot,
  EntityId,
  Exercise,
  ExerciseRepository,
  WorkoutSet,
  WorkoutSessionExercise,
  WorkoutSessionRepository,
} from "@/db";
import { exerciseRepository, workoutSessionRepository } from "@/db";
import type { Messages } from "@/i18n";

/** Message dictionary used by the active workout feature. */
type ActiveWorkoutMessages = Messages["sessions"];

/** Props for the active workout screen. */
export type ActiveWorkoutScreenProps = {
  /** Localized copy used by the active workout UI. */
  messages: ActiveWorkoutMessages;

  /** Repository used to persist workout sessions. */
  repository?: WorkoutSessionRepository;

  /** Repository used to read exercise names for session entries. */
  exerciseStore?: ExerciseRepository;
};

/** Async loading states used by the active workout screen. */
type LoadState = "loading" | "ready" | "error";

/** Editable set logging fields for one exercise. */
type SetDraftState = {
  /** Controlled reps input value. */
  reps: string;

  /** Controlled weight input value. */
  weight: string;

  /** Controlled rest duration input value. */
  restSeconds: string;
};

/** Editable set logging state keyed by exercise id. */
type SetDraftsByExerciseId = Partial<Record<EntityId, SetDraftState>>;

/** Numeric set fields editable from an active workout exercise. */
type SetDraftNumberField = "reps" | "restSeconds" | "weight";

/** Target set currently being edited. */
type EditingSetTarget = {
  /** Exercise identifier that owns the edited set. */
  exerciseId: EntityId;

  /** Set identifier currently open in the settings dialog. */
  setId: EntityId;
};

/** Creates an empty draft for logging a completed set. */
const createEmptySetDraft = (): SetDraftState => {
  return {
    reps: "",
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

/** Formats a completed set into a compact workout log summary. */
const formatLoggedSet = (set: WorkoutSet, messages: ActiveWorkoutMessages): string => {
  const setLabel = messages.setNumberLabel.replace("{number}", String(set.order + 1));
  const repsLabel =
    set.reps === null ? messages.noReps : formatCountMessage(messages.repsCount, set.reps);
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

/** Mobile-first screen for the current active workout session. */
export const ActiveWorkoutScreen = ({
  messages,
  repository = workoutSessionRepository,
  exerciseStore = exerciseRepository,
}: ActiveWorkoutScreenProps) => {
  const [snapshot, setSnapshot] = useState<ActiveWorkoutSnapshot | undefined>();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isClearingTimer, setIsClearingTimer] = useState(false);
  const [savingSetExerciseId, setSavingSetExerciseId] = useState<EntityId | null>(null);
  const [setDrafts, setSetDrafts] = useState<SetDraftsByExerciseId>({});
  const [openExerciseIds, setOpenExerciseIds] = useState<EntityId[]>([]);
  const [initializedSessionId, setInitializedSessionId] = useState<EntityId | null>(null);
  const [editingSetTarget, setEditingSetTarget] = useState<EditingSetTarget | null>(null);
  const [setEditDraft, setSetEditDraft] = useState<SetDraftState>(createEmptySetDraft);
  const [isSetDialogOpen, setIsSetDialogOpen] = useState(false);
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
      sessionExercise,
      set,
    };
  }, [activeSession, editingSetTarget, exerciseById, messages.missingExercise]);

  /** Refreshes the active workout and exercise names from IndexedDB. */
  const refreshData = useCallback(async () => {
    try {
      const [nextSnapshot, nextExercises] = await Promise.all([
        repository.getActive(),
        exerciseStore.list(),
      ]);

      setSnapshot(nextSnapshot);
      setExercises(nextExercises);
      setLoadState("ready");
    } catch {
      setLoadState("error");
      setFeedbackMessage(messages.loadError);
    }
  }, [exerciseStore, messages.loadError, repository]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

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
      setFeedbackMessage(messages.finishSuccess);
    } catch {
      setFeedbackMessage(messages.finishError);
    } finally {
      setIsFinishing(false);
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
    const reps = toPositiveInteger(draft.reps);
    const weight = toOptionalNonNegativeNumber(draft.weight);
    const restSeconds = toOptionalNonNegativeInteger(draft.restSeconds);

    if (reps === undefined) {
      setFeedbackMessage(messages.validationRepsRequired);
      return;
    }

    if (weight === undefined || restSeconds === undefined) {
      setFeedbackMessage(messages.validationSetNumbers);
      return;
    }

    setSavingSetExerciseId(sessionExercise.exerciseId);
    setFeedbackMessage(null);

    try {
      const workoutSession = await repository.logSet(activeSession.id, sessionExercise.exerciseId, {
        reps,
        restSeconds,
        weight,
        weightUnit: "kg",
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

    const reps = toPositiveInteger(setEditDraft.reps);
    const weight = toOptionalNonNegativeNumber(setEditDraft.weight);
    const restSeconds = toOptionalNonNegativeInteger(setEditDraft.restSeconds);

    if (reps === undefined) {
      setFeedbackMessage(messages.validationRepsRequired);
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
          reps,
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
    <section className={styles.root} aria-labelledby="active-workout-title">
      <header className={styles.header}>
        <div className={styles.headerText}>
          <p className={styles.eyebrow}>{messages.eyebrow}</p>
          <h1 className={styles.title} id="active-workout-title">
            {messages.title}
          </h1>
          <p className={styles.description}>{messages.description}</p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.countBadge} aria-label={messages.totalLabel}>
            <span className={styles.countValue}>{sessionExercises.length}</span>
            <span className={styles.countLabel}>{messages.totalLabel}</span>
          </div>
        </div>
      </header>

      {feedbackMessage ? <p className={styles.feedback}>{feedbackMessage}</p> : null}

      {loadState === "loading" ? (
        <div className={styles.emptyState}>
          <Dumbbell className={styles.emptyIcon} aria-hidden="true" />
          <h2 className={styles.emptyTitle}>{messages.loadingTitle}</h2>
          <p className={styles.emptyDescription}>{messages.loadingDescription}</p>
        </div>
      ) : null}

      {loadState === "ready" && !activeSession ? (
        <div className={styles.emptyState}>
          <Dumbbell className={styles.emptyIcon} aria-hidden="true" />
          <h2 className={styles.emptyTitle}>{messages.noActiveTitle}</h2>
          <p className={styles.emptyDescription}>{messages.noActiveDescription}</p>
        </div>
      ) : null}

      {loadState === "ready" && activeSession ? (
        <article
          className={styles.sessionPanel}
          aria-label={formatSessionTitle(activeSession.name, messages)}
        >
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
            </div>
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

          {sessionExercises.length === 0 ? (
            <div className={styles.emptyState}>
              <Dumbbell className={styles.emptyIcon} aria-hidden="true" />
              <h3 className={styles.emptyTitle}>{messages.noExercisesTitle}</h3>
              <p className={styles.emptyDescription}>{messages.noExercisesDescription}</p>
            </div>
          ) : (
            <ul className={styles.exerciseList}>
              {sessionExercises.map((sessionExercise) => {
                const exercise = exerciseById.get(sessionExercise.exerciseId);
                const exerciseName = exercise?.name ?? messages.missingExercise;
                const setDraft = getSetDraft(setDrafts, sessionExercise.exerciseId);
                const sets = sortWorkoutSets(sessionExercise.sets);
                const isSavingSet = savingSetExerciseId === sessionExercise.exerciseId;
                const isExerciseOpen = openExerciseIds.includes(sessionExercise.exerciseId);

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
                          {formatSetCount(sessionExercise.sets.length, messages)}
                        </span>
                      </span>
                      <ChevronDown
                        className={styles.exerciseChevron({ open: isExerciseOpen })}
                        aria-hidden="true"
                      />
                    </button>

                    {isExerciseOpen ? (
                      <div className={styles.exerciseDetails}>
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
                              <span className={styles.setLabel}>{messages.repsLabel}</span>
                              <input
                                className={styles.setInput}
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={setDraft.reps}
                                placeholder={messages.repsPlaceholder}
                                onChange={(event) =>
                                  updateSetDraft(
                                    sessionExercise.exerciseId,
                                    "reps",
                                    event.currentTarget.value,
                                  )
                                }
                              />
                            </label>
                            <label className={styles.setField}>
                              <span className={styles.setLabel}>{messages.weightLabel}</span>
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
                            <label className={styles.setField}>
                              <span className={styles.setLabel}>{messages.restSecondsLabel}</span>
                              <input
                                className={styles.setInput}
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={setDraft.restSeconds}
                                placeholder={messages.restSecondsPlaceholder}
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

      <Dialog.Root open={activeRestTimer !== undefined && activeRestTimer !== null}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <div className={styles.dialogViewport}>
            <Dialog.Content
              className={styles.restTimerDialogContent}
              onEscapeKeyDown={(event) => event.preventDefault()}
              onPointerDownOutside={(event) => event.preventDefault()}
            >
              {activeRestTimer ? (
                <>
                  <div className={styles.restTimerText} aria-live="polite">
                    <Dialog.Title className={styles.restTimerLabel}>
                      {remainingRestSeconds > 0
                        ? messages.restTimerLabel
                        : messages.restTimerCompleteLabel}
                    </Dialog.Title>
                    <p className={styles.restTimerValue}>
                      {formatTimerDuration(remainingRestSeconds)}
                    </p>
                    <Dialog.Description className={styles.restTimerMeta}>
                      {messages.restTimerDuration.replace(
                        "{seconds}",
                        String(activeRestTimer.durationSeconds),
                      )}
                    </Dialog.Description>
                  </div>
                  <button
                    className={styles.button({ variant: "primary" })}
                    type="button"
                    disabled={isClearingTimer}
                    onClick={() => void clearRestTimer()}
                  >
                    <X className={styles.icon} aria-hidden="true" />
                    <span>{messages.skipTimerAction}</span>
                  </button>
                </>
              ) : null}
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
                      <span className={styles.setLabel}>{messages.repsLabel}</span>
                      <input
                        className={styles.setInput}
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={setEditDraft.reps}
                        placeholder={messages.repsPlaceholder}
                        onChange={(event) => updateSetEditDraft("reps", event.currentTarget.value)}
                      />
                    </label>
                    <label className={styles.setField}>
                      <span className={styles.setLabel}>{messages.weightLabel}</span>
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
