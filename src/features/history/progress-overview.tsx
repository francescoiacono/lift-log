import {
  Activity,
  ArrowRight,
  ChartNoAxesCombined,
  Dumbbell,
  Star,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useId, useMemo, useState } from "react";

import { styles } from "./progress-overview.styles";
import { buildWeeklyTrainingSummaries, type WeeklyTrainingSummary } from "./progress-metrics";
import type { AppSettings, EntityId, Exercise, WorkoutSession } from "@/db";
import { maximumWeeklyWorkoutTarget, minimumWeeklyWorkoutTarget } from "@/db";
import {
  buildExerciseInsights,
  type ExerciseInsights,
  type ExerciseProgressKind,
  type ExerciseProgressPoint,
} from "@/features/exercises/exercise-insights";
import type { Messages } from "@/i18n";

/** Message dictionary used by the progress overview. */
type ProgressMessages = Messages["history"];

/** Props for the progress overview tab. */
export type ProgressOverviewProps = {
  /** Finished sessions used to derive all insight metrics. */
  sessions: WorkoutSession[];

  /** Exercise definitions used to name and interpret progress. */
  exercises: Exercise[];

  /** Device-local preferences used for targets and units. */
  settings: AppSettings;

  /** Localized copy used by the insight UI. */
  messages: ProgressMessages;

  /** Persists a new weekly workout target. */
  onWeeklyTargetChange: (target: number) => Promise<void> | void;

  /** Opens a selected exercise's full progress detail. */
  onOpenExercise?: (exerciseId: EntityId) => void;
};

/** One rolling activity period used for recent comparison. */
type ActivityPeriod = {
  /** Finished workouts inside this period. */
  workoutCount: number;

  /** Completed sets inside this period. */
  completedSetCount: number;
};

/** Exercise plus its derived insight summary. */
type ExerciseCheckIn = {
  /** Exercise definition represented by this check-in. */
  exercise: Exercise;

  /** Derived progress and workout history for this exercise. */
  insights: ExerciseInsights;
};

/** A personal-record point annotated with its exercise. */
type PersonalRecordEntry = {
  /** Exercise that produced this record. */
  exercise: Exercise;

  /** Metric semantics used by the record. */
  kind: ExerciseProgressKind;

  /** Session performance that established the record. */
  point: ExerciseProgressPoint;
};

/** Props for the compact weekly set chart. */
type WeeklyTrendChartProps = {
  /** Oldest-to-newest weekly summaries rendered by the chart. */
  summaries: WeeklyTrainingSummary[];

  /** Localized copy used by the chart. */
  messages: ProgressMessages;
};

/** Formats a compact whole or one-decimal number. */
const formatNumber = (value: number, maximumFractionDigits = 0): string => {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
};

/** Formats a persisted date for compact insight metadata. */
const formatDate = (timestamp: string, includeYear = false): string => {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: includeYear ? "numeric" : undefined,
  }).format(new Date(timestamp));
};

/** Converts a chart value into a visible percentage without drawing zero-value bars. */
const getBarPercent = (value: number, maximum: number): string => {
  return value === 0 ? "0%" : `${Math.max(3, (value / maximum) * 100)}%`;
};

/** Counts workouts and completed sets within a half-open rolling date range. */
const buildActivityPeriod = (
  sessions: WorkoutSession[],
  startedAt: Date,
  endedAt: Date,
): ActivityPeriod => {
  const includedSessions = sessions.filter((session) => {
    const timestamp = new Date(session.finishedAt ?? session.startedAt);

    return session.status === "finished" && timestamp >= startedAt && timestamp < endedAt;
  });

  return {
    workoutCount: includedSessions.length,
    completedSetCount: includedSessions.reduce(
      (total, session) =>
        total +
        session.exercises.reduce(
          (sessionTotal, exercise) =>
            sessionTotal + exercise.sets.filter((set) => set.isCompleted).length,
          0,
        ),
      0,
    ),
  };
};

/** Formats a current-versus-previous count comparison. */
const formatCountChange = (
  current: number,
  previous: number,
  messages: ProgressMessages,
): string => {
  const difference = current - previous;

  if (difference === 0) {
    return messages.periodChangeSame;
  }

  return (difference > 0 ? messages.periodChangeUp : messages.periodChangeDown).replace(
    "{count}",
    String(Math.abs(difference)),
  );
};

