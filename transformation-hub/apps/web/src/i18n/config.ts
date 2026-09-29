export const LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'hub_locale';

export function normalizeLocale(value: string | null | undefined): Locale {
  return value === 'ar' ? 'ar' : 'en';
}

export function dirOf(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/** Project/business time zone (spec: Asia/Riyadh default). */
export const DISPLAY_TIME_ZONE = 'Asia/Riyadh';

/**
 * Intl locale tags: Gregorian calendar and Latin digits by default for both languages
 * (Arabic UI text, but figures stay comparable across languages and exports).
 */
export const INTL_LOCALE: Record<Locale, string> = {
  en: 'en-GB-u-ca-gregory-nu-latn',
  ar: 'ar-SA-u-ca-gregory-nu-latn',
};
