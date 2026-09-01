import { appSettingsId, db as defaultDatabase, type LiftLogDatabase } from "../database";
import type { AppSettings, IsoDateTime } from "../entities";
import { createIsoDateTime } from "../persistence-utils";

/** Default weekly workout target for devices without saved preferences. */
export const defaultWeeklyWorkoutTarget = 3;

/** Lowest weekly workout target accepted by the app. */
export const minimumWeeklyWorkoutTarget = 1;

/** Highest weekly workout target accepted by the app. */
export const maximumWeeklyWorkoutTarget = 7;

/** Dependency overrides used to create an app settings repository. */
export type SettingsRepositoryOptions = {
  /** Database containing the singleton app settings record. */
  database?: LiftLogDatabase;

  /** Timestamp factory used when creating or updating settings. */
  now?: () => IsoDateTime;
};

/** Persistence operations for device-local app preferences. */
export type SettingsRepository = {
  /** Returns saved settings, creating defaults when none exist. */
  get: () => Promise<AppSettings>;

  /** Updates the number of workouts targeted each week. */
  updateWeeklyWorkoutTarget: (target: number) => Promise<AppSettings>;
};

/** Restricts an untrusted weekly target to the supported whole-number range. */
export const normalizeWeeklyWorkoutTarget = (target: unknown): number => {
  if (typeof target !== "number" || !Number.isFinite(target)) {
    return defaultWeeklyWorkoutTarget;
  }

  return Math.min(
    maximumWeeklyWorkoutTarget,
    Math.max(minimumWeeklyWorkoutTarget, Math.round(target)),
  );
};

/** Creates default settings for a new or reset device. */
const createDefaultSettings = (timestamp: IsoDateTime): AppSettings => {
  return {
    id: appSettingsId,
    defaultRestSeconds: 120,
    weeklyWorkoutTarget: defaultWeeklyWorkoutTarget,
    weightUnit: "kg",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

/** Creates a typed repository for app preferences. */
export const createSettingsRepository = ({
  database = defaultDatabase,
  now = createIsoDateTime,
}: SettingsRepositoryOptions = {}): SettingsRepository => {
  /** Loads the singleton settings record or persists a default one. */
  const get = async (): Promise<AppSettings> => {
    const existingSettings = await database.settings.get(appSettingsId);

    if (existingSettings) {
      const weeklyWorkoutTarget = normalizeWeeklyWorkoutTarget(
        existingSettings.weeklyWorkoutTarget,
      );

      if (weeklyWorkoutTarget === existingSettings.weeklyWorkoutTarget) {
        return existingSettings;
      }

      const repairedSettings = { ...existingSettings, weeklyWorkoutTarget };

      await database.settings.put(repairedSettings);

      return repairedSettings;
    }

    const settings = createDefaultSettings(now());

    await database.settings.put(settings);

    return settings;
  };

  return {
    get,
    updateWeeklyWorkoutTarget: async (target) => {
      const settings = await get();
      const updatedSettings: AppSettings = {
        ...settings,
        weeklyWorkoutTarget: normalizeWeeklyWorkoutTarget(target),
        updatedAt: now(),
      };

      await database.settings.put(updatedSettings);

      return updatedSettings;
    },
  };
};

export const settingsRepository = createSettingsRepository();
