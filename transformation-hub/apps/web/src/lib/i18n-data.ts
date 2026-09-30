'use client';

import { useCallback } from 'react';
import type { ServerMessageDto } from '@hub/contracts';
import type { Locale } from '@/i18n/config';
import { useI18n, type MessageKey, type StatusEnum } from '@/i18n/provider';

/**
 * Locale selection of server strings (QA-P1-14; pattern documented in docs/architecture/module-guide.md §2).
 *
 * - Bilingual DATA comes as `<field>` (English/primary) + `<field>Ar` (Arabic or null). The Arabic UI shows the Arabic
 *   text when the server has one; otherwise the primary text is shown as-is (never machine-translated).
 * - Server-COMPUTED explanations come as `<field>I18n` (codes + parameters) next to the English `<field>`. Codes are
 *   translated with `gates.messages.<code>` (en + ar); rows without codes fall back to the English sentence.
 */
export function localized(locale: Locale, text: string, textAr: string | null | undefined): string;
export function localized(locale: Locale, text: string | null | undefined, textAr: string | null | undefined): string | null;
export function localized(locale: Locale, text: string | null | undefined, textAr: string | null | undefined): string | null {
  return locale === 'ar' && textAr ? textAr : (text ?? null);
}

/** Hook form of {@link localized} bound to the active locale. */
export function useLocalized() {
  const { locale } = useI18n();
  return useCallback(
    <T extends string | null | undefined>(text: T, textAr: string | null | undefined): T extends string ? string : string | null =>
      localized(locale, text, textAr) as T extends string ? string : string | null,
    [locale],
  );
}

const ARABIC_SCRIPT = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LATIN_LETTER = /[A-Za-z]/;

/** Attributes that mark the language and direction of a piece of server text (WCAG 3.1.2 Language of Parts). */
export interface LangAttrs {
  lang?: 'en' | 'ar';
  dir: 'ltr' | 'rtl' | 'auto';
}

/**
 * Language of server text shown by {@link localized} or {@link useServerMessages}.
 *  - Arabic UI showing a fallback — a bilingual field whose `<field>Ar` is null, or a `<field>I18n` without codes — shows
 *    the English/primary text: `lang="en" dir="ltr"`. Exception: the primary text is itself in Arabic script (a user can
 *    type Arabic into the primary field of user-entered bilingual data); it is then in the page language.
 *  - English UI showing text written only in Arabic script (user-entered primary text): `lang="ar" dir="rtl"`.
 *  - Otherwise the text is in the page language: `dir="auto"` only.
 */
export function langAttrs(locale: Locale, shown: string | null | undefined, isFallback: boolean): LangAttrs {
  if (!shown) return { dir: 'auto' };
  if (locale === 'ar' && isFallback && !ARABIC_SCRIPT.test(shown)) return { lang: 'en', dir: 'ltr' };
  if (locale === 'en' && ARABIC_SCRIPT.test(shown) && !LATIN_LETTER.test(shown)) return { lang: 'ar', dir: 'rtl' };
  return { dir: 'auto' };
}

/**
 * `lang` of the text {@link localized} picks, for `<option>` labels and other places where only `lang` may be set (a
 * `dir` on an option would change its alignment inside the select). `undefined` = page language.
 */
export function localizedLang(locale: Locale, text: string | null | undefined, textAr: string | null | undefined): 'en' | 'ar' | undefined {
  return langAttrs(locale, localized(locale, text, textAr), !(locale === 'ar' && textAr)).lang;
}

/**
 * Hook: `(text, textAr) => { text, lang }` — the text {@link localized} picks plus the attributes that mark its language
 * (spread `lang` onto the element that renders only that text).
 */
export function useLocalizedText() {
  const { locale } = useI18n();
  return useCallback(
    (text: string | null | undefined, textAr: string | null | undefined): { text: string | null; lang: LangAttrs } => {
      const shown = localized(locale, text, textAr);
      return { text: shown, lang: langAttrs(locale, shown, !(locale === 'ar' && textAr)) };
    },
    [locale],
  );
}

/** Message parameters that carry an enum value: translated with the enum's status labels before interpolation. */
const ENUM_PARAMS: Readonly<Record<string, Readonly<Record<string, StatusEnum>>>> = {
  'dimension.incorporation.status': { status: 'incorporationStatuses' },
  'gate.blocker.decision_not_approved': { status: 'decisionStatuses' },
};

/**
 * Renders server messages in the active locale: `(messages, englishFallback) => text`. Returns the English fallback when
 * the server sent no codes (e.g. rows computed before codes existed) and `null` when there is nothing to show.
 */
export function useServerMessages() {
  const { t, tStatus, formatNumber } = useI18n();
  return useCallback(
    (messages: readonly ServerMessageDto[] | null | undefined, fallback: string | null | undefined): string | null => {
      if (!messages || messages.length === 0) return fallback ?? null;
      return messages
        .map((m) => {
          const values = Object.fromEntries(
            Object.entries(m.params).map(([k, v]) => {
              const e = ENUM_PARAMS[m.code]?.[k];
              return [k, e ? tStatus(e, String(v)) : typeof v === 'number' ? formatNumber(v) : v];
            }),
          );
          return t(`gates.messages.${m.code}` as MessageKey, values);
        })
        .join(' ');
    },
    [t, tStatus, formatNumber],
  );
}
