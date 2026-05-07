import { defaultLocale, type Locale } from "./locales";
import { enMessages } from "./messages/en";

/** Message dictionary shape required for every supported locale. */
export type Messages = typeof enMessages;

export const messages = {
  en: enMessages,
} as const satisfies Record<Locale, Messages>;

/** Returns the message dictionary for a supported locale. */
export const getMessages = (locale: Locale = defaultLocale): Messages => {
  return messages[locale];
};
