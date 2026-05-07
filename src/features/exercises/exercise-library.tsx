import { Check, CirclePlus, Dumbbell, Pencil, Trash2, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { styles } from "./exercise-library.styles";
import type { EntityId, Exercise, ExerciseRepository } from "@/db";
import { exerciseRepository } from "@/db";
import type { Messages } from "@/i18n";

/** Message dictionary used by the exercise library feature. */
type ExerciseLibraryMessages = Messages["exercises"];

/** Props for the exercise library feature. */
export type ExerciseLibraryProps = {
  /** Localized copy used by the exercise library UI. */
  messages: ExerciseLibraryMessages;

  /** Repository used to persist exercise records. */
  repository?: ExerciseRepository;
};

/** Editable form state for create and edit exercise flows. */
type ExerciseFormState = {
  /** Exercise name input value. */
  name: string;

  /** Comma-separated muscle group input value. */
  muscleGroups: string;

  /** Equipment input value. */
  equipment: string;

  /** Notes textarea value. */
  notes: string;
};

/** Async loading states used by the exercise library. */
type LoadState = "loading" | "ready" | "error";

/** Creates an empty exercise form state. */
const createEmptyFormState = (): ExerciseFormState => {
  return {
    name: "",
    muscleGroups: "",
    equipment: "",
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
  return muscleGroups.join(", ");
};

/** Converts a persisted exercise into editable form state. */
const toFormState = (exercise: Exercise): ExerciseFormState => {
  return {
    name: exercise.name,
    muscleGroups: formatMuscleGroups(exercise.muscleGroups),
    equipment: exercise.equipment ?? "",
    notes: exercise.notes ?? "",
  };
};

/** Converts form state into create repository input. */
const toCreateInput = (formState: ExerciseFormState) => {
  return {
    name: formState.name.trim(),
    muscleGroups: parseMuscleGroups(formState.muscleGroups),
    equipment: formState.equipment.trim() || null,
    notes: formState.notes.trim() || null,
  };
};

/** Formats an exercise action label with the target exercise name. */
const formatExerciseActionLabel = (template: string, exerciseName: string): string => {
  return template.replace("{name}", exerciseName);
};

/** Root exercise library feature with create, edit, list, and delete flows. */
export const ExerciseLibrary = ({
  messages,
  repository = exerciseRepository,
}: ExerciseLibraryProps) => {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [formState, setFormState] = useState<ExerciseFormState>(createEmptyFormState);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingExerciseId, setEditingExerciseId] = useState<EntityId | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<EntityId | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const editingExercise = useMemo(() => {
    return exercises.find((exercise) => exercise.id === editingExerciseId);
  }, [editingExerciseId, exercises]);

  const isEditing = editingExerciseId !== null;
  const canSubmit = formState.name.trim().length > 0;

  /** Refreshes the local exercise list from IndexedDB. */
  const refreshExercises = useCallback(async () => {
    try {
      setExercises(await repository.list());
      setLoadState("ready");
    } catch {
      setLoadState("error");
      setFeedbackMessage(messages.loadError);
    }
  }, [messages.loadError, repository]);

  useEffect(() => {
    void refreshExercises();
  }, [refreshExercises]);

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

  /** Updates one field in the exercise form state. */
  const updateFormField = (field: keyof ExerciseFormState, value: string) => {
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

      await refreshExercises();
      closeForm();
    } catch {
      setFeedbackMessage(messages.saveError);
    }
  };

  /** Requests delete confirmation for the selected exercise. */
  const requestDelete = (exerciseId: EntityId) => {
    setPendingDeleteId(exerciseId);
    setFeedbackMessage(null);
  };

  /** Deletes the exercise currently awaiting confirmation. */
  const confirmDelete = async () => {
    if (!pendingDeleteId) {
      return;
    }

    try {
      await repository.deleteById(pendingDeleteId);
      setPendingDeleteId(null);
      await refreshExercises();
    } catch {
      setFeedbackMessage(messages.deleteError);
    }
  };

  /** Cancels the pending delete confirmation. */
  const cancelDelete = () => {
    setPendingDeleteId(null);
  };

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

      {feedbackMessage ? <p className={styles.feedback}>{feedbackMessage}</p> : null}

      {isFormOpen ? (
        <form className={styles.formPanel} onSubmit={saveExercise}>
          <div className={styles.formHeader}>
            <h2 className={styles.formTitle}>
              {isEditing ? messages.formEditTitle : messages.formCreateTitle}
            </h2>
            <button
              className={styles.iconButton({ variant: "ghost" })}
              type="button"
              onClick={closeForm}
            >
              <X className={styles.icon} aria-hidden="true" />
              <span className={styles.visuallyHidden}>{messages.cancelAction}</span>
            </button>
          </div>

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

          <div className={styles.formActions}>
            <button className={styles.button({ variant: "primary" })} type="submit">
              <Check className={styles.icon} aria-hidden="true" />
              <span>{isEditing ? messages.saveEditAction : messages.saveCreateAction}</span>
            </button>
            <button
              className={styles.button({ variant: "secondary" })}
              type="button"
              onClick={closeForm}
            >
              {messages.cancelAction}
            </button>
          </div>
        </form>
      ) : null}

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
              <div className={styles.exerciseContent}>
                <div className={styles.exerciseHeading}>
                  <h2 className={styles.exerciseName}>{exercise.name}</h2>
                  <p className={styles.equipment}>{exercise.equipment ?? messages.noEquipment}</p>
                </div>

                <div className={styles.muscleGroups}>
                  {exercise.muscleGroups.length > 0 ? (
                    exercise.muscleGroups.map((muscleGroup) => (
                      <span className={styles.muscleGroup} key={muscleGroup}>
                        {muscleGroup}
                      </span>
                    ))
                  ) : (
                    <span className={styles.muscleGroupMuted}>{messages.noMuscleGroups}</span>
                  )}
                </div>

                {exercise.notes ? <p className={styles.notes}>{exercise.notes}</p> : null}
              </div>

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
                <button
                  aria-label={formatExerciseActionLabel(
                    messages.deleteExerciseAriaLabel,
                    exercise.name,
                  )}
                  className={styles.iconButton({ variant: "danger" })}
                  type="button"
                  onClick={() => requestDelete(exercise.id)}
                >
                  <Trash2 className={styles.icon} aria-hidden="true" />
                </button>
              </div>

              {pendingDeleteId === exercise.id ? (
                <div className={styles.deletePanel}>
                  <div>
                    <h3 className={styles.deleteTitle}>{messages.deleteConfirmTitle}</h3>
                    <p className={styles.deleteDescription}>
                      <strong>{exercise.name}</strong>
                      <span>{messages.deleteConfirmDescription}</span>
                    </p>
                  </div>
                  <div className={styles.deleteActions}>
                    <button
                      className={styles.button({ variant: "danger" })}
                      type="button"
                      onClick={confirmDelete}
                    >
                      <Trash2 className={styles.icon} aria-hidden="true" />
                      <span>{messages.deleteConfirmAction}</span>
                    </button>
                    <button
                      className={styles.button({ variant: "secondary" })}
                      type="button"
                      onClick={cancelDelete}
                    >
                      {messages.deleteCancelAction}
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};
