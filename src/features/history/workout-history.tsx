import * as Dialog from "@radix-ui/react-dialog";
import { Check, ChevronDown, ClipboardList, History, RotateCcw, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { styles } from "./workout-history.styles";
import type {
  EntityId,
  Exercise,
  ExerciseRepository,
  WorkoutSession,
  WorkoutSessionExercise,
  WorkoutSessionRepository,
  WorkoutSet,
} from "@/db";
import { exerciseRepository, workoutSessionRepository } from "@/db";
import type { Messages } from "@/i18n";

/** Message dictionary used by the workout history feature. */
type WorkoutHistoryMessages = Messages["history"];

/** Props for the finished workout history feature. */
export type WorkoutHistoryProps = {
  /** Localized copy used by the workout history UI. */
  messages: WorkoutHistoryMessages;

  /** Whether the workout history screen is the currently visible app view. */
  isActive?: boolean;

  /** Repository used to read finished workout sessions. */
  repository?: WorkoutSessionRepository;

  /** Repository used to read exercise names for saved sessions. */
  exerciseStore?: ExerciseRepository;

  /** Called after a workout session has been started from history. */
  onSessionStarted?: () => void;
};

/** Async loading states used by the workout history screen. */
type LoadState = "loading" | "ready" | "error";

/** Formats a message template containing a single count placeholder. */
const formatCountMessage = (template: string, count: number): string => {
  return template.replace("{count}", String(count));
};

/** Formats a number and unit pair for saved set summaries. */
const formatWeightMessage = (template: string, weight: number, unit: string): string => {
  const formattedWeight = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 2,
  }).format(weight);

  return template.replace("{weight}", formattedWeight).replace("{unit}", unit);
};

/** Formats a saved workout title, falling back when the session has no custom name. */
const formatSessionTitle = (name: string | null, messages: WorkoutHistoryMessages): string => {
  return name ?? messages.sessionTitleFallback;
};

/** Formats the finished timestamp used on workout history cards. */
const formatFinishedAt = (finishedAt: string | null, startedAt: string): string => {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(finishedAt ?? startedAt));
};

/** Formats a saved workout duration in whole minutes. */
const formatWorkoutDuration = (
  startedAt: string,
  finishedAt: string | null,
  messages: WorkoutHistoryMessages,
): string => {
  if (!finishedAt) {
    return formatCountMessage(messages.durationMinutePlural, 0);
  }

  const durationMinutes = Math.max(
    1,
    Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 60_000),
  );

  return durationMinutes === 1
    ? messages.durationMinuteSingular
    : formatCountMessage(messages.durationMinutePlural, durationMinutes);
};

/** Formats the exercise count label for a saved workout. */
const formatExerciseCount = (count: number, messages: WorkoutHistoryMessages): string => {
  return count === 1
    ? messages.exerciseCountSingular
    : formatCountMessage(messages.exerciseCountPlural, count);
};

/** Formats the set count label for a saved workout or exercise. */
const formatSetCount = (count: number, messages: WorkoutHistoryMessages): string => {
  if (count === 0) {
    return messages.noSets;
  }

  return count === 1
    ? messages.setCountSingular
    : formatCountMessage(messages.setCountPlural, count);
};

/** Counts all sets logged in a saved workout session. */
const countWorkoutSets = (session: WorkoutSession): number => {
  return session.exercises.reduce((totalSets, exercise) => totalSets + exercise.sets.length, 0);
};

/** Formats the compact metadata line for a saved workout card. */
const formatWorkoutMeta = (session: WorkoutSession, messages: WorkoutHistoryMessages): string => {
  return messages.historyMeta
    .replace("{date}", formatFinishedAt(session.finishedAt, session.startedAt))
    .replace("{duration}", formatWorkoutDuration(session.startedAt, session.finishedAt, messages))
    .replace("{exercises}", formatExerciseCount(session.exercises.length, messages))
    .replace("{sets}", formatSetCount(countWorkoutSets(session), messages));
};