/** Returns the label and suffix for one exercise progress metric. */
const getProgressMetricCopy = (
  kind: ExerciseProgressKind,
  weightUnit: AppSettings["weightUnit"],
  messages: ProgressMessages,
): { label: string; suffix: string } => {
  if (kind === "duration") {
    return { label: messages.durationProgressLabel, suffix: messages.secondsSuffix };
  }

  if (kind === "assistance") {
    return { label: messages.assistanceProgressLabel, suffix: weightUnit };
  }

  if (kind === "repetitions") {
    return { label: messages.repetitionsProgressLabel, suffix: messages.repsSuffix };
  }

  return kind === "weight"
    ? { label: messages.weightProgressLabel, suffix: weightUnit }
    : { label: messages.estimatedStrengthProgressLabel, suffix: weightUnit };
};

/** Formats a comparable exercise progress value with its unit. */
const formatProgressValue = (
  value: number,
  kind: ExerciseProgressKind,
  weightUnit: AppSettings["weightUnit"],
  messages: ProgressMessages,
): string => {
  const metric = getProgressMetricCopy(kind, weightUnit, messages);

  return `${formatNumber(value, 1)} ${metric.suffix}`;
};

/** Formats a signed exercise change while preserving assistance direction. */
const formatExerciseChange = (
  insights: ExerciseInsights,
  weightUnit: AppSettings["weightUnit"],
  messages: ProgressMessages,
): string => {
  if (insights.changeFromPrevious === null) {
    return messages.exerciseBaselineLabel;
  }

  if (insights.changeFromPrevious === 0) {
    return messages.exerciseUnchangedLabel;
  }

  const formatted = formatProgressValue(
    Math.abs(insights.changeFromPrevious),
    insights.progress.kind,
    weightUnit,
    messages,
  );

  return (
    insights.changeFromPrevious > 0 ? messages.exerciseChangeUp : messages.exerciseChangeDown
  ).replace("{value}", formatted);
};

/** Interactive weekly completed-versus-planned set chart. */
const WeeklyTrendChart = ({ summaries, messages }: WeeklyTrendChartProps) => {
  const tooltipId = useId();
  const [activeWeek, setActiveWeek] = useState<string | null>(null);
  const maximumSetCount = Math.max(
    1,
    ...summaries.flatMap((summary) => [summary.completedSetCount, summary.plannedSetCount]),
  );
  const activeSummary = summaries.find((summary) => summary.weekStartedAt === activeWeek);
  const activeIndex = summaries.findIndex((summary) => summary.weekStartedAt === activeWeek);
  const tooltipInlineStart =
    activeIndex < 0 ? "50%" : `${((activeIndex + 0.5) / summaries.length) * 100}%`;
  const tooltipTransform =
    activeIndex <= 1 ? "0%" : activeIndex >= summaries.length - 2 ? "-100%" : "-50%";

  return (
    <div className={styles.chartGroup}>
      <div className={styles.chartHeading}>
        <span>{messages.completedSetsLabel}</span>
        <span className={styles.chartLegend}>
          <span className={styles.legendSwatch({ tone: "completed" })} />
          {messages.completedLegend}
          <span className={styles.legendSwatch({ tone: "planned" })} />
          {messages.plannedLegend}
        </span>
      </div>
      <div className={styles.barChart} role="group" aria-label={messages.weeklySetsChartLabel}>
        {summaries.map((summary) => {
          const isActive = activeWeek === summary.weekStartedAt;
          const label = messages.weeklySetsPoint
            .replace("{week}", formatDate(summary.weekStartedAt, true))
            .replace("{workouts}", String(summary.sessionCount))
            .replace("{completed}", String(summary.completedSetCount))
            .replace("{planned}", String(summary.plannedSetCount));

          return (
            <div
              className={styles.barColumn}
              role="button"
              tabIndex={0}
              aria-label={label}
              aria-describedby={isActive ? tooltipId : undefined}
              aria-expanded={isActive}
              data-active={isActive}
              key={summary.weekStartedAt}
              onPointerEnter={() => setActiveWeek(summary.weekStartedAt)}
              onPointerLeave={(event) => {
                if (event.pointerType === "mouse") {
                  setActiveWeek(null);
                }
              }}
              onFocus={() => setActiveWeek(summary.weekStartedAt)}
              onBlur={() => setActiveWeek(null)}
              onClick={() => setActiveWeek(summary.weekStartedAt)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  setActiveWeek(summary.weekStartedAt);
                }

                if (event.key === "Escape") {
                  setActiveWeek(null);
                }
              }}
            >
              <span className={styles.barValue}>{summary.completedSetCount}</span>
              <span className={styles.barPlot}>
                <span
                  className={styles.bar({ tone: "planned" })}
                  style={{ blockSize: getBarPercent(summary.plannedSetCount, maximumSetCount) }}
                />
                <span
                  className={styles.bar({ tone: "completed" })}
                  style={{ blockSize: getBarPercent(summary.completedSetCount, maximumSetCount) }}
                />
              </span>
              <span className={styles.barLabel}>{formatDate(summary.weekStartedAt)}</span>
            </div>
          );
        })}
      </div>
      {activeSummary ? (
        <div
          className={styles.chartTooltip}
          id={tooltipId}
          role="tooltip"
          style={{
            insetBlockStart: "30px",
            insetInlineStart: tooltipInlineStart,
            transform: `translate(${tooltipTransform}, 0)`,
          }}
        >
          <div className={styles.chartTooltipHeading}>
            <strong>
              {messages.weeklyTooltipTitle.replace(
                "{date}",
                formatDate(activeSummary.weekStartedAt, true),
              )}
            </strong>
          </div>
          <div className={styles.chartTooltipRow}>
            <span>{messages.weeklyTooltipWorkoutsLabel}</span>
            <strong>{activeSummary.sessionCount}</strong>
          </div>
          <div className={styles.chartTooltipRow}>
            <span>{messages.weeklyTooltipCompletedSetsLabel}</span>
            <strong>{activeSummary.completedSetCount}</strong>
          </div>
          <div className={styles.chartTooltipRow}>
            <span>{messages.weeklyTooltipPlannedSetsLabel}</span>
            <strong>{activeSummary.plannedSetCount}</strong>
          </div>
        </div>
      ) : null}
    </div>
  );
};

