import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as Dialog from "@radix-ui/react-dialog";
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
  const formFeedbackMessage = isFormOpen ? feedbackMessage : null;
  const pageFeedbackMessage = isFormOpen ? null : feedbackMessage;

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

  /** Updates the controlled form dialog state. */
  const updateFormDialog = (isOpen: boolean) => {
    if (isOpen) {
      setIsFormOpen(true);
      return;
    }

    closeForm();
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

  /** Updates the controlled delete dialog state for an exercise row. */
  const updateDeleteDialog = (isOpen: boolean, exerciseId: EntityId) => {
    setPendingDeleteId(isOpen ? exerciseId : null);
    setFeedbackMessage(null);
  };

  /** Deletes the confirmed exercise. */
  const confirmDelete = async (exerciseId: EntityId) => {
    try {
      await repository.deleteById(exerciseId);
      setPendingDeleteId(null);
      await refreshExercises();
    } catch {
      setFeedbackMessage(messages.deleteError);
    }
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
