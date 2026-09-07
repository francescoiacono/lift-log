import { ArrowDown, ArrowUp, Check, CirclePlus, Minus, Plus, X } from "lucide-react";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";

import { WorkoutExercisePicker } from "./workout-exercise-picker";
import { styles as controls } from "./workout-plan-controls.styles";
import { PlanConfirmation, PlanDialog } from "./workout-plan-dialog";
import { styles } from "./workout-plan-editor.styles";
import {
  createPlanDraft,
  movePlanExercise,
  planMessage,
  toPlanExercises,
  validatePlanDraft,
  type PlanDraft,
  type PlanExerciseDraft,
  type PlanMessages,
} from "./workout-plan-utils";
import type { EntityId, Exercise, WorkoutTemplate, WorkoutTemplateRepository } from "@/db";

/** Editing context supplied by the plan library. */
type WorkoutPlanEditorProps = {
  /** Initial independent draft, including copied or historical prescriptions. */
  initialDraft: PlanDraft;
  /** Existing record to update, or null to create a new plan. */
  templateId: EntityId | null;
  /** Whether the Plans screen is visible. */
  isActive: boolean;
  /** Available local exercises. */
  exercises: Exercise[];
  /** Persistence boundary for creating and updating plans. */
  repository: WorkoutTemplateRepository;
  /** Localized editor labels and feedback. */
  messages: PlanMessages;
  /** Receives the persisted record after a successful save. */
  onSaved: (template: WorkoutTemplate) => void;
  /** Discards or closes the draft after any required confirmation. */
  onClose: () => void;
  /** Opens the exercise library while retaining this draft. */
  onOpenExercises?: () => void;
  /** Action to refocus when editing ends. */
  returnFocus: HTMLElement | null;
};

