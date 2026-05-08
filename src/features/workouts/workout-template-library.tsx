import * as Dialog from "@radix-ui/react-dialog";
import { Check, CirclePlus, ClipboardList, Pencil, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { styles } from "./workout-template-library.styles";
import type {
  EntityId,
  Exercise,
  ExerciseRepository,
  WorkoutTemplate,
  WorkoutTemplateExercise,
  WorkoutTemplateRepository,
} from "@/db";
import { exerciseRepository, workoutTemplateRepository } from "@/db";
import type { Messages } from "@/i18n";

/** Message dictionary used by the workout template feature. */
type WorkoutTemplateLibraryMessages = Messages["workouts"];

/** Props for the workout template library feature. */
export type WorkoutTemplateLibraryProps = {
  /** Localized copy used by the workout template UI. */
  messages: WorkoutTemplateLibraryMessages;

  /** Repository used to persist workout template records. */
  templateRepository?: WorkoutTemplateRepository;

  /** Repository used to read selectable exercise records. */
  exerciseStore?: ExerciseRepository;
};

/** Editable exercise planning state for a template entry. */
type TemplateExerciseFormState = {
  /** Selected exercise identifier. */
  exerciseId: EntityId;

  /** Target set count input value. */
  targetSets: string;

  /** Rest duration input value in seconds. */
  restSeconds: string;
};

/** Editable form state for create and edit workout template flows. */
type TemplateFormState = {
  /** Workout template name input value. */
  name: string;

  /** Selected exercise entries and planning fields. */
  exercises: TemplateExerciseFormState[];
};

/** Async loading states used by the workout template library. */
type LoadState = "loading" | "ready" | "error";

/** Numeric exercise planning fields editable in the template form. */
type TemplateExerciseNumberField = "restSeconds" | "targetSets";

/** Creates an empty workout template form state. */
const createEmptyFormState = (): TemplateFormState => {
  return {
    name: "",
    exercises: [],
  };
};

/** Formats a nullable integer for a controlled number input. */
const formatOptionalInteger = (value: number | null): string => {
  return value === null ? "" : String(value);
};

/** Converts a controlled number input into the nullable positive integer shape stored locally. */
const toOptionalPositiveInteger = (value: string): number | null => {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return null;
  }

  const numericValue = Number(trimmedValue);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  return Math.trunc(numericValue);
};

/** Converts a controlled number input into the nullable non-negative integer shape stored locally. */
const toOptionalNonNegativeInteger = (value: string): number | null => {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return null;
  }

  const numericValue = Number(trimmedValue);

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return null;
  }

  return Math.trunc(numericValue);
};

/** Converts a persisted template into editable form state. */
const toFormState = (template: WorkoutTemplate): TemplateFormState => {
  return {
    name: template.name,
    exercises: [...template.exercises]
      .sort((firstExercise, secondExercise) => firstExercise.order - secondExercise.order)
      .map((exercise) => ({
        exerciseId: exercise.exerciseId,
        targetSets: formatOptionalInteger(exercise.targetSets),
        restSeconds: formatOptionalInteger(exercise.restSeconds),
      })),
  };
};

/** Converts form state into ordered workout template exercise entries. */
const toTemplateExercises = (formState: TemplateFormState): WorkoutTemplateExercise[] => {
  return formState.exercises.map((exercise, order) => ({
    exerciseId: exercise.exerciseId,
    order,
    targetSets: toOptionalPositiveInteger(exercise.targetSets),
    restSeconds: toOptionalNonNegativeInteger(exercise.restSeconds),
    notes: null,
  }));
};

/** Formats a workout template action label with the target template name. */
const formatTemplateActionLabel = (template: string, templateName: string): string => {
  return template.replace("{name}", templateName);
};

/** Formats a count of exercises for a workout template card. */
const formatExerciseCount = (count: number, messages: WorkoutTemplateLibraryMessages): string => {
  return count === 1
    ? messages.exerciseCountSingular
    : messages.exerciseCountPlural.replace("{count}", String(count));
};

/** Formats planned sets and rest duration for a template exercise. */
const formatExercisePlan = (
  exercise: WorkoutTemplateExercise,
  messages: WorkoutTemplateLibraryMessages,
): string => {
  const setText =
    exercise.targetSets === null
      ? messages.noTargetSets
      : messages.targetSetCount.replace("{count}", String(exercise.targetSets));
  const restText =
    exercise.restSeconds === null
      ? messages.noRest
      : messages.restSecondsCount.replace("{seconds}", String(exercise.restSeconds));

  return `${setText} · ${restText}`;
};

