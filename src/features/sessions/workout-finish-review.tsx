import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Dumbbell,
  Flame,
  ListChecks,
  Star,
} from "lucide-react";

import {
  buildWorkoutFinishReviewSummary,
  calculateAverageSetEffort,
  getCompletedWorkoutSets,
} from "./workout-finish-review-metrics";
import { styles } from "./workout-finish-review.styles";
import type {
  EntityId,
  Exercise,
  ExerciseConfidenceRating,
  WorkoutSession,
  WorkoutSet,
} from "@/db";
import type { Messages } from "@/i18n";

/** Confidence values edited from the workout finish review. */
export type FinishConfidenceDrafts = Partial<Record<EntityId, ExerciseConfidenceRating | null>>;

/** Props for the workout finish review screen. */
export type WorkoutFinishReviewProps = {
  /** Active workout being reviewed before it is saved. */
  session: WorkoutSession;

  /** Exercise definitions keyed by their stable identifiers. */
  exerciseById: ReadonlyMap<EntityId, Exercise>;

  /** Confidence values selected during the review. */
  confidenceDrafts: FinishConfidenceDrafts;

  /** Whether the workout and confidence updates are being persisted. */
  isSaving: boolean;

  /** Localized active-workout copy. */
  messages: Messages["sessions"];

  /** Returns to the still-active workout. */
  onBack: () => void;

  /** Updates a confidence draft for one exercise. */
  onConfidenceChange: (exerciseId: EntityId, rating: ExerciseConfidenceRating | null) => void;

  /** Persists confidence changes and finishes the workout. */
  onSave: () => void;
};

/** Selectable values in the five-point exercise-confidence scale. */
const confidenceRatings = [1, 2, 3, 4, 5] as const satisfies readonly ExerciseConfidenceRating[];

/** Formats a decimal rating with at most one fractional digit. */
const formatRating = (rating: number): string => {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(rating);
};

/** Formats a persisted workout set for the finish review. */
const formatReviewSet = (set: WorkoutSet, messages: Messages["sessions"]): string => {
  const setLabel = messages.setNumberLabel.replace("{number}", String(set.order + 1));
  const weight =
    set.weight === null
      ? null
      : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(set.weight);

  if (set.durationSeconds != null) {
    const duration = messages.durationValue.replace("{seconds}", String(set.durationSeconds));
    const result = weight === null ? duration : `${weight} ${set.weightUnit} · ${duration}`;

    return `${setLabel} · ${result}`;
  }

  const repetitions =
    set.reps === null ? messages.noReps : messages.repsCount.replace("{count}", String(set.reps));
  const result = weight === null ? repetitions : `${weight} ${set.weightUnit} × ${repetitions}`;

  return `${setLabel} · ${result}`;
};

/** Formats completed set progress for one reviewed exercise. */
const formatExerciseSetProgress = (
  completedSetCount: number,
  targetSets: number | null,
  messages: Messages["sessions"],
): string => {
  if (targetSets === null) {
    return completedSetCount === 1
      ? messages.setCountSingular
      : messages.setCountPlural.replace("{count}", String(completedSetCount));
  }

  return messages.finishReviewExerciseProgress
    .replace("{completed}", String(completedSetCount))
    .replace("{target}", String(targetSets));
};

