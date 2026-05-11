import { ClipboardList, Dumbbell, Timer } from "lucide-react";
import { useState } from "react";

import { styles } from "./app.styles";
import { ExerciseLibrary } from "@/features/exercises";
import { ActiveWorkoutScreen } from "@/features/sessions";
import { WorkoutTemplateLibrary } from "@/features/workouts";
import { defaultLocale, getMessages, type Locale } from "@/i18n";

/** App-level screens currently available in the local-first MVP shell. */
type AppView = "exercises" | "sessions" | "workouts";

/** Props for the root application component. */
type AppProps = {
  /** Locale used to select user-visible messages for the app. */
  locale?: Locale;
};

/** Root application component. */
export const App = ({ locale = defaultLocale }: AppProps) => {
  const messages = getMessages(locale);
  const [activeView, setActiveView] = useState<AppView>("exercises");

  return (
    <main className={styles.shell}>
      <nav className={styles.navigation} aria-label={messages.app.navigationLabel}>
        <button
          className={styles.navigationButton({ selected: activeView === "exercises" })}
          type="button"
          onClick={() => setActiveView("exercises")}
        >
          <Dumbbell className={styles.navigationIcon} aria-hidden="true" />
          <span>{messages.app.exercisesNav}</span>
        </button>
        <button
          className={styles.navigationButton({ selected: activeView === "workouts" })}
          type="button"
          onClick={() => setActiveView("workouts")}
        >
          <ClipboardList className={styles.navigationIcon} aria-hidden="true" />
          <span>{messages.app.workoutsNav}</span>
        </button>
        <button
          className={styles.navigationButton({ selected: activeView === "sessions" })}
          type="button"
          onClick={() => setActiveView("sessions")}
        >
          <Timer className={styles.navigationIcon} aria-hidden="true" />
          <span>{messages.app.sessionsNav}</span>
        </button>
      </nav>

      {activeView === "exercises" ? <ExerciseLibrary messages={messages.exercises} /> : null}
      {activeView === "workouts" ? (
        <WorkoutTemplateLibrary
          messages={messages.workouts}
          onSessionStarted={() => setActiveView("sessions")}
        />
      ) : null}
      {activeView === "sessions" ? <ActiveWorkoutScreen messages={messages.sessions} /> : null}
    </main>
  );
};
