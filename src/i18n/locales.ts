export const supportedLocales = ["en"] as const;

/** Locale identifiers supported by this app. */
export type Locale = (typeof supportedLocales)[number];

/** Text direction values supported by HTML documents. */
export type TextDirection = "ltr" | "rtl";

export const defaultLocale = "en" satisfies Locale;

/** Metadata needed to apply a locale at the document level. */
export type LocaleMetadata = {
  /** BCP 47 language tag assigned to the root HTML element. */
  languageTag: string;

  /** Text direction assigned to the root HTML element. */
  textDirection: TextDirection;
};

export const localeMetadata = {
  en: {
    languageTag: "en",
    textDirection: "ltr",
  },
} as const satisfies Record<Locale, LocaleMetadata>;

/** Checks whether an arbitrary string is a supported app locale. */
export const isLocale = (value: string): value is Locale => {
  return supportedLocales.includes(value as Locale);
};