/** Root workout template feature with list, create, and edit flows. */
export const WorkoutTemplateLibrary = ({
  messages,
  templateRepository = workoutTemplateRepository,
  exerciseStore = exerciseRepository,
}: WorkoutTemplateLibraryProps) => {
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [formState, setFormState] = useState<TemplateFormState>(createEmptyFormState);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<EntityId | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);

  const editingTemplate = useMemo(() => {
    return templates.find((template) => template.id === editingTemplateId);
  }, [editingTemplateId, templates]);

  const exerciseById = useMemo(() => {
    return new Map(exercises.map((exercise) => [exercise.id, exercise]));
  }, [exercises]);

  const selectedExerciseById = useMemo(() => {
    return new Map(formState.exercises.map((exercise) => [exercise.exerciseId, exercise]));
  }, [formState.exercises]);

  const isEditing = editingTemplateId !== null;
  const canOpenForm = exercises.length > 0;
  const canSubmit = formState.name.trim().length > 0 && formState.exercises.length > 0;
  const formFeedbackMessage = isFormOpen ? feedbackMessage : null;
  const pageFeedbackMessage = isFormOpen ? null : feedbackMessage;

  /** Refreshes templates and selectable exercises from IndexedDB. */
  const refreshData = useCallback(async () => {
    try {
      const [nextTemplates, nextExercises] = await Promise.all([
        templateRepository.list(),
        exerciseStore.list(),
      ]);

      setTemplates(nextTemplates);
      setExercises(nextExercises);
      setLoadState("ready");
    } catch {
      setLoadState("error");
      setFeedbackMessage(messages.loadError);
    }
  }, [exerciseStore, messages.loadError, templateRepository]);

  useEffect(() => {
    void refreshData();
  }, [refreshData]);

  /** Opens the form in create mode. */
  const openCreateForm = () => {
    if (!canOpenForm) {
      setFeedbackMessage(messages.validationExercisesRequired);
      return;
    }

    setFormState(createEmptyFormState());
    setEditingTemplateId(null);
    setFeedbackMessage(null);
    setIsFormOpen(true);
  };

  /** Opens the form in edit mode for an existing workout template. */
  const openEditForm = (template: WorkoutTemplate) => {
    setFormState(toFormState(template));
    setEditingTemplateId(template.id);
    setFeedbackMessage(null);
    setIsFormOpen(true);
  };

  /** Closes the form and clears unsaved form state. */
  const closeForm = () => {
    setFormState(createEmptyFormState());
    setEditingTemplateId(null);
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

  /** Updates the workout template name field. */
  const updateTemplateName = (name: string) => {
    setFormState((currentFormState) => ({
      ...currentFormState,
      name,
    }));
  };

  /** Toggles an exercise in the current workout template form. */
  const toggleExercise = (exerciseId: EntityId, isSelected: boolean) => {
    setFormState((currentFormState) => {
      if (!isSelected) {
        return {
          ...currentFormState,
          exercises: currentFormState.exercises.filter(
            (exercise) => exercise.exerciseId !== exerciseId,
          ),
        };
      }

      if (currentFormState.exercises.some((exercise) => exercise.exerciseId === exerciseId)) {
        return currentFormState;
      }

      return {
        ...currentFormState,
        exercises: [
          ...currentFormState.exercises,
          {
            exerciseId,
            targetSets: "3",
            restSeconds: "120",
          },
        ],
      };
    });
  };

  /** Updates one planning field for a selected exercise. */
  const updateExercisePlanField = (
    exerciseId: EntityId,
    field: TemplateExerciseNumberField,
    value: string,
  ) => {
    setFormState((currentFormState) => ({
      ...currentFormState,
      exercises: currentFormState.exercises.map((exercise) =>
        exercise.exerciseId === exerciseId
          ? {
              ...exercise,
              [field]: value,
            }
          : exercise,
      ),
    }));
  };

  /** Saves a new or edited workout template from the current form state. */
  const saveTemplate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (formState.name.trim().length === 0) {
      setFeedbackMessage(messages.validationNameRequired);
      return;
    }

    if (formState.exercises.length === 0) {
      setFeedbackMessage(messages.validationExercisesRequired);
      return;
    }

    try {
      const input = {
        name: formState.name.trim(),
        exercises: toTemplateExercises(formState),
      };

      if (isEditing) {
        if (!editingTemplate) {
          setFeedbackMessage(messages.saveError);
          return;
        }

        await templateRepository.update(editingTemplate.id, input);
      } else {
        await templateRepository.create(input);
      }

      await refreshData();
      closeForm();
    } catch {
      setFeedbackMessage(messages.saveError);
    }
  };

  return (
    <section className={styles.root} aria-labelledby="workout-template-library-title">
      <header className={styles.header}>
        <div className={styles.headerText}>
          <p className={styles.eyebrow}>{messages.eyebrow}</p>
          <h1 className={styles.title} id="workout-template-library-title">
            {messages.title}
          </h1>
          <p className={styles.description}>{messages.description}</p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.countBadge} aria-label={messages.totalLabel}>
            <span className={styles.countValue}>{templates.length}</span>
            <span className={styles.countLabel}>{messages.totalLabel}</span>
          </div>
          <button
            className={styles.button({ variant: "primary" })}
            type="button"
            disabled={!canOpenForm}
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
              <form className={styles.formPanel} onSubmit={saveTemplate}>
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
                    onChange={(event) => updateTemplateName(event.currentTarget.value)}
                  />
                </label>

                <div className={styles.exercisePicker}>
                  <h3 className={styles.sectionTitle}>{messages.exercisesSectionTitle}</h3>
                  <ul className={styles.exerciseOptionList}>
                    {exercises.map((exercise) => {
                      const selectedExercise = selectedExerciseById.get(exercise.id);
                      const isSelected = selectedExercise !== undefined;

                      return (
                        <li
                          className={styles.exerciseOption({ selected: isSelected })}
                          key={exercise.id}
                        >
                          <label className={styles.checkboxRow}>
                            <input
                              className={styles.checkbox}
                              type="checkbox"
                              checked={isSelected}
                              onChange={(event) =>
                                toggleExercise(exercise.id, event.currentTarget.checked)
                              }
                            />
                            <span className={styles.exerciseSummary}>
                              <span className={styles.exerciseName}>{exercise.name}</span>
                              <span className={styles.exerciseMeta}>
                                {exercise.equipment ?? messages.noEquipment}
                              </span>
                            </span>
                          </label>

                          {selectedExercise ? (
                            <div className={styles.planFields}>
                              <label className={styles.compactField}>
                                <span className={styles.label}>{messages.targetSetsLabel}</span>
                                <input
                                  className={styles.input}
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={selectedExercise.targetSets}
                                  onChange={(event) =>
                                    updateExercisePlanField(
                                      exercise.id,
                                      "targetSets",
                                      event.currentTarget.value,
                                    )
                                  }
                                />
                              </label>
                              <label className={styles.compactField}>
                                <span className={styles.label}>{messages.restSecondsLabel}</span>
                                <input
                                  className={styles.input}
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  value={selectedExercise.restSeconds}
                                  onChange={(event) =>
                                    updateExercisePlanField(
                                      exercise.id,
                                      "restSeconds",
                                      event.currentTarget.value,
                                    )
                                  }
                                />
                              </label>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>

                <div className={styles.formActions}>
                  <button
                    className={styles.button({ variant: "primary" })}
                    type="submit"
                    disabled={!canSubmit}
                  >
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
          <ClipboardList className={styles.emptyIcon} aria-hidden="true" />
          <h2 className={styles.emptyTitle}>{messages.noExercisesTitle}</h2>
          <p className={styles.emptyDescription}>{messages.noExercisesDescription}</p>
        </div>
      ) : null}

      {loadState === "ready" && exercises.length > 0 && templates.length === 0 ? (
        <div className={styles.emptyState}>
          <ClipboardList className={styles.emptyIcon} aria-hidden="true" />
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

      {loadState === "ready" && templates.length > 0 ? (
        <ul className={styles.templateList}>
          {templates.map((template) => (
            <li className={styles.templateCard} key={template.id}>
              <div className={styles.templateContent}>
                <div className={styles.templateHeading}>
                  <h2 className={styles.templateName}>{template.name}</h2>
                  <p className={styles.exerciseCount}>
                    {formatExerciseCount(template.exercises.length, messages)}
                  </p>
                </div>

                <ul className={styles.templateExerciseList}>
                  {[...template.exercises]
                    .sort(
                      (firstExercise, secondExercise) => firstExercise.order - secondExercise.order,
                    )
                    .map((templateExercise) => {
                      const exercise = exerciseById.get(templateExercise.exerciseId);

                      return (
                        <li
                          className={styles.templateExercise}
                          key={`${template.id}-${templateExercise.exerciseId}`}
                        >
                          <span className={styles.templateExerciseName}>
                            {exercise?.name ?? messages.missingExercise}
                          </span>
                          <span className={styles.templateExercisePlan}>
                            {formatExercisePlan(templateExercise, messages)}
                          </span>
                        </li>
                      );
                    })}
                </ul>
              </div>

              <div className={styles.cardActions}>
                <button
                  aria-label={formatTemplateActionLabel(
                    messages.editTemplateAriaLabel,
                    template.name,
                  )}
                  className={styles.iconButton({ variant: "secondary" })}
                  type="button"
                  onClick={() => openEditForm(template)}
                >
                  <Pencil className={styles.icon} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
};