/** Full-page review shown before an active workout is finalized. */
export const WorkoutFinishReview = ({
  session,
  exerciseById,
  confidenceDrafts,
  isSaving,
  messages,
  onBack,
  onConfidenceChange,
  onSave,
}: WorkoutFinishReviewProps) => {
  const summary = buildWorkoutFinishReviewSummary(session);
  const sessionExercises = [...session.exercises].sort(
    (firstExercise, secondExercise) => firstExercise.order - secondExercise.order,
  );
  const workoutName = session.name ?? messages.sessionTitleFallback;

  return (
    <article className={styles.root} aria-labelledby="finish-review-title">
      <header className={styles.topBar}>
        <button className={styles.backButton} type="button" disabled={isSaving} onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          <span>{messages.finishReviewBackAction}</span>
        </button>
        <span className={styles.topBarTitle}>{messages.finishReviewTopLabel}</span>
        <span className={styles.topBarSpacer} aria-hidden="true" />
      </header>

      <section className={styles.hero}>
        <p>{messages.finishReviewEyebrow}</p>
        <h1 className={styles.title} id="finish-review-title">
          {workoutName}
        </h1>
        <p>{messages.finishReviewDescription}</p>
      </section>

      <section className={styles.summaryGrid} aria-label={messages.finishReviewSummaryLabel}>
        <div className={styles.summaryMetric}>
          <Dumbbell aria-hidden="true" />
          <strong>{summary.exerciseCount}</strong>
          <span>{messages.finishReviewExercisesMetric}</span>
        </div>
        <div className={styles.summaryMetric}>
          <ListChecks aria-hidden="true" />
          <strong>{summary.completedSetCount}</strong>
          <span>{messages.finishReviewSetsMetric}</span>
        </div>
        <div className={styles.summaryMetric}>
          <Flame aria-hidden="true" />
          <strong>
            {summary.averageEffort === null ? "—" : formatRating(summary.averageEffort)}
          </strong>
          <span>{messages.finishReviewEffortMetric}</span>
        </div>
      </section>

      <p
        className={styles.completionNotice({ incomplete: summary.incompleteSetCount > 0 })}
        role={summary.incompleteSetCount > 0 ? "status" : undefined}
      >
        {summary.incompleteSetCount > 0 ? (
          <AlertTriangle aria-hidden="true" />
        ) : (
          <CheckCircle2 aria-hidden="true" />
        )}
        <span>
          {summary.incompleteSetCount === 0
            ? messages.finishReviewAllComplete
            : summary.incompleteSetCount === 1
              ? messages.finishReviewOneIncomplete
              : messages.finishReviewManyIncomplete.replace(
                  "{count}",
                  String(summary.incompleteSetCount),
                )}
        </span>
      </p>

      <section className={styles.section} aria-labelledby="finish-review-exercises-title">
        <header className={styles.sectionHeader}>
          <h2 id="finish-review-exercises-title">{messages.finishReviewExercisesTitle}</h2>
          <p>{messages.finishReviewExercisesDescription}</p>
        </header>

        <ol className={styles.exerciseList}>
          {sessionExercises.map((sessionExercise, index) => {
            const exercise = exerciseById.get(sessionExercise.exerciseId);
            const completedSets = getCompletedWorkoutSets(sessionExercise);
            const averageEffort = calculateAverageSetEffort(completedSets);
            const confidenceRating = exercise ? (confidenceDrafts[exercise.id] ?? null) : null;

            return (
              <li className={styles.exerciseCard} key={sessionExercise.exerciseId}>
                <div className={styles.exerciseHeader}>
                  <div className={styles.exerciseIdentity}>
                    <span>{index + 1}</span>
                    <div>
                      <h3>{exercise?.name ?? messages.missingExercise}</h3>
                      <p>
                        {formatExerciseSetProgress(
                          completedSets.length,
                          sessionExercise.targetSets,
                          messages,
                        )}
                      </p>
                    </div>
                  </div>
                  {averageEffort !== null ? (
                    <span className={styles.averageEffort}>
                      <Flame aria-hidden="true" />
                      {messages.finishReviewAverageEffort.replace(
                        "{rating}",
                        formatRating(averageEffort),
                      )}
                    </span>
                  ) : null}
                </div>

                {completedSets.length > 0 ? (
                  <ol className={styles.setList}>
                    {completedSets.map((set) => (
                      <li className={styles.setRow} key={set.id}>
                        <span>{formatReviewSet(set, messages)}</span>
                        {set.effortRating ? (
                          <span className={styles.setEffort}>
                            <Flame aria-hidden="true" />
                            {messages.finishReviewSetEffort.replace(
                              "{rating}",
                              String(set.effortRating),
                            )}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className={styles.emptySets}>{messages.finishReviewNoCompletedSets}</p>
                )}

                {exercise ? (
                  <fieldset className={styles.confidenceField} disabled={isSaving}>
                    <legend className={styles.confidenceHeading}>
                      <span>{messages.finishReviewConfidenceLabel}</span>
                      <small>
                        {confidenceRating === null
                          ? messages.finishReviewConfidenceUnrated
                          : messages.finishReviewConfidenceValue.replace(
                              "{rating}",
                              String(confidenceRating),
                            )}
                      </small>
                    </legend>
                    <div className={styles.confidenceStars}>
                      {confidenceRatings.map((rating) => (
                        <button
                          className={styles.confidenceStar({
                            filled: confidenceRating !== null && rating <= confidenceRating,
                          })}
                          type="button"
                          key={rating}
                          aria-pressed={confidenceRating === rating}
                          aria-label={messages.finishReviewConfidenceRatingLabel
                            .replace("{exercise}", exercise.name)
                            .replace("{rating}", String(rating))}
                          onClick={() =>
                            onConfidenceChange(
                              exercise.id,
                              confidenceRating === rating ? null : rating,
                            )
                          }
                        >
                          <Star aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                    <span className={styles.confidenceHint}>
                      {messages.finishReviewConfidenceHint}
                    </span>
                  </fieldset>
                ) : null}
              </li>
            );
          })}
        </ol>
      </section>

      <footer className={styles.saveBar}>
        <button className={styles.saveButton} type="button" disabled={isSaving} onClick={onSave}>
          <CheckCircle2 aria-hidden="true" />
          <span>
            {isSaving ? messages.finishReviewSavingAction : messages.finishReviewSaveAction}
          </span>
        </button>
        <small>{messages.finishReviewSaveHint}</small>
      </footer>
    </article>
  );
};
