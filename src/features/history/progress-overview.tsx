import { CalendarDays, ChartNoAxesCombined, Check, Dumbbell, Star, Target } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { styles } from "./progress-overview.styles";
import {
  buildExerciseProgress,
  buildWeeklyTrainingSummaries,
  calculatePlanAdherence,
  getDaysSinceLastWorkout,
  type ExerciseProgressKind,
  type ExerciseProgressPoint,
  type WeightedExerciseProgressKind,
  type WeeklyTrainingSummary,
} from "./progress-metrics";
import type { AppSettings, EntityId, Exercise, WorkoutSession } from "@/db";
import { maximumWeeklyWorkoutTarget, minimumWeeklyWorkoutTarget } from "@/db";
import type { Messages } from "@/i18n";

/** Message dictionary used by the progress overview. */
type ProgressMessages = Messages["history"];

/** Props for the progress overview tab. */
export type ProgressOverviewProps = {
  /** Finished sessions used to derive all insight metrics. */
  sessions: WorkoutSession[];

  /** Exercise definitions used to name and interpret progress timelines. */
  exercises: Exercise[];

  /** Device-local preferences used for targets and units. */
  settings: AppSettings;

  /** Localized copy used by the insight UI. */
  messages: ProgressMessages;

  /** Persists a new weekly workout target. */
  onWeeklyTargetChange: (target: number) => Promise<void> | void;
};

/** Props for the compact weekly sets and volume chart. */
type WeeklyTrendChartProps = {
  /** Oldest-to-newest weekly summaries rendered by the chart. */
  summaries: WeeklyTrainingSummary[];

  /** Weight-unit suffix used for volume labels. */
  weightUnit: AppSettings["weightUnit"];

  /** Localized copy used by the chart. */
  messages: ProgressMessages;
};

/** Weekly chart containing the currently active bar. */
type WeeklyChartKind = "sets" | "volume";

/** Bar selected through hover, keyboard focus, or touch. */
type ActiveWeeklyPoint = {
  /** Chart to which the selected bar belongs. */
  kind: WeeklyChartKind;

  /** Week represented by the selected bar. */
  weekStartedAt: string;
};

/** Props for the exercise progress line chart. */
type ExerciseProgressChartProps = {
  /** Oldest-to-newest comparable exercise performances. */
  points: ExerciseProgressPoint[];

  /** Metric semantics used to format point values. */
  kind: ExerciseProgressKind;

  /** Weight-unit suffix used for weighted progress metrics. */
  weightUnit: AppSettings["weightUnit"];

  /** Accessible exercise name associated with the series. */
  exerciseName: string;

  /** Localized copy used by the chart. */
  messages: ProgressMessages;
};

/** Formats a compact whole or one-decimal number. */
const formatNumber = (value: number, maximumFractionDigits = 0): string => {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
};

/** Formats a week start as a compact chart label. */
const formatWeekLabel = (timestamp: string): string => {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(
    new Date(timestamp),
  );
};

/** Formats a persisted date for exercise chart endpoints and tooltips. */
const formatProgressDate = (timestamp: string): string => {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(
    new Date(timestamp),
  );
};

/** Formats a persisted date with enough context for a chart tooltip. */
const formatProgressTooltipDate = (timestamp: string): string => {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp));
};

/** Converts a chart value into a visible percentage without drawing zero-value bars. */
const getBarPercent = (value: number, maximum: number): string => {
  return value === 0 ? "0%" : `${Math.max(3, (value / maximum) * 100)}%`;
};

/** Formats days since the last workout into user-facing copy. */
const formatLastWorkout = (days: number | null, messages: ProgressMessages): string => {
  if (days === null) {
    return messages.lastWorkoutNone;
  }

  if (days === 0) {
    return messages.lastWorkoutToday;
  }

  if (days === 1) {
    return messages.lastWorkoutYesterday;
  }

  return messages.lastWorkoutDays.replace("{days}", String(days));
};

/** Returns the label and suffix used by one exercise progress metric. */
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

  if (kind === "weight") {
    return { label: messages.weightProgressLabel, suffix: weightUnit };
  }

  return { label: messages.estimatedStrengthProgressLabel, suffix: weightUnit };
};

