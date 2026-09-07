import { useMemo, useState } from "react";

import { styles } from "./workout-exercise-picker.styles";
import { styles as controls } from "./workout-plan-controls.styles";
import { PlanDialog } from "./workout-plan-dialog";
import { filterPlanExercises, planMessage, type PlanMessages } from "./workout-plan-utils";
import { formatMuscleGroupLabel, type EntityId, type Exercise } from "@/db";

/** Searchable exercise selection, staged independently of the plan draft. */
type WorkoutExercisePickerProps = {
  /** Available exercises from the local repository. */
  exercises: Exercise[];
  /** Exercise identifiers selected when the picker opens. */
  selectedIds: EntityId[];
  /** Localized picker labels. */
  messages: PlanMessages;
  /** Applies the selected exercise identifiers in selection order. */
  onConfirm: (ids: EntityId[]) => void;
  /** Cancels selection changes. */
  onClose: () => void;
  /** Button that opened the picker. */
  returnFocus: HTMLElement | null;
};

/** Lets users search and filter without changing their plan until they confirm. */
export const WorkoutExercisePicker = ({
  exercises,
  selectedIds,
  messages,
  onConfirm,
  onClose,
  returnFocus,
}: WorkoutExercisePickerProps) => {
  const [selection, setSelection] = useState(selectedIds);
  const [query, setQuery] = useState("");
  const [muscleGroup, setMuscleGroup] = useState("");
  const [equipment, setEquipment] = useState("");
  const groups = useMemo(
    () => [...new Set(exercises.flatMap((exercise) => exercise.muscleGroups))].sort(),
    [exercises],
  );
  const equipmentOptions = useMemo(
    () =>
      [
        ...new Set(
          exercises.flatMap((exercise) => (exercise.equipment ? [exercise.equipment] : [])),
        ),
      ].sort(),
    [exercises],
  );
  const matches = useMemo(
    () => filterPlanExercises(exercises, query, muscleGroup, equipment),
    [exercises, query, muscleGroup, equipment],
  );

  /** Toggles selection while retaining the order in which exercises were added. */
  const toggle = (id: EntityId) =>
    setSelection((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );

  return (
    <PlanDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={messages.addExercisesAction}
      description={messages.pickerDescription}
      closeLabel={messages.cancelAction}
      fullScreen
      returnFocus={returnFocus}
      footer={
        <>
          <p className={styles.count} role="status">
            {planMessage(messages.selectedCount, { count: selection.length })}
          </p>
          <button
            type="button"
            className={controls.button({ variant: "primary" })}
            onClick={() => onConfirm(selection)}
          >
            {messages.doneAction}
          </button>
        </>
      }
    >
      <label className={controls.field}>
        {messages.searchExercisesLabel}
        <input
          type="search"
          className={controls.input}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={messages.searchExercisesPlaceholder}
        />
      </label>
      <div className={styles.filters}>
        <label className={controls.field}>
          {messages.muscleGroupFilterLabel}
          <select
            className={controls.input}
            value={muscleGroup}
            onChange={(event) => setMuscleGroup(event.currentTarget.value)}
          >
            <option value="">{messages.allMuscleGroups}</option>
            {groups.map((group) => (
              <option key={group} value={group}>
                {formatMuscleGroupLabel(group)}
              </option>
            ))}
          </select>
        </label>
        <label className={controls.field}>
          {messages.equipmentFilterLabel}
          <select
            className={controls.input}
            value={equipment}
            onChange={(event) => setEquipment(event.currentTarget.value)}
          >
            <option value="">{messages.allEquipment}</option>
            {equipmentOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      {matches.length === 0 ? (
        <p className={controls.muted} role="status">
          {messages.noMatchingExercises}
        </p>
      ) : null}
      <ul className={styles.list}>
        {matches.map((exercise) => (
          <li key={exercise.id}>
            <label className={styles.row}>
              <input
                className={styles.checkbox}
                type="checkbox"
                checked={selection.includes(exercise.id)}
                onChange={() => toggle(exercise.id)}
              />
              <span className={styles.summary}>
                <span className={styles.name}>{exercise.name}</span>
                <span className={controls.muted}>
                  {planMessage(messages.exercisePickerMeta, {
                    equipment: exercise.equipment ?? messages.noEquipment,
                    muscles:
                      exercise.muscleGroups.map(formatMuscleGroupLabel).join(", ") ||
                      messages.noMuscleGroup,
                  })}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </PlanDialog>
  );
};
