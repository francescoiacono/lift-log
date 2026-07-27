import { ClipboardList, Dumbbell, History, House } from "lucide-react";
import { useState } from "react";

import { styles } from "./app.styles";
import { ExerciseLibrary } from "@/features/exercises";
import { WorkoutHistory } from "@/features/history";
import { LocalDataSettings } from "@/features/settings";
import { ActiveWorkoutScreen } from "@/features/sessions";
import { WorkoutTemplateLibrary } from "@/features/workouts";
import { defaultLocale, getMessages, type Locale } from "@/i18n";

/** App-level screens currently available in the local-first MVP shell. */
type AppView = "exercises" | "history" | "sessions" | "workouts";

/** Props for the root application component. */
type AppProps = {
  /** Locale used to select user-visible messages for the app. */
  locale?: Locale;
};

/** Root application component. */
export const App = ({ locale = defaultLocale }: AppProps) => {
  const messages = getMessages(locale);
  const [activeView, setActiveView] = useState<AppView>("sessions");
  const [dataResetVersion, setDataResetVersion] = useState(0);
  const [initialWorkoutFeedback, setInitialWorkoutFeedback] = useState<string | null>(null);
  const isExercisesActive = activeView === "exercises";
  const isHistoryActive = activeView === "history";
  const isSessionsActive = activeView === "sessions";
  const isWorkoutsActive = activeView === "workouts";

  /** Moves the app back to a fresh workout start state after local data is reset. */
  const handleLocalDataReset = () => {
    setInitialWorkoutFeedback(messages.settings.resetSuccess);
    setDataResetVersion((currentVersion) => currentVersion + 1);
    setActiveView("sessions");
  };

  /** Reloads all screens from the newly imported local data. */
  const handleLocalDataImported = () => {
    setInitialWorkoutFeedback(messages.settings.importSuccess);
    setDataResetVersion((currentVersion) => currentVersion + 1);
    setActiveView("sessions");
  };

  return (
    <main className={styles.shell}>
      <div className={styles.globalActions}>
        <LocalDataSettings
          messages={messages.settings}
          onDataReset={handleLocalDataReset}
          onDataImported={handleLocalDataImported}
        />
      </div>

      <nav className={styles.navigation} aria-label={messages.app.navigationLabel}>
        <button
          className={styles.navigationButton({ selected: activeView === "sessions" })}
          type="button"
          onClick={() => setActiveView("sessions")}
        >
          <House className={styles.navigationIcon} aria-hidden="true" />
          <span>{messages.app.sessionsNav}</span>
        </button>
        <button
          className={styles.navigationButton({ selected: activeView === "exercises" })}
          type="button"
          onClick={() => setActiveView("exercises")}
        >
          <Dumbbell className={styles.navigationIcon} aria-hidden="true" />
          <span>{messages.app.exercisesNav}</span>
        </button>
        <button
          className={styles.navigationButton({ selected: activeView === "history" })}
          type="button"
          onClick={() => setActiveView("history")}
        >
          <History className={styles.navigationIcon} aria-hidden="true" />
          <span>{messages.app.historyNav}</span>
        </button>
        <button
          className={styles.navigationButton({ selected: activeView === "workouts" })}
          type="button"
          onClick={() => setActiveView("workouts")}
        >
          <ClipboardList className={styles.navigationIcon} aria-hidden="true" />
          <span>{messages.app.workoutsNav}</span>
        </button>
      </nav>

      <div hidden={!isExercisesActive}>
        <ExerciseLibrary
          key={`exercises-${dataResetVersion}`}
          isActive={isExercisesActive}
          messages={messages.exercises}
          onOpenHistory={() => setActiveView("history")}
          onOpenWorkout={() => setActiveView("sessions")}
        />
      </div>
      <div hidden={!isWorkoutsActive}>
        <WorkoutTemplateLibrary
          key={`workouts-${dataResetVersion}`}
          isActive={isWorkoutsActive}
          messages={messages.workouts}
          onSessionStarted={() => setActiveView("sessions")}
        />
      </div>
      <div hidden={!isHistoryActive}>
        <WorkoutHistory
          key={`history-${dataResetVersion}`}
          isActive={isHistoryActive}
          messages={messages.history}
          onSessionStarted={() => setActiveView("sessions")}
        />
      </div>
      <div hidden={!isSessionsActive}>
        <ActiveWorkoutScreen
          key={dataResetVersion}
          initialFeedbackMessage={initialWorkoutFeedback}
          isActive={isSessionsActive}
          messages={messages.sessions}
          onInitialFeedbackShown={() => setInitialWorkoutFeedback(null)}
          onOpenHistory={() => setActiveView("history")}
        />
      </div>
    </main>
  );
};
