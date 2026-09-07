import {
  ChevronRight,
  CirclePlus,
  ClipboardList,
  Copy,
  History,
  MoreHorizontal,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import { styles as controls } from "./workout-plan-controls.styles";
import { PlanConfirmation, PlanDialog } from "./workout-plan-dialog";
import { WorkoutPlanEditor } from "./workout-plan-editor";
import {
  createPlanDraft,
  formatPlanSummary,
  getLastPlanCompletions,
  planMessage,
  toPlanDraft,
  type PlanDraft,
  type PlanMessages,
} from "./workout-plan-utils";
import { styles } from "./workout-template-library.styles";
import {
  createTemplateExerciseBlocks,
  exerciseRepository,
  workoutSessionRepository,
  workoutTemplateRepository,
  type ActiveWorkoutSnapshot,
  type EntityId,
  type Exercise,
  type ExerciseRepository,
  type WorkoutSession,
  type WorkoutSessionRepository,
  type WorkoutTemplate,
  type WorkoutTemplateRepository,
} from "@/db";
import { defaultLocale } from "@/i18n";

/** Props for the local workout plan library. */
export type WorkoutTemplateLibraryProps = {
  /** Localized copy for the plan workflow. */
  messages: PlanMessages;
  /** Locale used to format workout completion dates. */
  locale?: string;
  /** Whether the plan library is currently visible. */
  isActive?: boolean;
  /** Repository used to persist plans. */
  templateRepository?: WorkoutTemplateRepository;
  /** Repository used to read available exercises. */
  exerciseStore?: ExerciseRepository;
  /** Repository used to read history and start sessions. */
  sessionRepository?: WorkoutSessionRepository;
  /** Opens the workout screen after starting or resuming a session. */
  onSessionStarted?: () => void;
  /** Opens the exercise library from empty states. */
  onOpenExercises?: () => void;
};

/** Independent draft retained while navigating to the exercise library. */
type EditorState = {
  /** Initial draft for this editing instance. */
  draft: PlanDraft;
  /** Existing plan to update, or null when creating. */
  templateId: EntityId | null;
};

/** Secondary library panels, separate from the unsaved editor. */
type LibrarySheet =
  | { /** Plan creation or history selection panel. */ kind: "create" | "history" }
  | {
      /** Plan-specific detail, action, or confirmation panel. */ kind:
        | "details"
        | "actions"
        | "delete";
      /** Plan being inspected or managed. */ template: WorkoutTemplate;
    };

/** Compact plan library with reusable drafts, history shortcuts, and active-workout recovery. */
export const WorkoutTemplateLibrary = ({
  messages,
  locale = defaultLocale,
  isActive = true,
  templateRepository = workoutTemplateRepository,
  exerciseStore = exerciseRepository,
  sessionRepository = workoutSessionRepository,
  onSessionStarted,
  onOpenExercises,
}: WorkoutTemplateLibraryProps) => {
  const libraryId = useId();
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [activeWorkout, setActiveWorkout] = useState<ActiveWorkoutSnapshot | undefined>();
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [sheet, setSheet] = useState<LibrarySheet | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<EntityId | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const actionInFlight = useRef(false);
  const loadSequence = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const isSwitchingDialog = useRef(false);
  const addPlanButton = useRef<HTMLButtonElement>(null);
  const exerciseById = useMemo(
    () => new Map(exercises.map((exercise) => [exercise.id, exercise])),
    [exercises],
  );
  const lastCompletions = useMemo(() => getLastPlanCompletions(sessions), [sessions]);
  const dateFormatter = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium" }),
    [locale],
  );
  const reusableSessions = useMemo(
    () =>
      sessions
        .filter((session) => session.exercises.length > 0)
        .sort(
          (first, second) =>
            Date.parse(second.finishedAt ?? second.startedAt) -
            Date.parse(first.finishedAt ?? first.startedAt),
        ),
    [sessions],
  );

  /** Refreshes library records and workout context without accepting stale requests. */
  const refreshData = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const [nextTemplates, nextExercises, nextSessions, nextActive] = await Promise.all([
        templateRepository.list(),
        exerciseStore.list(),
        sessionRepository.listFinished(),
        sessionRepository.getActive(),
      ]);
      if (sequence !== loadSequence.current) return;
      setTemplates(nextTemplates);
      setExercises(nextExercises);
      setSessions(nextSessions);
      setActiveWorkout(nextActive);
      setLoadState("ready");
    } catch {
      if (sequence === loadSequence.current) setLoadState("error");
    }
  }, [exerciseStore, sessionRepository, templateRepository]);

  useEffect(() => {
    if (isActive) void refreshData();
    return () => {
      loadSequence.current += 1;
    };
  }, [isActive, refreshData]);

  /** Opens a secondary panel and remembers the initiating action for focus restoration. */
  const openSheet = (next: LibrarySheet, trigger: HTMLElement) => {
    returnFocus.current = trigger;
    isSwitchingDialog.current = false;
    setFeedback(null);
    setDeleteError(null);
    setSheet(next);
  };

  /** Opens an independent draft without persisting a copy until the user saves. */
  const beginEditor = (draft: PlanDraft, templateId: EntityId | null = null) => {
    isSwitchingDialog.current = true;
    setSheet(null);
    setFeedback(null);
    setEditor({ draft, templateId });
  };

  /** Updates the list directly after saving so a refresh failure cannot cause duplicate creation. */
  const handleSaved = (template: WorkoutTemplate) => {
    loadSequence.current += 1;
    setLoadState("ready");
    setTemplates((current) =>
      [...current.filter((value) => value.id !== template.id), template].sort((first, second) =>
        first.name.localeCompare(second.name),
      ),
    );
    setEditor(null);
    setFeedback(messages.savedSuccess);
  };

  /** Avoids returning focus to the library while a replacement dialog is opening. */
  const getSheetReturnFocus = () => (isSwitchingDialog.current ? null : returnFocus.current);

  /** Starts one plan at a time, retaining a route back to an existing active session. */
  const startPlan = async (template: WorkoutTemplate) => {
    if (actionInFlight.current) return;
    if (
      template.exercises.length === 0 ||
      template.exercises.some((exercise) => !exerciseById.has(exercise.exerciseId))
    ) {
      setFeedback(messages.validationMissingExercises);
      setSheet(null);
      return;
    }
    actionInFlight.current = true;
    setStartingId(template.id);
    setFeedback(null);
    try {
      const existing = await sessionRepository.getActive();
      if (existing) {
        setActiveWorkout(existing);
        setSheet(null);
        if (existing.session.templateId === template.id) onSessionStarted?.();
        else setFeedback(messages.activeWorkoutExists);
        return;
      }
      const started = await sessionRepository.startFromTemplate(template.id);
      if (!started) {
        setFeedback(messages.startError);
        setSheet(null);
        return;
      }
      setActiveWorkout(started);
      setSheet(null);
      if (started.session.templateId === template.id) onSessionStarted?.();
      else setFeedback(messages.activeWorkoutExists);
    } catch {
      setFeedback(messages.startError);
      setSheet(null);
    } finally {
      actionInFlight.current = false;
      setStartingId(null);
    }
  };

  /** Deletes only after confirmation, preserving the dialog and error on failure. */
  const deletePlan = async (template: WorkoutTemplate) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await templateRepository.deleteById(template.id);
      loadSequence.current += 1;
      setTemplates((current) => current.filter((value) => value.id !== template.id));
      setSheet(null);
      returnFocus.current = addPlanButton.current;
      setFeedback(messages.deletedSuccess);
    } catch {
      setDeleteError(messages.deleteError);
    } finally {
      actionInFlight.current = false;
      setIsDeleting(false);
    }
  };

  /** Formats only valid dates, including imported histories with incomplete timestamps. */
  const formatDate = (timestamp: string): string =>
    Number.isFinite(Date.parse(timestamp))
      ? dateFormatter.format(new Date(timestamp))
      : messages.unknownDate;

  /** Formats the latest completion for a plan, independent of its last edit time. */
  const lastCompletedLabel = (template: WorkoutTemplate): string => {
    const timestamp = lastCompletions.get(template.id);
    return timestamp
      ? planMessage(messages.lastCompleted, { date: formatDate(timestamp) })
      : messages.neverCompleted;
  };

  /** Checks whether a saved plan can start with the current local exercise library. */
  const isStartUnavailable = (template: WorkoutTemplate): boolean =>
    startingId !== null ||
    Boolean(activeWorkout) ||
    template.exercises.length === 0 ||
    template.exercises.some((exercise) => !exerciseById.has(exercise.exerciseId));

  /** Creates a short preview of the first exercises in actual workout order. */
  const preview = (template: WorkoutTemplate): string => {
    const names = [...template.exercises]
      .sort((first, second) => first.order - second.order)
      .slice(0, 2)
      .map((exercise) => exerciseById.get(exercise.exerciseId)?.name ?? messages.missingExercise)
      .join(", ");
    return template.exercises.length > 2
      ? planMessage(messages.previewMore, { names, count: template.exercises.length - 2 })
      : names;
  };

  const selectedTemplate = sheet && "template" in sheet ? sheet.template : null;
  const sheetTitle =
    sheet?.kind === "create"
      ? messages.formCreateTitle
      : sheet?.kind === "history"
        ? messages.fromHistoryAction
        : (selectedTemplate?.name ?? messages.title);

  return (
    <section className={styles.root} aria-labelledby="workout-template-library-title">
      <header className={styles.header}>
        <div className={styles.headerText}>
          <p className={styles.eyebrow}>{messages.eyebrow}</p>
          <h1 className={styles.title} id="workout-template-library-title">
            {messages.title}
          </h1>
          <p className={controls.muted}>{messages.description}</p>
        </div>
        <button
          ref={addPlanButton}
          className={controls.button({ variant: "primary" })}
          type="button"
          disabled={loadState !== "ready"}
          onClick={(event) => openSheet({ kind: "create" }, event.currentTarget)}
        >
          <CirclePlus className={controls.icon} aria-hidden="true" />
          {messages.addAction}
        </button>
      </header>

      {feedback ? (
        <p className={controls.feedback} role="status">
          {feedback}
        </p>
      ) : null}
      {loadState === "loading" ? (
        <p className={controls.muted} role="status">
          {messages.loadingLabel}
        </p>
      ) : null}
      {loadState === "error" ? (
        <div className={styles.emptyState}>
          <p className={controls.feedback} role="alert">
            {messages.loadError}
          </p>
          <button
            className={controls.button()}
            type="button"
            onClick={() => {
              setLoadState("loading");
              void refreshData();
            }}
          >
            {messages.retryAction}
          </button>
        </div>
      ) : null}
      {loadState === "ready" && activeWorkout ? (
        <div className={styles.resumeBanner}>
          <div>
            <p className={styles.sectionTitle}>{messages.activeWorkoutTitle}</p>
            <p className={controls.muted}>
              {activeWorkout.session.name ?? messages.unnamedWorkout}
            </p>
          </div>
          <button
            className={controls.button({ variant: "primary" })}
            type="button"
            onClick={onSessionStarted}
          >
            <Play className={controls.icon} aria-hidden="true" />
            {messages.resumeAction}
          </button>
        </div>
      ) : null}
      {loadState === "ready" && templates.length === 0 ? (
        <div className={styles.emptyState}>
          <ClipboardList className={styles.emptyIcon} aria-hidden="true" />
          <h2 className={styles.sectionTitle}>{messages.emptyTitle}</h2>
          <p className={controls.muted}>
            {exercises.length === 0 ? messages.noExercisesDescription : messages.emptyDescription}
          </p>
          <div className={styles.emptyActions}>
            {exercises.length === 0 && onOpenExercises ? (
              <button className={controls.button()} type="button" onClick={onOpenExercises}>
                {messages.addExerciseAction}
              </button>
            ) : null}
            {reusableSessions.length > 0 ? (
              <button
                className={controls.button()}
                type="button"
                onClick={(event) => openSheet({ kind: "history" }, event.currentTarget)}
              >
                <History className={controls.icon} aria-hidden="true" />
                {messages.fromHistoryAction}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {loadState === "ready" && templates.length > 0 ? (
        <>
          <p className={styles.libraryCount}>
            {planMessage(messages.libraryCount, { count: templates.length })}
          </p>
          <ul className={styles.templateList}>
            {templates.map((template, index) => (
              <li className={styles.templateCard} key={template.id}>
                <h2>
                  <button
                    type="button"
                    className={styles.cardOpen}
                    aria-label={planMessage(messages.viewPlanAriaLabel, { name: template.name })}
                    aria-describedby={`${libraryId}-summary-${index} ${libraryId}-preview-${index}`}
                    onClick={(event) =>
                      openSheet({ kind: "details", template }, event.currentTarget)
                    }
                  >
                    <span className={styles.cardHeading}>
                      <span className={styles.templateName}>{template.name}</span>
                      <ChevronRight className={controls.icon} aria-hidden="true" />
                    </span>
                    <span className={styles.summary} id={`${libraryId}-summary-${index}`}>
                      {formatPlanSummary(template.exercises, messages)}
                    </span>
                    <span className={styles.preview} id={`${libraryId}-preview-${index}`}>
                      {preview(template)}
                    </span>
                  </button>
                </h2>
                <div className={styles.cardFooter}>
                  <p className={styles.lastCompleted}>{lastCompletedLabel(template)}</p>
                  <button
                    className={controls.button({ variant: "primary" })}
                    type="button"
                    disabled={isStartUnavailable(template)}
                    aria-label={planMessage(messages.startTemplateAriaLabel, {
                      name: template.name,
                    })}
                    onClick={() => void startPlan(template)}
                  >
                    <Play className={controls.icon} aria-hidden="true" />
                    {startingId === template.id ? messages.startingAction : messages.startAction}
                  </button>
                  <button
                    className={controls.button({ variant: "ghost", square: true })}
                    type="button"
                    aria-label={planMessage(messages.planActionsAriaLabel, { name: template.name })}
                    onClick={(event) =>
                      openSheet({ kind: "actions", template }, event.currentTarget)
                    }
                  >
                    <MoreHorizontal className={controls.icon} aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {sheet && sheet.kind !== "delete" ? (
        <PlanDialog
          open={isActive}
          onOpenChange={(open) => {
            if (!open) setSheet(null);
          }}
          title={sheetTitle}
          description={
            sheet.kind === "history" ? messages.historyDescription : messages.description
          }
          closeLabel={messages.closeAction}
          fullScreen={sheet.kind === "history"}
          getReturnFocus={getSheetReturnFocus}
          footer={
            sheet.kind === "details" && selectedTemplate ? (
              <>
                <button
                  className={controls.button()}
                  type="button"
                  onClick={() =>
                    beginEditor(
                      toPlanDraft(selectedTemplate.name, selectedTemplate.exercises),
                      selectedTemplate.id,
                    )
                  }
                >
                  <Pencil className={controls.icon} aria-hidden="true" />
                  {messages.editAction}
                </button>
                <button
                  className={controls.button({ variant: "primary" })}
                  type="button"
                  disabled={!activeWorkout && isStartUnavailable(selectedTemplate)}
                  onClick={() => {
                    if (activeWorkout) {
                      setSheet(null);
                      onSessionStarted?.();
                    } else {
                      void startPlan(selectedTemplate);
                    }
                  }}
                >
                  <Play className={controls.icon} aria-hidden="true" />
                  {activeWorkout
                    ? messages.resumeAction
                    : startingId === selectedTemplate.id
                      ? messages.startingAction
                      : messages.startAction}
                </button>
              </>
            ) : sheet.kind === "history" ? (
              <button
                className={controls.button()}
                type="button"
                onClick={() => setSheet({ kind: "create" })}
              >
                {messages.backAction}
              </button>
            ) : undefined
          }
        >
          {sheet.kind === "create" ? (
            <div className={styles.actionList}>
              <button
                className={styles.actionButton}
                type="button"
                onClick={() => beginEditor(createPlanDraft())}
              >
                <CirclePlus className={controls.icon} aria-hidden="true" />
                <span>
                  <strong>{messages.fromScratchAction}</strong>
                  <span className={controls.muted}>{messages.fromScratchDescription}</span>
                </span>
                <ChevronRight className={controls.icon} aria-hidden="true" />
              </button>
              <button
                className={styles.actionButton}
                type="button"
                onClick={() => setSheet({ kind: "history" })}
              >
                <History className={controls.icon} aria-hidden="true" />
                <span>
                  <strong>{messages.fromHistoryAction}</strong>
                  <span className={controls.muted}>{messages.historyDescription}</span>
                </span>
                <ChevronRight className={controls.icon} aria-hidden="true" />
              </button>
            </div>
          ) : null}
          {sheet.kind === "history" ? (
            <>
              {reusableSessions.length === 0 ? (
                <p className={controls.muted}>{messages.noHistoryDescription}</p>
              ) : (
                <ul className={styles.actionList}>
                  {reusableSessions.map((session) => (
                    <li key={session.id}>
                      <button
                        className={styles.actionButton}
                        type="button"
                        onClick={() =>
                          beginEditor(
                            toPlanDraft(
                              session.name?.trim() || messages.unnamedWorkout,
                              createTemplateExerciseBlocks(session.exercises),
                            ),
                          )
                        }
                      >
                        <History className={controls.icon} aria-hidden="true" />
                        <span>
                          <strong>{session.name || messages.unnamedWorkout}</strong>
                          <span className={controls.muted}>
                            {planMessage(messages.historyWorkoutMeta, {
                              date: formatDate(session.finishedAt ?? session.startedAt),
                              count: session.exercises.length,
                            })}
                          </span>
                        </span>
                        <ChevronRight className={controls.icon} aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}
          {sheet.kind === "details" && selectedTemplate ? (
            <>
              <p className={controls.muted}>
                {formatPlanSummary(selectedTemplate.exercises, messages)}
              </p>
              <p className={controls.muted}>{lastCompletedLabel(selectedTemplate)}</p>
              {selectedTemplate.exercises.length === 0 ||
              selectedTemplate.exercises.some(
                (exercise) => !exerciseById.has(exercise.exerciseId),
              ) ? (
                <p className={controls.feedback}>{messages.missingExerciseHelp}</p>
              ) : null}
              <ol className={styles.detailList}>
                {[...selectedTemplate.exercises]
                  .sort((first, second) => first.order - second.order)
                  .map((entry, index) => (
                    <li className={styles.detailExercise} key={`${entry.exerciseId}-${index}`}>
                      <span className={styles.exerciseNumber}>{index + 1}</span>
                      <div>
                        <h3 className={styles.sectionTitle}>
                          {exerciseById.get(entry.exerciseId)?.name ?? messages.missingExercise}
                        </h3>
                        <p className={controls.muted}>
                          {planMessage(messages.exercisePlan, {
                            sets:
                              entry.targetSets === null
                                ? messages.noTargetSets
                                : planMessage(messages.targetSetCount, { count: entry.targetSets }),
                            rest:
                              entry.restSeconds === null
                                ? messages.noRest
                                : planMessage(messages.restSecondsCount, {
                                    seconds: entry.restSeconds,
                                  }),
                          })}
                        </p>
                        {entry.notes ? <p className={styles.notes}>{entry.notes}</p> : null}
                      </div>
                    </li>
                  ))}
              </ol>
            </>
          ) : null}
          {sheet.kind === "actions" && selectedTemplate ? (
            <div className={styles.actionList}>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() =>
                  beginEditor(
                    toPlanDraft(selectedTemplate.name, selectedTemplate.exercises),
                    selectedTemplate.id,
                  )
                }
              >
                <Pencil className={controls.icon} aria-hidden="true" />
                {messages.editAction}
              </button>
              <button
                type="button"
                className={styles.actionButton}
                onClick={() =>
                  beginEditor(
                    toPlanDraft(
                      planMessage(messages.duplicateName, { name: selectedTemplate.name }),
                      selectedTemplate.exercises,
                    ),
                  )
                }
              >
                <Copy className={controls.icon} aria-hidden="true" />
                {messages.duplicateAction}
              </button>
              <button
                type="button"
                className={controls.button({ variant: "danger" })}
                onClick={() => {
                  setDeleteError(null);
                  isSwitchingDialog.current = true;
                  setSheet({ kind: "delete", template: selectedTemplate });
                }}
              >
                <Trash2 className={controls.icon} aria-hidden="true" />
                {messages.deleteConfirmAction}
              </button>
            </div>
          ) : null}
        </PlanDialog>
      ) : null}
      {sheet?.kind === "delete" ? (
        <PlanConfirmation
          open={isActive}
          onOpenChange={(open) => {
            if (!open) setSheet(null);
          }}
          title={messages.deleteConfirmTitle}
          description={planMessage(messages.deleteNamedDescription, { name: sheet.template.name })}
          confirmLabel={isDeleting ? messages.deletingAction : messages.deleteConfirmAction}
          cancelLabel={messages.deleteCancelAction}
          onConfirm={() => void deletePlan(sheet.template)}
          busy={isDeleting}
          error={deleteError}
          getReturnFocus={() => returnFocus.current}
        />
      ) : null}
      {editor ? (
        <WorkoutPlanEditor
          initialDraft={editor.draft}
          templateId={editor.templateId}
          isActive={isActive}
          exercises={exercises}
          repository={templateRepository}
          messages={messages}
          onSaved={handleSaved}
          onClose={() => setEditor(null)}
          onOpenExercises={onOpenExercises}
          returnFocus={returnFocus.current}
        />
      ) : null}
    </section>
  );
};
