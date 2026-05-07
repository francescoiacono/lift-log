import { localeMetadata, type Locale } from "./locales";

/** Applies locale-specific document attributes used by browsers and assistive technology. */
export const applyDocumentLocale = (locale: Locale) => {
  const metadata = localeMetadata[locale];

  document.documentElement.lang = metadata.languageTag;
  document.documentElement.dir = metadata.textDirection;
};
