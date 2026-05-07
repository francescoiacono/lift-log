import { styles } from "./app.styles";
import { defaultLocale, getMessages, type Locale } from "@/i18n";

/** Props for the root application component. */
type AppProps = {
  /** Locale used to select user-visible messages for the app. */
  locale?: Locale;
};

/** Root application component. */
export const App = ({ locale = defaultLocale }: AppProps) => {
  const messages = getMessages(locale);

  return (
    <main className={styles.shell}>
      <h1 className={styles.title}>{messages.app.title}</h1>
    </main>
  );
};
