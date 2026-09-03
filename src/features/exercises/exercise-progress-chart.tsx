import { Star } from "lucide-react";
import { useId, useState } from "react";

import { styles } from "./exercise-progress-chart.styles";
import {
  formatExerciseProgressValue,
  getExerciseProgressMetricLabel,
} from "./exercise-progress-formatters";
import type { ExerciseProgressKind, ExerciseProgressPoint } from "./exercise-insights";
import type { EntityId, WeightUnit } from "@/db";
import type { Messages } from "@/i18n";

/** Props for the exercise detail progress chart. */
export type ExerciseProgressChartProps = {
  /** Oldest-to-newest comparable exercise performances. */
  points: ExerciseProgressPoint[];

  /** Metric semantics used to format values. */
  kind: ExerciseProgressKind;

  /** Unit used for weighted progress values. */
  weightUnit: WeightUnit;

  /** Exercise name used by the accessible chart summary. */
  exerciseName: string;

  /** Localized exercise copy used by the chart. */
  messages: Messages["exercises"];
};

/** Formats a persisted workout date for chart labels. */
const formatChartDate = (timestamp: string, includeYear = false): string => {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: includeYear ? "numeric" : undefined,
  }).format(new Date(timestamp));
};

/** Formats the logged set behind one progress point. */
const formatPointSet = (
  point: ExerciseProgressPoint,
  weightUnit: WeightUnit,
  messages: Messages["exercises"],
): string => {
  const weight =
    point.weight === null
      ? null
      : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(point.weight);

  if (point.durationSeconds !== null) {
    return messages.workoutSetDuration.replace("{seconds}", String(point.durationSeconds));
  }

  if (weight !== null && point.reps !== null) {
    return messages.workoutSetWeightReps
      .replace("{weight}", weight)
      .replace("{unit}", weightUnit)
      .replace("{reps}", String(point.reps));
  }

  if (point.reps !== null) {
    return messages.workoutSetReps.replace("{reps}", String(point.reps));
  }

  return weight === null ? "-" : `${weight} ${weightUnit}`;
};

/** Interactive, date-proportional line chart for one exercise metric. */
export const ExerciseProgressChart = ({
  points,
  kind,
  weightUnit,
  exerciseName,
  messages,
}: ExerciseProgressChartProps) => {
  const tooltipId = useId();
  const [activeSessionId, setActiveSessionId] = useState<EntityId | null>(null);
  const chartWidth = 360;
  const chartHeight = 170;
  const insetInline = 18;
  const insetBlock = 20;
  const values = points.map((point) => point.value);
  const timestamps = points.map((point) => new Date(point.startedAt).getTime());
  const minimumValue = Math.min(...values);
  const maximumValue = Math.max(...values);
  const minimumTime = Math.min(...timestamps);
  const maximumTime = Math.max(...timestamps);
  const valueRange = maximumValue - minimumValue || 1;
  const timeRange = maximumTime - minimumTime || 1;
  const plotWidth = chartWidth - insetInline * 2;
  const plotHeight = chartHeight - insetBlock * 2;
  const coordinates = points.map((point) => ({
    point,
    x:
      points.length === 1
        ? chartWidth / 2
        : insetInline +
          ((new Date(point.startedAt).getTime() - minimumTime) / timeRange) * plotWidth,
    y:
      maximumValue === minimumValue
        ? chartHeight / 2
        : insetBlock + ((maximumValue - point.value) / valueRange) * plotHeight,
  }));
  const metricLabel = getExerciseProgressMetricLabel(kind, messages);
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
    <div className={styles.root}>
      <div className={styles.plot}>
        <svg
          className={styles.chart}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          role="group"
          aria-label={messages.exerciseChartSummary
            .replace("{exercise}", exerciseName)
            .replace("{metric}", metricLabel)}
          onClick={() => setActiveSessionId(null)}
        >
          <line
            className={styles.gridLine}
            x1={insetInline}
            x2={chartWidth - insetInline}
            y1={insetBlock}
            y2={insetBlock}
          />
          <line
            className={styles.gridLine}
            x1={insetInline}
            x2={chartWidth - insetInline}
            y1={chartHeight - insetBlock}
            y2={chartHeight - insetBlock}
          />
          <polyline
            className={styles.line}
            points={coordinates.map(({ x, y }) => `${x},${y}`).join(" ")}
          />
          {activeCoordinate ? (
            <line
              className={styles.guide}
              x1={activeCoordinate.x}
              x2={activeCoordinate.x}
              y1={insetBlock}
              y2={chartHeight - insetBlock}
            />
          ) : null}
          {coordinates.map(({ point, x, y }) => {
            const isActive = point.sessionId === activeSessionId;
            const value = formatExerciseProgressValue(point.value, kind, weightUnit, messages);
            const pointLabel = messages.exercisePointAriaLabel
              .replace("{date}", formatChartDate(point.startedAt, true))
              .replace("{value}", value)
              .replace("{set}", formatPointSet(point, weightUnit, messages));

            return (
              <g
                className={styles.pointTarget}
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
                <circle className={styles.hitArea} cx={x} cy={y} r="14" />
                <circle
                  className={styles.point({ record: point.isPersonalRecord })}
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
            className={styles.tooltip}
            id={tooltipId}
            role="tooltip"
            style={{
              insetBlockStart: `${(activeCoordinate.y / chartHeight) * 100}%`,
              insetInlineStart: `${(activeCoordinate.x / chartWidth) * 100}%`,
              transform: `translate(${tooltipTranslateInline}, ${tooltipTranslateBlock})`,
            }}
          >
            <div className={styles.tooltipHeading}>
              <strong>{activeCoordinate.point.sessionName ?? messages.noWorkoutName}</strong>
              <span>{formatChartDate(activeCoordinate.point.startedAt, true)}</span>
            </div>
            <div className={styles.tooltipRow}>
              <span>{metricLabel}</span>
              <strong>
                {formatExerciseProgressValue(
                  activeCoordinate.point.value,
                  kind,
                  weightUnit,
                  messages,
                )}
              </strong>
            </div>
            <div className={styles.tooltipRow}>
              <span>{messages.loggedSetLabel}</span>
              <strong>{formatPointSet(activeCoordinate.point, weightUnit, messages)}</strong>
            </div>
            {activeCoordinate.point.isPersonalRecord ? (
              <span className={styles.record}>
                <Star aria-hidden="true" />
                {messages.personalRecordLabel}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className={styles.axis} aria-hidden="true">
        <span>{formatChartDate(points[0]?.startedAt ?? "")}</span>
        <span>{formatChartDate(points.at(-1)?.startedAt ?? "")}</span>
      </div>
    </div>
  );
};