/** Returns unambiguous summary labels for the selected progress metric. */
const getProgressStatLabels = (
  kind: ExerciseProgressKind,
  messages: ProgressMessages,
): { latest: string; best: string } => {
  if (kind === "weight") {
    return { latest: messages.latestWeightLabel, best: messages.bestWeightLabel };
  }

  if (kind === "estimatedStrength") {
    return { latest: messages.latestEstimateLabel, best: messages.bestEstimateLabel };
  }

  return { latest: messages.latestValueLabel, best: messages.bestValueLabel };
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

/** Formats the logged set that produced a session's chart point. */
const formatProgressSet = (
  point: ExerciseProgressPoint,
  weightUnit: AppSettings["weightUnit"],
  messages: ProgressMessages,
): string => {
  let setCopy: string | null = null;

  if (point.weight !== null && point.reps !== null) {
    setCopy = messages.exercisePointWeightReps
      .replace("{weight}", formatNumber(point.weight, 1))
      .replace("{unit}", weightUnit)
      .replace("{reps}", formatNumber(point.reps));
  } else if (point.weight !== null) {
    setCopy = messages.exercisePointWeight
      .replace("{weight}", formatNumber(point.weight, 1))
      .replace("{unit}", weightUnit);
  } else if (point.reps !== null) {
    setCopy = messages.exercisePointReps.replace("{reps}", formatNumber(point.reps));
  }

  if (point.durationSeconds === null) {
    return setCopy ?? "-";
  }

  const durationCopy = messages.exercisePointDuration.replace(
    "{duration}",
    formatNumber(point.durationSeconds),
  );

  return setCopy
    ? messages.exercisePointSetAndDuration
        .replace("{set}", setCopy)
        .replace("{duration}", durationCopy)
    : durationCopy;
};

/** Builds the complete accessible label for an interactive chart point. */
const formatProgressPointLabel = (
  point: ExerciseProgressPoint,
  kind: ExerciseProgressKind,
  weightUnit: AppSettings["weightUnit"],
  messages: ProgressMessages,
): string => {
  const metric = getProgressMetricCopy(kind, weightUnit, messages);

  return messages.exercisePointAriaLabel
    .replace("{date}", formatProgressTooltipDate(point.startedAt))
    .replace("{workout}", point.sessionName?.trim() || messages.emptyWorkoutName)
    .replace("{metric}", metric.label)
    .replace("{value}", formatProgressValue(point.value, kind, weightUnit, messages))
    .replace("{set}", formatProgressSet(point, weightUnit, messages))
    .replace("{record}", point.isPersonalRecord ? messages.exercisePointRecordSuffix : "");
};

/** Formats the complete accessible description for a weekly sets bar. */
const formatWeeklySetsPoint = (
  summary: WeeklyTrainingSummary,
  messages: ProgressMessages,
): string => {
  return messages.weeklySetsPoint
    .replace("{week}", formatProgressTooltipDate(summary.weekStartedAt))
    .replace("{workouts}", formatNumber(summary.sessionCount))
    .replace("{completed}", formatNumber(summary.completedSetCount))
    .replace("{planned}", formatNumber(summary.plannedSetCount));
};

/** Formats the complete accessible description for a weekly volume bar. */
const formatWeeklyVolumePoint = (
  summary: WeeklyTrainingSummary,
  weightUnit: AppSettings["weightUnit"],
  messages: ProgressMessages,
): string => {
  return messages.weeklyVolumePoint
    .replace("{week}", formatProgressTooltipDate(summary.weekStartedAt))
    .replace("{volume}", formatNumber(summary.volume))
    .replace("{unit}", weightUnit)
    .replace("{workouts}", formatNumber(summary.sessionCount))
    .replace("{completed}", formatNumber(summary.completedSetCount));
};

/** Keeps a weekly tooltip inside the chart at the first and last columns. */
const getWeeklyTooltipInlineTransform = (index: number, total: number): string => {
  if (index <= 1) {
    return "0%";
  }

  if (index >= total - 2) {
    return "-100%";
  }

  return "-50%";
};

/** Renders aligned weekly sets and volume bars. */
const WeeklyTrendChart = ({ summaries, weightUnit, messages }: WeeklyTrendChartProps) => {
  const tooltipId = useId();
  const [activePoint, setActivePoint] = useState<ActiveWeeklyPoint | null>(null);
  const maximumSetCount = Math.max(
    1,
    ...summaries.map((summary) => Math.max(summary.completedSetCount, summary.plannedSetCount)),
  );
  const maximumVolume = Math.max(1, ...summaries.map((summary) => summary.volume));
  const activeSummary = summaries.find(
    (summary) => summary.weekStartedAt === activePoint?.weekStartedAt,
  );
  const activeSummaryIndex = activeSummary ? summaries.indexOf(activeSummary) : -1;
  const tooltipInlineStart =
    activeSummaryIndex >= 0 ? `${((activeSummaryIndex + 0.5) / summaries.length) * 100}%` : "50%";
  const tooltipTransform = getWeeklyTooltipInlineTransform(activeSummaryIndex, summaries.length);

  return (
    <div className={styles.weeklyCharts}>
      <div
        className={styles.chartGroup}
        role="group"
        aria-label={messages.weeklySetsChartLabel}
        onClick={() => {
          if (activePoint?.kind === "sets") {
            setActivePoint(null);
          }
        }}
      >
        <div className={styles.chartHeading}>
          <span>{messages.completedSetsLabel}</span>
          <span className={styles.chartLegend}>
            <span className={styles.legendSwatch({ tone: "completed" })} aria-hidden="true" />
            {messages.completedLegend}
            <span className={styles.legendSwatch({ tone: "planned" })} aria-hidden="true" />
            {messages.plannedLegend}
          </span>
        </div>
        <div className={styles.barChart}>
          {summaries.map((summary) => {
            const isActive =
              activePoint?.kind === "sets" && activePoint.weekStartedAt === summary.weekStartedAt;

            return (
              <div
                className={styles.barColumn}
                role="button"
                tabIndex={0}
                aria-label={formatWeeklySetsPoint(summary, messages)}
                aria-describedby={isActive ? tooltipId : undefined}
                aria-expanded={isActive}
                data-active={isActive}
                key={summary.weekStartedAt}
                onPointerEnter={() =>
                  setActivePoint({ kind: "sets", weekStartedAt: summary.weekStartedAt })
                }
                onPointerLeave={(event) => {
                  if (event.pointerType === "mouse") {
                    setActivePoint(null);
                  }
                }}
                onFocus={() =>
                  setActivePoint({ kind: "sets", weekStartedAt: summary.weekStartedAt })
                }
                onBlur={() => setActivePoint(null)}
                onClick={(event) => {
                  event.stopPropagation();
                  setActivePoint({ kind: "sets", weekStartedAt: summary.weekStartedAt });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActivePoint({ kind: "sets", weekStartedAt: summary.weekStartedAt });
                  }

                  if (event.key === "Escape") {
                    setActivePoint(null);
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
                <span className={styles.barLabel}>{formatWeekLabel(summary.weekStartedAt)}</span>
              </div>
            );
          })}
        </div>
        {activePoint?.kind === "sets" && activeSummary ? (
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
                  formatProgressTooltipDate(activeSummary.weekStartedAt),
                )}
              </strong>
            </div>
            <div className={styles.chartTooltipRow}>
              <span>{messages.weeklyTooltipWorkoutsLabel}</span>
              <strong>{formatNumber(activeSummary.sessionCount)}</strong>
            </div>
            <div className={styles.chartTooltipRow}>
              <span>{messages.weeklyTooltipCompletedSetsLabel}</span>
              <strong>{formatNumber(activeSummary.completedSetCount)}</strong>
            </div>
            <div className={styles.chartTooltipRow}>
              <span>{messages.weeklyTooltipPlannedSetsLabel}</span>
              <strong>{formatNumber(activeSummary.plannedSetCount)}</strong>
            </div>
          </div>
        ) : null}
      </div>

      <div
        className={styles.chartGroup}
        role="group"
        aria-label={messages.weeklyVolumeChartLabel.replace("{unit}", weightUnit)}
        onClick={() => {
          if (activePoint?.kind === "volume") {
            setActivePoint(null);
          }
        }}
      >
        <div className={styles.chartHeading}>
          <span>{messages.volumeTrendLabel}</span>
          <span className={styles.chartUnit}>
            {messages.volumeUnit.replace("{unit}", weightUnit)}
          </span>
        </div>
        <div className={styles.volumeChart}>
          {summaries.map((summary) => {
            const isActive =
              activePoint?.kind === "volume" && activePoint.weekStartedAt === summary.weekStartedAt;

            return (
              <div
                className={styles.volumeColumn}
                role="button"
                tabIndex={0}
                aria-label={formatWeeklyVolumePoint(summary, weightUnit, messages)}
                aria-describedby={isActive ? tooltipId : undefined}
                aria-expanded={isActive}
                data-active={isActive}
                key={summary.weekStartedAt}
                onPointerEnter={() =>
                  setActivePoint({ kind: "volume", weekStartedAt: summary.weekStartedAt })
                }
                onPointerLeave={(event) => {
                  if (event.pointerType === "mouse") {
                    setActivePoint(null);
                  }
                }}
                onFocus={() =>
                  setActivePoint({ kind: "volume", weekStartedAt: summary.weekStartedAt })
                }
                onBlur={() => setActivePoint(null)}
                onClick={(event) => {
                  event.stopPropagation();
                  setActivePoint({ kind: "volume", weekStartedAt: summary.weekStartedAt });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActivePoint({ kind: "volume", weekStartedAt: summary.weekStartedAt });
                  }

                  if (event.key === "Escape") {
                    setActivePoint(null);
                  }
                }}
              >
                <span className={styles.barPlot}>
                  <span
                    className={styles.bar({ tone: "volume" })}
                    style={{ blockSize: getBarPercent(summary.volume, maximumVolume) }}
                  />
                </span>
              </div>
            );
          })}
        </div>
        {activePoint?.kind === "volume" && activeSummary ? (
          <div
            className={styles.chartTooltip}
            id={tooltipId}
            role="tooltip"
            style={{
              insetBlockEnd: "calc(100% + 8px)",
              insetInlineStart: tooltipInlineStart,
              transform: `translate(${tooltipTransform}, 0)`,
            }}
          >
            <div className={styles.chartTooltipHeading}>
              <strong>
                {messages.weeklyTooltipTitle.replace(
                  "{date}",
                  formatProgressTooltipDate(activeSummary.weekStartedAt),
                )}
              </strong>
            </div>
            <div className={styles.chartTooltipRow}>
              <span>{messages.weeklyTooltipVolumeLabel}</span>
              <strong>
                {`${formatNumber(activeSummary.volume)} ${messages.volumeUnit.replace(
                  "{unit}",
                  weightUnit,
                )}`}
              </strong>
            </div>
            <div className={styles.chartTooltipRow}>
              <span>{messages.weeklyTooltipCompletedSetsLabel}</span>
              <strong>{formatNumber(activeSummary.completedSetCount)}</strong>
            </div>
            <div className={styles.chartTooltipRow}>
              <span>{messages.weeklyTooltipWorkoutsLabel}</span>
              <strong>{formatNumber(activeSummary.sessionCount)}</strong>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

/** Converts exercise progress points into a responsive SVG line chart. */
const ExerciseProgressChart = ({
  points,
  kind,
  weightUnit,
  exerciseName,
  messages,
}: ExerciseProgressChartProps) => {
  const tooltipId = useId();
  const [activeSessionId, setActiveSessionId] = useState<EntityId | null>(null);
  const chartWidth = 360;
  const chartHeight = 168;
  const insetInline = 18;
  const insetBlock = 20;
  const values = points.map((point) => point.value);
  const minimumValue = Math.min(...values);
  const maximumValue = Math.max(...values);
  const valueRange = maximumValue - minimumValue || 1;
  const plotWidth = chartWidth - insetInline * 2;
  const plotHeight = chartHeight - insetBlock * 2;
  const coordinates = points.map((point, index) => ({
    point,
    x:
      points.length === 1
        ? chartWidth / 2
        : insetInline + (index / (points.length - 1)) * plotWidth,
    y:
      maximumValue === minimumValue
        ? chartHeight / 2
        : insetBlock + ((maximumValue - point.value) / valueRange) * plotHeight,
  }));
  const path = coordinates.map(({ x, y }) => `${x},${y}`).join(" ");
  const metric = getProgressMetricCopy(kind, weightUnit, messages);
  const latestPoint = points.at(-1);
  const summary = messages.exerciseChartSummary
    .replace("{exercise}", exerciseName)
    .replace("{metric}", metric.label)
    .replace(
      "{latest}",
      latestPoint ? formatProgressValue(latestPoint.value, kind, weightUnit, messages) : "-",
    );
  const activeCoordinate = coordinates.find(({ point }) => point.sessionId === activeSessionId);
  const tooltipTranslateInline = activeCoordinate
    ? activeCoordinate.x < chartWidth * 0.25
      ? "0%"
      : activeCoordinate.x > chartWidth * 0.75
        ? "-100%"
        : "-50%"
    : "-50%";
  const tooltipTranslateBlock =
    activeCoordinate && activeCoordinate.y < chartHeight / 2 ? "12px" : "calc(-100% - 12px)";

  return (
    <div className={styles.exerciseChartWrap}>
      <div className={styles.exerciseChartPlot}>
        <svg
          className={styles.exerciseChart}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="group"
          aria-label={summary}
          onClick={() => setActiveSessionId(null)}
        >
          <line
            className={styles.chartGridLine}
            x1={insetInline}
            x2={chartWidth - insetInline}
            y1={insetBlock}
            y2={insetBlock}
          />
          <line
            className={styles.chartGridLine}
            x1={insetInline}
            x2={chartWidth - insetInline}
            y1={chartHeight - insetBlock}
            y2={chartHeight - insetBlock}
          />
          <polyline className={styles.exerciseChartLine} points={path} />
          {activeCoordinate ? (
            <line
              className={styles.chartPointGuide}
              x1={activeCoordinate.x}
              x2={activeCoordinate.x}
              y1={insetBlock}
              y2={chartHeight - insetBlock}
            />
          ) : null}
          {coordinates.map(({ point, x, y }) => {
            const isActive = point.sessionId === activeSessionId;
            const pointLabel = formatProgressPointLabel(point, kind, weightUnit, messages);

            return (
              <g
                className={styles.chartPointTarget}
                role="button"
                tabIndex={0}
                aria-label={pointLabel}
                aria-describedby={isActive ? tooltipId : undefined}
                aria-expanded={isActive}
                key={point.sessionId}
                onPointerEnter={() => setActiveSessionId(point.sessionId)}
                onPointerLeave={(event) => {
                  if (event.pointerType === "mouse") {
                    setActiveSessionId(null);
                  }
                }}
                onFocus={() => setActiveSessionId(point.sessionId)}
                onBlur={() => setActiveSessionId(null)}
                onClick={(event) => {
                  event.stopPropagation();
                  setActiveSessionId(point.sessionId);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setActiveSessionId(point.sessionId);
                  }

                  if (event.key === "Escape") {
                    setActiveSessionId(null);
                  }
                }}
              >
                <circle className={styles.chartPointHitArea} cx={x} cy={y} r="14" />
                <circle
                  className={styles.exerciseChartPoint({ record: point.isPersonalRecord })}
                  data-active={isActive}
                  data-point-marker=""
                  cx={x}
                  cy={y}
                  r={isActive ? 7 : point.isPersonalRecord ? 6 : 4}
                />
                <title>{pointLabel}</title>
              </g>
            );
          })}
        </svg>
        {activeCoordinate ? (
          <div
            className={styles.chartTooltip}
            id={tooltipId}
            role="tooltip"
            style={{
              insetBlockStart: `${(activeCoordinate.y / chartHeight) * 100}%`,
              insetInlineStart: `${(activeCoordinate.x / chartWidth) * 100}%`,
              transform: `translate(${tooltipTranslateInline}, ${tooltipTranslateBlock})`,
            }}
          >
            <div className={styles.chartTooltipHeading}>
              <strong>
                {activeCoordinate.point.sessionName?.trim() || messages.emptyWorkoutName}
              </strong>
              <span>{formatProgressTooltipDate(activeCoordinate.point.startedAt)}</span>
            </div>
            <div className={styles.chartTooltipRow}>
              <span>{metric.label}</span>
              <strong>
                {formatProgressValue(activeCoordinate.point.value, kind, weightUnit, messages)}
              </strong>
            </div>
            <div className={styles.chartTooltipRow}>
              <span>{messages.exercisePointLoggedSetLabel}</span>
              <strong>{formatProgressSet(activeCoordinate.point, weightUnit, messages)}</strong>
            </div>
            {activeCoordinate.point.isPersonalRecord ? (
              <span className={styles.chartTooltipRecord}>
                <Star aria-hidden="true" />
                {messages.exercisePointRecordLabel}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className={styles.chartAxisLabels} aria-hidden="true">
        <span>{formatProgressDate(points[0]?.startedAt ?? "")}</span>
        <span>{formatProgressDate(points.at(-1)?.startedAt ?? "")}</span>
      </div>
    </div>
  );
};

/** Mobile-first overview of consistency, adherence, and exercise progress. */
export const ProgressOverview = ({
  sessions,
  exercises,
  settings,
  messages,
  onWeeklyTargetChange,
}: ProgressOverviewProps) => {
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedExerciseId, setSelectedExerciseId] = useState("");
  const [weightedProgressKind, setWeightedProgressKind] =
    useState<WeightedExerciseProgressKind>("weight");
  const planOptions = useMemo(() => {
    const namesById = new Map<EntityId, string>();

    for (const session of [...sessions].reverse()) {
      if (session.templateId) {
        namesById.set(session.templateId, session.name ?? messages.unknownPlan);
      }
    }

    return [...namesById.entries()].sort((first, second) => first[1].localeCompare(second[1]));
  }, [messages.unknownPlan, sessions]);
  const exerciseOptions = useMemo(() => {
    const loggedExerciseIds = new Set(
      sessions.flatMap((session) =>
        session.exercises
          .filter((sessionExercise) => sessionExercise.sets.some((set) => set.isCompleted))
          .map((sessionExercise) => sessionExercise.exerciseId),
      ),
    );

    return exercises.filter((exercise) => loggedExerciseIds.has(exercise.id));
  }, [exercises, sessions]);

  const effectiveSelectedExerciseId = exerciseOptions.some(
    (exercise) => exercise.id === selectedExerciseId,
  )
    ? selectedExerciseId
    : (exerciseOptions[0]?.id ?? "");

  const allWeeklySummaries = useMemo(() => {
    return buildWeeklyTrainingSummaries(sessions, { weightUnit: settings.weightUnit });
  }, [sessions, settings.weightUnit]);
  const weeklySummaries = useMemo(() => {
    return buildWeeklyTrainingSummaries(sessions, {
      templateId: selectedTemplateId || undefined,
      weightUnit: settings.weightUnit,
    });
  }, [selectedTemplateId, sessions, settings.weightUnit]);
  const adherence = useMemo(() => calculatePlanAdherence(allWeeklySummaries), [allWeeklySummaries]);
  const currentWeek = allWeeklySummaries.at(-1);
  const daysSinceLastWorkout = useMemo(() => getDaysSinceLastWorkout(sessions), [sessions]);
  const selectedExercise = exerciseOptions.find(
    (exercise) => exercise.id === effectiveSelectedExerciseId,
  );
  const exerciseProgress = useMemo(() => {
    return selectedExercise
      ? buildExerciseProgress(selectedExercise, sessions, settings.weightUnit, weightedProgressKind)
      : null;
  }, [selectedExercise, sessions, settings.weightUnit, weightedProgressKind]);
  const progressPoints = exerciseProgress?.points ?? [];
  const progressStatLabels = exerciseProgress
    ? getProgressStatLabels(exerciseProgress.kind, messages)
    : { latest: messages.latestValueLabel, best: messages.bestValueLabel };
  const latestProgressPoint = progressPoints.at(-1);
  const bestProgressPoint =
    exerciseProgress?.kind === "assistance"
      ? [...progressPoints].sort((first, second) => first.value - second.value)[0]
      : [...progressPoints].sort((first, second) => second.value - first.value)[0];
  const personalRecordCount = progressPoints.filter((point) => point.isPersonalRecord).length;
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
                  {
                    length: maximumWeeklyWorkoutTarget - minimumWeeklyWorkoutTarget + 1,
                  },
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
          <CalendarDays className={styles.summaryIcon({ tone: "blue" })} aria-hidden="true" />
          <span className={styles.summaryLabel}>{messages.lastWorkoutTitle}</span>
          <strong className={styles.summaryValue}>
            {formatLastWorkout(daysSinceLastWorkout, messages)}
          </strong>
        </article>

        <article className={styles.summaryCard}>
          <Check className={styles.summaryIcon({ tone: "accent" })} aria-hidden="true" />
          <span className={styles.summaryLabel}>{messages.adherenceTitle}</span>
          <strong className={styles.summaryValue}>
            {adherence.percent === null ? "-" : `${adherence.percent}%`}
          </strong>
          <span className={styles.summaryMeta}>
            {messages.adherenceMeta
              .replace("{completed}", String(adherence.completedSetCount))
              .replace("{planned}", String(adherence.plannedSetCount))}
          </span>
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
              <p className={styles.sectionDescription}>{messages.weeklyTrendsDescription}</p>
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
            weightUnit={settings.weightUnit}
            messages={messages}
          />
        </div>
      </section>

      <section className={styles.section} aria-labelledby="exercise-progress-title">
        <div className={styles.sectionHeader}>
          <div className={styles.sectionHeading}>
            <Dumbbell className={styles.sectionIcon} aria-hidden="true" />
            <div>
              <h2 className={styles.sectionTitle} id="exercise-progress-title">
                {messages.exerciseProgressTitle}
              </h2>
              <p className={styles.sectionDescription}>{messages.exerciseProgressDescription}</p>
            </div>
          </div>
          {exerciseOptions.length > 0 ? (
            <label className={styles.filterField}>
              <span className={styles.visuallyHidden}>{messages.exerciseFilterLabel}</span>
              <select
                className={styles.select}
                value={effectiveSelectedExerciseId}
                onChange={(event) => {
                  setSelectedExerciseId(event.currentTarget.value);
                  setWeightedProgressKind("weight");
                }}
              >
                {exerciseOptions.map((exercise) => (
                  <option value={exercise.id} key={exercise.id}>
                    {exercise.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>

        {selectedExercise && exerciseProgress && progressPoints.length > 0 ? (
          <div className={styles.exerciseProgressCard}>
            <div className={styles.exerciseStats}>
              <div className={styles.exerciseStat}>
                <span className={styles.exerciseStatLabel}>{progressStatLabels.latest}</span>
                <strong className={styles.exerciseStatValue}>
                  {latestProgressPoint
                    ? formatProgressValue(
                        latestProgressPoint.value,
                        exerciseProgress.kind,
                        settings.weightUnit,
                        messages,
                      )
                    : "-"}
                </strong>
              </div>
              <div className={styles.exerciseStat}>
                <span className={styles.exerciseStatLabel}>{progressStatLabels.best}</span>
                <strong className={styles.exerciseStatValue}>
                  {bestProgressPoint
                    ? formatProgressValue(
                        bestProgressPoint.value,
                        exerciseProgress.kind,
                        settings.weightUnit,
                        messages,
                      )
                    : "-"}
                </strong>
              </div>
              <div className={styles.exerciseStat}>
                <span className={styles.exerciseStatLabel}>{messages.personalRecordsLabel}</span>
                <strong className={styles.exerciseStatValue}>{personalRecordCount}</strong>
              </div>
            </div>
            <div className={styles.metricLabel}>
              <Target className={styles.metricIcon} aria-hidden="true" />
              {exerciseProgress.kind === "weight" ||
              exerciseProgress.kind === "estimatedStrength" ? (
                <label className={styles.metricField}>
                  <span className={styles.visuallyHidden}>{messages.progressMetricLabel}</span>
                  <select
                    className={styles.metricSelect}
                    value={weightedProgressKind}
                    onChange={(event) =>
                      setWeightedProgressKind(
                        event.currentTarget.value as WeightedExerciseProgressKind,
                      )
                    }
                  >
                    <option value="weight">{messages.weightProgressLabel}</option>
                    <option value="estimatedStrength">
                      {messages.estimatedStrengthProgressLabel}
                    </option>
                  </select>
                </label>
              ) : (
                getProgressMetricCopy(exerciseProgress.kind, settings.weightUnit, messages).label
              )}
              {personalRecordCount > 0 ? (
                <span className={styles.prLegend}>
                  <Star className={styles.prIcon} aria-hidden="true" />
                  {messages.prMarkerLabel}
                </span>
              ) : null}
            </div>
            <ExerciseProgressChart
              key={`${selectedExercise.id}-${exerciseProgress.kind}`}
              points={progressPoints}
              kind={exerciseProgress.kind}
              weightUnit={settings.weightUnit}
              exerciseName={selectedExercise.name}
              messages={messages}
            />
          </div>
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
