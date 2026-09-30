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