/** Full-page mobile plan editor with ordered prescriptions and guarded draft dismissal. */
export const WorkoutPlanEditor = ({
  initialDraft,
  templateId,
  isActive,
  exercises,
  repository,
  messages,
  onSaved,
  onClose,
  onOpenExercises,
  returnFocus,
}: WorkoutPlanEditorProps) => {
  const [draft, setDraft] = useState(initialDraft);
  const [baseline] = useState(() => JSON.stringify(templateId ? initialDraft : createPlanDraft()));
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isDiscardOpen, setIsDiscardOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const saveInFlight = useRef(false);
  const addButton = useRef<HTMLButtonElement>(null);
  const discardFocus = useRef<HTMLElement | null>(null);
  const formId = useId();
  const dirty = JSON.stringify(draft) !== baseline;
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));

  useEffect(() => {
    if (!dirty) return;
    /** Lets the browser protect unsaved editing work on reload or navigation away. */
    const protectDraft = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [dirty]);

  /** Dismisses a clean editor or asks before discarding unsaved changes. */
  const requestClose = () => {
    if (saveInFlight.current) return;
    if (!dirty) {
      onClose();
      return;
    }
    discardFocus.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIsDiscardOpen(true);
  };

  /** Updates a prescription in place without changing the workout order. */
  const updateExercise = (
    index: number,
    field: keyof Omit<PlanExerciseDraft, "exerciseId">,
    value: string,
  ) => {
    setDraft((current) => ({
      ...current,
      exercises: current.exercises.map((exercise, position) =>
        position === index ? { ...exercise, [field]: value } : exercise,
      ),
    }));
    setError(null);
  };

  /** Applies picker selections while retaining all existing prescriptions and notes. */
  const applySelection = (ids: EntityId[]) => {
    setDraft((current) => {
      const existing = new Map(
        current.exercises.map((exercise) => [exercise.exerciseId, exercise]),
      );
      return {
        ...current,
        exercises: ids.map(
          (exerciseId) =>
            existing.get(exerciseId) ?? {
              exerciseId,
              targetSets: "3",
              restSeconds: "120",
              notes: "",
            },
        ),
      };
    });
    setError(null);
    setIsPickerOpen(false);
  };

  /** Announces each reorder so the resulting sequence is clear without visual feedback. */
  const moveExercise = (index: number, direction: -1 | 1, name: string) => {
    setDraft((current) => movePlanExercise(current, index, direction));
    setAnnouncement(planMessage(messages.movedExercise, { name, position: index + direction + 1 }));
  };

  /** Persists exactly one validated draft and leaves failures available for retry. */
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saveInFlight.current) return;
    const validation = validatePlanDraft(draft, new Set(exerciseById.keys()));
    if (validation) {
      setError(messages[validation]);
      return;
    }
    saveInFlight.current = true;
    setIsSaving(true);
    setError(null);
    try {
      const input = { name: draft.name.trim(), exercises: toPlanExercises(draft) };
      const saved = templateId
        ? await repository.update(templateId, input)
        : await repository.create(input);
      if (!saved) {
        setError(messages.saveError);
        return;
      }
      onSaved(saved);
    } catch {
      setError(messages.saveError);
    } finally {
      saveInFlight.current = false;
      setIsSaving(false);
    }
  };

  return (
    <PlanDialog
      open={isActive}
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
      title={templateId ? messages.formEditTitle : messages.formCreateTitle}
      description={messages.editorDescription}
      closeLabel={messages.closeEditorAction}
      fullScreen
      busy={isSaving}
      returnFocus={returnFocus}
      footer={
        <>
          {error ? (
            <div className={styles.footerError}>
              <p className={controls.feedback} role="alert">
                {error}
              </p>
            </div>
          ) : null}
          <span className={styles.footerHint}>
            {planMessage(messages.selectedCount, { count: draft.exercises.length })}
          </span>
          <button
            className={controls.button({ variant: "primary" })}
            type="submit"
            form={formId}
            disabled={isSaving || !draft.name.trim() || draft.exercises.length === 0}
          >
            <Check className={controls.icon} aria-hidden="true" />
            {isSaving
              ? messages.savingAction
              : templateId
                ? messages.saveEditAction
                : messages.saveCreateAction}
          </button>
        </>
      }
    >
      <form id={formId} onSubmit={(event) => void save(event)} noValidate>
        <fieldset className={styles.form} disabled={isSaving}>
          <label className={controls.field}>
            {messages.nameLabel}
            <input
              className={controls.input}
              value={draft.name}
              placeholder={messages.namePlaceholder}
              onChange={(event) => {
                const name = event.currentTarget.value;
                setDraft((current) => ({ ...current, name }));
                setError(null);
              }}
            />
          </label>
          <div>
            <h2 className={styles.name}>{messages.exercisesSectionTitle}</h2>
            <p className={controls.muted}>{messages.editorDescription}</p>
          </div>
          {draft.exercises.length === 0 ? (
            <p className={controls.muted}>{messages.editorEmptyDescription}</p>
          ) : null}
          <ol className={styles.list}>
            {draft.exercises.map((entry, index) => {
              const exercise = exerciseById.get(entry.exerciseId);
              const name = exercise?.name ?? messages.missingExercise;
              const headingId = `${formId}-exercise-${index}`;
              return (
                <li className={styles.exercise} key={entry.exerciseId} aria-labelledby={headingId}>
                  <div className={styles.heading}>
                    <span className={styles.number} aria-hidden="true">
                      {index + 1}
                    </span>
                    <h3 id={headingId} className={styles.name}>
                      {name}
                    </h3>
                    <button
                      className={controls.button({ variant: "ghost", square: true })}
                      type="button"
                      aria-label={planMessage(messages.removeExercise, { name })}
                      onClick={() => {
                        setDraft((current) => ({
                          ...current,
                          exercises: current.exercises.filter((_, position) => position !== index),
                        }));
                        setError(null);
                      }}
                    >
                      <X className={controls.icon} aria-hidden="true" />
                    </button>
                  </div>
                  {!exercise ? (
                    <p className={controls.feedback}>{messages.missingExerciseHelp}</p>
                  ) : null}
                  <div className={styles.fields}>
                    <div className={controls.field}>
                      <label htmlFor={`${headingId}-sets`}>{messages.targetSetsLabel}</label>
                      <div className={styles.stepper}>
                        <button
                          type="button"
                          className={controls.button({ square: true })}
                          disabled={isSaving || Number(entry.targetSets) <= 1}
                          aria-label={planMessage(messages.decreaseSets, { name })}
                          onClick={() =>
                            updateExercise(
                              index,
                              "targetSets",
                              String(Math.max(1, (Number(entry.targetSets) || 1) - 1)),
                            )
                          }
                        >
                          <Minus className={controls.icon} aria-hidden="true" />
                        </button>
                        <input
                          id={`${headingId}-sets`}
                          className={controls.input}
                          type="text"
                          inputMode="numeric"
                          value={entry.targetSets}
                          aria-label={planMessage(messages.exerciseSetsLabel, { name })}
                          placeholder={messages.optionalTarget}
                          onChange={(event) =>
                            updateExercise(index, "targetSets", event.currentTarget.value)
                          }
                        />
                        <button
                          type="button"
                          className={controls.button({ square: true })}
                          aria-label={planMessage(messages.increaseSets, { name })}
                          onClick={() =>
                            updateExercise(
                              index,
                              "targetSets",
                              String(
                                Math.min(
                                  Number.MAX_SAFE_INTEGER,
                                  (Number(entry.targetSets) || 0) + 1,
                                ),
                              ),
                            )
                          }
                        >
                          <Plus className={controls.icon} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                    <label className={controls.field}>
                      {messages.restSecondsLabel}
                      <input
                        className={controls.input}
                        type="text"
                        inputMode="numeric"
                        value={entry.restSeconds}
                        aria-label={planMessage(messages.exerciseRestLabel, { name })}
                        placeholder={messages.optionalTarget}
                        onChange={(event) =>
                          updateExercise(index, "restSeconds", event.currentTarget.value)
                        }
                      />
                    </label>
                  </div>
                  <div
                    className={styles.presets}
                    role="group"
                    aria-label={planMessage(messages.restPresetsLabel, { name })}
                  >
                    {[60, 90, 120].map((seconds) => (
                      <button
                        className={controls.button()}
                        key={seconds}
                        type="button"
                        aria-pressed={
                          entry.restSeconds.trim() !== "" && Number(entry.restSeconds) === seconds
                        }
                        onClick={() => updateExercise(index, "restSeconds", String(seconds))}
                      >
                        {planMessage(messages.restPreset, { seconds })}
                      </button>
                    ))}
                  </div>
                  <details className={styles.notes}>
                    <summary>
                      {entry.notes ? messages.editNotesAction : messages.addNotesAction}
                    </summary>
                    <label className={controls.field}>
                      {planMessage(messages.exerciseNotesLabel, { name })}
                      <textarea
                        className={controls.input}
                        rows={3}
                        value={entry.notes}
                        placeholder={messages.notesPlaceholder}
                        onChange={(event) =>
                          updateExercise(index, "notes", event.currentTarget.value)
                        }
                      />
                    </label>
                  </details>
                  <div className={styles.moveActions}>
                    <span className={styles.orderHint}>
                      {planMessage(messages.exercisePosition, {
                        position: index + 1,
                        count: draft.exercises.length,
                      })}
                    </span>
                    <button
                      className={controls.button({ square: true })}
                      type="button"
                      disabled={isSaving || index === 0}
                      aria-label={planMessage(messages.moveExerciseUp, { name })}
                      onClick={() => moveExercise(index, -1, name)}
                    >
                      <ArrowUp className={controls.icon} aria-hidden="true" />
                    </button>
                    <button
                      className={controls.button({ square: true })}
                      type="button"
                      disabled={isSaving || index === draft.exercises.length - 1}
                      aria-label={planMessage(messages.moveExerciseDown, { name })}
                      onClick={() => moveExercise(index, 1, name)}
                    >
                      <ArrowDown className={controls.icon} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className={styles.fullButton}>
            <button
              ref={addButton}
              className={controls.button()}
              type="button"
              disabled={exercises.length === 0}
              onClick={() => setIsPickerOpen(true)}
            >
              <CirclePlus className={controls.icon} aria-hidden="true" />
              {messages.addExercisesAction}
            </button>
          </div>
          {exercises.length === 0 && onOpenExercises ? (
            <button className={controls.button()} type="button" onClick={onOpenExercises}>
              {messages.addExerciseAction}
            </button>
          ) : null}
          <p className={controls.hidden} role="status">
            {announcement}
          </p>
        </fieldset>
      </form>
      {isPickerOpen ? (
        <WorkoutExercisePicker
          exercises={exercises}
          selectedIds={draft.exercises.map((exercise) => exercise.exerciseId)}
          messages={messages}
          onConfirm={applySelection}
          onClose={() => setIsPickerOpen(false)}
          returnFocus={addButton.current}
        />
      ) : null}
      <PlanConfirmation
        open={isDiscardOpen}
        onOpenChange={setIsDiscardOpen}
        title={messages.discardTitle}
        description={messages.discardDescription}
        confirmLabel={messages.discardAction}
        cancelLabel={messages.keepEditingAction}
        onConfirm={onClose}
        returnFocus={discardFocus.current}
      />
    </PlanDialog>
  );
};