/** Mobile-first overview of recent activity, records, and exercise progress. */
export const ProgressOverview = ({
  sessions,
  exercises,
  settings,
  messages,
  onWeeklyTargetChange,
  onOpenExercise,
}: ProgressOverviewProps) => {
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const now = new Date();
  const currentPeriodStart = new Date(now);
  const previousPeriodStart = new Date(now);

  currentPeriodStart.setDate(currentPeriodStart.getDate() - 28);
  previousPeriodStart.setDate(previousPeriodStart.getDate() - 56);

  const allWeeklySummaries = useMemo(
    () => buildWeeklyTrainingSummaries(sessions, { weightUnit: settings.weightUnit }),
    [sessions, settings.weightUnit],
  );
  const weeklySummaries = useMemo(
    () =>
      buildWeeklyTrainingSummaries(sessions, {
        templateId: selectedTemplateId || undefined,
        weightUnit: settings.weightUnit,
      }),
    [selectedTemplateId, sessions, settings.weightUnit],
  );
  const planOptions = useMemo(() => {
    const namesById = new Map<EntityId, string>();

    for (const session of [...sessions].reverse()) {
      if (session.templateId) {
        namesById.set(session.templateId, session.name ?? messages.unknownPlan);
      }
    }

    return [...namesById.entries()].sort((first, second) => first[1].localeCompare(second[1]));
  }, [messages.unknownPlan, sessions]);
  const exerciseCheckIns = useMemo<ExerciseCheckIn[]>(() => {
    return exercises
      .map((exercise) => ({
        exercise,
        insights: buildExerciseInsights(
          exercise,
          sessions,
          settings.weightUnit,
          "estimatedStrength",
        ),
      }))
      .filter(({ insights }) => insights.latestPoint !== undefined)
      .sort(
        (first, second) =>
          new Date(second.insights.latestPoint?.startedAt ?? 0).getTime() -
          new Date(first.insights.latestPoint?.startedAt ?? 0).getTime(),
      );
  }, [exercises, sessions, settings.weightUnit]);
  const personalRecords = useMemo<PersonalRecordEntry[]>(() => {
    return exerciseCheckIns
      .flatMap(({ exercise, insights }) =>
        insights.progress.points
          .filter((point) => point.isPersonalRecord)
          .map((point) => ({ exercise, kind: insights.progress.kind, point })),
      )
      .sort(
        (first, second) =>
          new Date(second.point.startedAt).getTime() - new Date(first.point.startedAt).getTime(),
      );
  }, [exerciseCheckIns]);
  const currentPeriod = buildActivityPeriod(sessions, currentPeriodStart, now);
  const previousPeriod = buildActivityPeriod(sessions, previousPeriodStart, currentPeriodStart);
  const recentPersonalRecordCount = personalRecords.filter(
    ({ point }) => new Date(point.startedAt) >= currentPeriodStart,
  ).length;
  const currentWeek = allWeeklySummaries.at(-1);
  const goalPercent = Math.min(
    100,
    Math.round(((currentWeek?.sessionCount ?? 0) / settings.weeklyWorkoutTarget) * 100),
  );
  const goalCircumference = 2 * Math.PI * 34;
  const goalOffset = goalCircumference * (1 - goalPercent / 100);

  return (
    <div className={styles.root}>
      <section className={styles.summaryGrid} aria-label={messages.currentSummaryLabel}>
        <article className={styles.goalCard}>
          <div className={styles.goalRing}>
            <svg viewBox="0 0 80 80" role="img" aria-label={`${goalPercent}%`}>
              <circle className={styles.goalRingTrack} cx="40" cy="40" r="34" />
              <circle
                className={styles.goalRingValue}
                cx="40"
                cy="40"
                r="34"
                strokeDasharray={goalCircumference}
                strokeDashoffset={goalOffset}
              />
            </svg>
            <strong className={styles.goalRingText}>
              {currentWeek?.sessionCount ?? 0}/{settings.weeklyWorkoutTarget}
            </strong>
          </div>
          <div className={styles.summaryText}>
            <span className={styles.summaryLabel}>{messages.weeklyGoalTitle}</span>
            <strong className={styles.summaryValue}>
              {(currentWeek?.sessionCount ?? 0) >= settings.weeklyWorkoutTarget
                ? messages.weeklyGoalComplete
                : messages.weeklyGoalRemaining.replace(
                    "{count}",
                    String(settings.weeklyWorkoutTarget - (currentWeek?.sessionCount ?? 0)),
                  )}
            </strong>
            <label className={styles.targetField}>
              <span>{messages.weeklyTargetLabel}</span>
              <select
                className={styles.targetSelect}
                value={settings.weeklyWorkoutTarget}
                onChange={(event) => void onWeeklyTargetChange(Number(event.currentTarget.value))}
              >
                {Array.from(
                  { length: maximumWeeklyWorkoutTarget - minimumWeeklyWorkoutTarget + 1 },
                  (_, index) => index + minimumWeeklyWorkoutTarget,
                ).map((target) => (
                  <option value={target} key={target}>
                    {messages.weeklyTargetOption.replace("{count}", String(target))}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </article>

        <article className={styles.summaryCard}>
          <Activity className={styles.summaryIcon({ tone: "blue" })} aria-hidden="true" />
          <span className={styles.summaryLabel}>{messages.fourWeekActivityTitle}</span>
          <strong className={styles.summaryValue}>
            {messages.workoutCountValue.replace("{count}", String(currentPeriod.workoutCount))}
          </strong>
          <span className={styles.summaryMeta}>
            {messages.fourWeekActivityMeta
              .replace("{sets}", String(currentPeriod.completedSetCount))
              .replace(
                "{change}",
                formatCountChange(
                  currentPeriod.completedSetCount,
                  previousPeriod.completedSetCount,
                  messages,
                ),
              )}
          </span>
        </article>

        <article className={styles.summaryCard}>
          <Star className={styles.summaryIcon({ tone: "accent" })} aria-hidden="true" />
          <span className={styles.summaryLabel}>{messages.recentRecordsTitle}</span>
          <strong className={styles.summaryValue}>{recentPersonalRecordCount}</strong>
          <span className={styles.summaryMeta}>{messages.lastFourWeeksLabel}</span>
        </article>
      </section>

      <section className={styles.section} aria-labelledby="weekly-trends-title">
        <div className={styles.sectionHeader}>
          <div className={styles.sectionHeading}>
            <ChartNoAxesCombined className={styles.sectionIcon} aria-hidden="true" />
            <div>
              <h2 className={styles.sectionTitle} id="weekly-trends-title">
                {messages.weeklyTrendsTitle}
              </h2>
              <p className={styles.sectionDescription}>{messages.weeklyActivityDescription}</p>
            </div>
          </div>
          <label className={styles.filterField}>
            <span className={styles.visuallyHidden}>{messages.planFilterLabel}</span>
            <select
              className={styles.select}
              value={selectedTemplateId}
              onChange={(event) => setSelectedTemplateId(event.currentTarget.value)}
            >
              <option value="">{messages.allPlansOption}</option>
              {planOptions.map(([templateId, name]) => (
                <option value={templateId} key={templateId}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className={styles.chartCard}>
          <WeeklyTrendChart
            key={selectedTemplateId || "all"}
            summaries={weeklySummaries}
            messages={messages}
          />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="recent-wins-title">
        <div className={styles.sectionHeading}>
          <Star className={styles.sectionIcon} aria-hidden="true" />
          <div>
            <h2 className={styles.sectionTitle} id="recent-wins-title">
              {messages.latestRecordsTitle}
            </h2>
            <p className={styles.sectionDescription}>{messages.latestRecordsDescription}</p>
          </div>
        </div>
        {personalRecords.length > 0 ? (
          <ul className={styles.recordList}>
            {personalRecords.slice(0, 5).map(({ exercise, kind, point }) => (
              <li className={styles.recordCard} key={`${exercise.id}-${point.sessionId}`}>
                <span className={styles.recordIcon}>
                  <Star aria-hidden="true" />
                </span>
                <span className={styles.recordText}>
                  <strong>{exercise.name}</strong>
                  <span>
                    {getProgressMetricCopy(kind, settings.weightUnit, messages).label} ·{" "}
                    {formatProgressValue(point.value, kind, settings.weightUnit, messages)}
                  </span>
                </span>
                <time dateTime={point.startedAt}>{formatDate(point.startedAt)}</time>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.emptyChart}>
            <Star className={styles.emptyIcon} aria-hidden="true" />
            <p>{messages.noPersonalRecords}</p>
          </div>
        )}
      </section>

      <section className={styles.section} aria-labelledby="exercise-check-in-title">
        <div className={styles.sectionHeading}>
          <Dumbbell className={styles.sectionIcon} aria-hidden="true" />
          <div>
            <h2 className={styles.sectionTitle} id="exercise-check-in-title">
              {messages.exerciseCheckInTitle}
            </h2>
            <p className={styles.sectionDescription}>{messages.exerciseCheckInDescription}</p>
          </div>
        </div>
        {exerciseCheckIns.length > 0 ? (
          <ul className={styles.checkInList}>
            {exerciseCheckIns.slice(0, 8).map(({ exercise, insights }) => (
              <li key={exercise.id}>
                <button
                  className={styles.checkInButton}
                  type="button"
                  disabled={!onOpenExercise}
                  onClick={() => onOpenExercise?.(exercise.id)}
                >
                  <span className={styles.checkInHeading}>
                    <strong>{exercise.name}</strong>
                    <span>
                      {messages.exerciseCheckInMeta
                        .replace("{date}", formatDate(insights.latestPoint?.startedAt ?? "", true))
                        .replace("{count}", String(insights.workoutCount))}
                    </span>
                  </span>
                  <span className={styles.checkInValue}>
                    <strong>
                      {insights.latestPoint
                        ? formatProgressValue(
                            insights.latestPoint.value,
                            insights.progress.kind,
                            settings.weightUnit,
                            messages,
                          )
                        : "-"}
                    </strong>
                    <span
                      className={styles.checkInTrend({
                        trend:
                          insights.isImprovement === null
                            ? "neutral"
                            : insights.isImprovement
                              ? "positive"
                              : "negative",
                      })}
                    >
                      {insights.isImprovement === true ? (
                        <TrendingUp aria-hidden="true" />
                      ) : insights.isImprovement === false ? (
                        <TrendingDown aria-hidden="true" />
                      ) : null}
                      {formatExerciseChange(insights, settings.weightUnit, messages)}
                    </span>
                  </span>
                  <ArrowRight className={styles.checkInArrow} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className={styles.emptyChart}>
            <Dumbbell className={styles.emptyIcon} aria-hidden="true" />
            <p>{messages.noExerciseProgress}</p>
          </div>
        )}
      </section>
    </div>
  );
};