/** Formats a completed set into a compact saved-workout summary. */
const formatLoggedSet = (set: WorkoutSet, messages: WorkoutHistoryMessages): string => {
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

/** Formats a workout toggle label with the target session name. */
const formatWorkoutToggleLabel = (template: string, sessionName: string): string => {
  return template.replace("{name}", sessionName);
};

/** Formats a workout action label with the target session name. */
const formatWorkoutActionLabel = (template: string, sessionName: string): string => {
  return template.replace("{name}", sessionName);
};

/** Creates a default plan name from a finished workout session. */
const createDefaultPlanName = (
  session: WorkoutSession,
  messages: WorkoutHistoryMessages,
): string => {
  const sessionName = session.name?.trim();

  return sessionName && sessionName !== messages.emptyWorkoutName
    ? sessionName
    : messages.saveAsPlanNameFallback;
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

/** Mobile-first screen for reviewing finished workout sessions. */
export const WorkoutHistory = ({
  messages,
  isActive = true,
  repository = workoutSessionRepository,
  exerciseStore = exerciseRepository,
  onSessionStarted,
}: WorkoutHistoryProps) => {
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [openSessionId, setOpenSessionId] = useState<EntityId | null>(null);
  const hasInitializedOpenSessionRef = useRef(false);
  const previousSessionCountRef = useRef(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [repeatingSessionId, setRepeatingSessionId] = useState<EntityId | null>(null);
  const [planSourceSessionId, setPlanSourceSessionId] = useState<EntityId | null>(null);
  const [planName, setPlanName] = useState("");
  const [isSavingPlan, setIsSavingPlan] = useState(false);

  const exerciseById = useMemo(() => {
    return new Map(exercises.map((exercise) => [exercise.id, exercise]));
  }, [exercises]);
  const planSourceSession = useMemo(() => {
    return sessions.find((session) => session.id === planSourceSessionId);
  }, [planSourceSessionId, sessions]);
  const isPlanDialogOpen = planSourceSessionId !== null;
  const pageFeedbackMessage = isPlanDialogOpen ? null : feedbackMessage;
  const planFeedbackMessage = isPlanDialogOpen ? feedbackMessage : null;

  /** Refreshes saved workout sessions and exercise names from IndexedDB. */
  const refreshData = useCallback(async () => {
    try {
      const [nextSessions, nextExercises] = await Promise.all([
        repository.listFinished(50),
        exerciseStore.list(),
      ]);

      const shouldOpenFirstSession =
        !hasInitializedOpenSessionRef.current || previousSessionCountRef.current === 0;

      setSessions(nextSessions);
      setExercises(nextExercises);
      setOpenSessionId((currentOpenSessionId) => {
        if (currentOpenSessionId === null) {
          return shouldOpenFirstSession ? (nextSessions[0]?.id ?? null) : null;
        }

        return nextSessions.some((session) => session.id === currentOpenSessionId)
          ? currentOpenSessionId
          : (nextSessions[0]?.id ?? null);
      });
      hasInitializedOpenSessionRef.current = true;
      previousSessionCountRef.current = nextSessions.length;
      setLoadState("ready");
    } catch {
      setLoadState("error");
      setFeedbackMessage(messages.loadError);
    }
  }, [exerciseStore, messages.loadError, repository]);

  useEffect(() => {
    if (isActive) {
      void refreshData();
    }
  }, [isActive, refreshData]);

  useEffect(() => {
    if (isActive) {
      return;
    }

    setFeedbackMessage(null);
    setIsSavingPlan(false);
    setPlanName("");
    setPlanSourceSessionId(null);
    setRepeatingSessionId(null);
  }, [isActive]);

  /** Toggles a saved workout card between summary and detail states. */
  const toggleSession = (sessionId: EntityId) => {
    setOpenSessionId((currentOpenSessionId) =>
      currentOpenSessionId === sessionId ? null : sessionId,
    );
  };

  /** Starts a fresh active workout from a finished workout in history. */
  const repeatWorkout = async (session: WorkoutSession) => {
    if (session.exercises.length === 0) {
      setFeedbackMessage(messages.repeatError);
      return;
    }

    setRepeatingSessionId(session.id);
    setFeedbackMessage(null);

    try {
      const existingWorkout = await repository.getActive();

      if (existingWorkout) {
        setFeedbackMessage(messages.activeWorkoutExists);
        return;
      }

      const nextSnapshot = await repository.repeatFinished(session.id);

      if (!nextSnapshot) {
        setFeedbackMessage(messages.repeatError);
        return;
      }

      onSessionStarted?.();
    } catch {
      setFeedbackMessage(messages.repeatError);
    } finally {
      setRepeatingSessionId(null);
    }
  };

  /** Opens the save-as-plan dialog with a useful default name. */
  const openSavePlanDialog = (session: WorkoutSession) => {
    if (session.exercises.length === 0) {
      setFeedbackMessage(messages.savePlanError);
      return;
    }

    setFeedbackMessage(null);
    setPlanName(createDefaultPlanName(session, messages));
    setPlanSourceSessionId(session.id);
  };

  /** Closes the save-as-plan dialog and clears transient form state. */
  const closeSavePlanDialog = () => {
    setFeedbackMessage(null);
    setPlanName("");
    setPlanSourceSessionId(null);
  };

  /** Updates the controlled save-as-plan dialog state. */
  const updateSavePlanDialog = (isOpen: boolean) => {
    if (isOpen) {
      return;
    }

    closeSavePlanDialog();
  };

  /** Saves the selected finished workout as a reusable workout plan. */
  const saveWorkoutAsPlan = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!planSourceSession || planSourceSession.exercises.length === 0) {
      setFeedbackMessage(messages.savePlanError);
      return;
    }

    const name = planName.trim();

    if (name.length === 0) {
      setFeedbackMessage(messages.validationPlanNameRequired);
      return;
    }

    setIsSavingPlan(true);
    setFeedbackMessage(null);

    try {
      const workoutTemplate = await repository.createTemplateFromFinished(planSourceSession.id, {
        name,
      });

      if (!workoutTemplate) {
        setFeedbackMessage(messages.savePlanError);
        return;
      }

      setPlanName("");
      setPlanSourceSessionId(null);
      setFeedbackMessage(messages.planSavedSuccess);
    } catch {
      setFeedbackMessage(messages.savePlanError);
    } finally {
      setIsSavingPlan(false);
    }
  };

  return (
    <section className={styles.root} aria-labelledby="workout-history-title">
      <header className={styles.header}>
        <div className={styles.headerText}>
          <p className={styles.eyebrow}>{messages.eyebrow}</p>
          <h1 className={styles.title} id="workout-history-title">
            {messages.title}
          </h1>
          <p className={styles.description}>{messages.description}</p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.countBadge} aria-label={messages.totalLabel}>
            <span className={styles.countValue}>{sessions.length}</span>
            <span className={styles.countLabel}>{messages.totalLabel}</span>
          </div>
        </div>
      </header>

      {pageFeedbackMessage ? <p className={styles.feedback}>{pageFeedbackMessage}</p> : null}

      {loadState === "loading" ? (
        <div className={styles.emptyState}>
          <History className={styles.emptyIcon} aria-hidden="true" />
          <h2 className={styles.emptyTitle}>{messages.loadingTitle}</h2>
          <p className={styles.emptyDescription}>{messages.loadingDescription}</p>
        </div>
      ) : null}

      {loadState === "ready" && sessions.length === 0 ? (
        <div className={styles.emptyState}>
          <History className={styles.emptyIcon} aria-hidden="true" />
          <h2 className={styles.emptyTitle}>{messages.emptyTitle}</h2>
          <p className={styles.emptyDescription}>{messages.emptyDescription}</p>
        </div>
      ) : null}

      {loadState === "ready" && sessions.length > 0 ? (
        <ul className={styles.sessionList}>
          {sessions.map((session) => {
            const sessionName = formatSessionTitle(session.name, messages);
            const isOpen = openSessionId === session.id;
            const sessionExercises = sortSessionExercises(session.exercises);

            return (
              <li className={styles.sessionCard} key={session.id}>
                <button
                  className={styles.sessionToggle}
                  type="button"
                  aria-expanded={isOpen}
                  aria-label={formatWorkoutToggleLabel(
                    isOpen ? messages.collapseWorkoutAriaLabel : messages.expandWorkoutAriaLabel,
                    sessionName,
                  )}
                  onClick={() => toggleSession(session.id)}
                >
                  <span className={styles.sessionHeading}>
                    <span className={styles.sessionName}>{sessionName}</span>
                    <span className={styles.sessionMeta}>
                      {formatWorkoutMeta(session, messages)}
                    </span>
                  </span>
                  <ChevronDown className={styles.chevron({ open: isOpen })} aria-hidden="true" />
                </button>

                {isOpen ? (
                  <div className={styles.sessionDetails}>
                    <div className={styles.sessionActions}>
                      <button
                        aria-label={formatWorkoutActionLabel(
                          messages.repeatWorkoutAriaLabel,
                          sessionName,
                        )}
                        className={styles.button({ variant: "primary" })}
                        type="button"
                        disabled={
                          session.exercises.length === 0 || repeatingSessionId === session.id
                        }
                        onClick={() => void repeatWorkout(session)}
                      >
                        <RotateCcw className={styles.icon} aria-hidden="true" />
                        <span>
                          {repeatingSessionId === session.id
                            ? messages.repeatingAction
                            : messages.repeatAction}
                        </span>
                      </button>
                      <button
                        aria-label={formatWorkoutActionLabel(
                          messages.saveWorkoutAsPlanAriaLabel,
                          sessionName,
                        )}
                        className={styles.button({ variant: "secondary" })}
                        type="button"
                        disabled={session.exercises.length === 0 || isSavingPlan}
                        onClick={() => openSavePlanDialog(session)}
                      >
                        <ClipboardList className={styles.icon} aria-hidden="true" />
                        <span>{messages.saveAsPlanAction}</span>
                      </button>
                    </div>

                    {sessionExercises.length === 0 ? (
                      <p className={styles.emptyDetail}>{messages.noExercises}</p>
                    ) : (
                      <ul className={styles.exerciseList}>
                        {sessionExercises.map((sessionExercise) => {
                          const exercise = exerciseById.get(sessionExercise.exerciseId);
                          const sets = sortWorkoutSets(sessionExercise.sets);

                          return (
                            <li className={styles.exerciseCard} key={sessionExercise.exerciseId}>
                              <div className={styles.exerciseHeading}>
                                <h2 className={styles.exerciseName}>
                                  {exercise?.name ?? messages.missingExercise}
                                </h2>
                                <p className={styles.exerciseMeta}>
                                  {formatSetCount(sets.length, messages)}
                                </p>
                              </div>

                              {sets.length === 0 ? (
                                <p className={styles.emptyDetail}>{messages.noExerciseSets}</p>
                              ) : (
                                <ol className={styles.setList}>
                                  {sets.map((set) => (
                                    <li className={styles.setRow} key={set.id}>
                                      {formatLoggedSet(set, messages)}
                                    </li>
                                  ))}
                                </ol>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <Dialog.Root open={isPlanDialogOpen} onOpenChange={updateSavePlanDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.dialogOverlay} />
          <div className={styles.dialogViewport}>
            <Dialog.Content className={styles.dialogContent}>
              <form
                className={styles.formPanel}
                onSubmit={(event) => void saveWorkoutAsPlan(event)}
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

                {planFeedbackMessage ? (
                  <p className={styles.feedback}>{planFeedbackMessage}</p>
                ) : null}

                <label className={styles.field}>
                  <span className={styles.label}>{messages.planNameLabel}</span>
                  <input
                    className={styles.input}
                    value={planName}
                    placeholder={messages.planNamePlaceholder}
                    onChange={(event) => setPlanName(event.currentTarget.value)}
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
    </section>
  );
};
