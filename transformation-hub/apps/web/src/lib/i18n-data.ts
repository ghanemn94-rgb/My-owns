'use client';

import { useCallback } from 'react';
import type { ServerMessageDto } from '@hub/contracts';
import { INTL_LOCALE, type Locale } from '@/i18n/config';
import { useI18n, type MessageKey, type StatusEnum } from '@/i18n/provider';

/**
 * Locale selection of server strings (QA-P1-14; pattern documented in docs/architecture/module-guide.md §2).
 *
 * - Bilingual DATA comes as `<field>` (English/primary) + `<field>Ar` (Arabic or null). The Arabic UI shows the Arabic
 *   text when the server has one; otherwise the primary text is shown as-is (never machine-translated).
 * - Server-COMPUTED explanations come as `<field>I18n` (codes + parameters) next to the English `<field>`. Codes are
 *   translated with `<namespace>.messages.<code>` (en + ar; `serverMessageKey`); rows without codes fall back to the
 *   English sentence.
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
  'jv.closing.cp_unmet': { status: 'conditionStatuses' },
  // Planning (QA-P2-04)
  'plan.rag.aggregate': { status: 'ragStatuses' },
  'plan.rag.override': { calculated: 'ragStatuses' },
  'plan.rag.override_capped': { status: 'ragStatuses', calculated: 'ragStatuses' },
  'plan.red.override_not_hiding': { status: 'ragStatuses' },
  'plan.work.rag_override_workstream': { status: 'ragStatuses', calculated: 'ragStatuses' },
  'plan.work.rag_override_project': { status: 'ragStatuses', calculated: 'ragStatuses' },
};

/** Message parameters that carry a business date (YYYY-MM-DD): formatted for the active locale. */
const DATE_PARAMS: Readonly<Record<string, readonly string[]>> = {
  'plan.rag.override': ['until'],
  'plan.red.milestone_overdue': ['date'],
  'plan.work.status_update_workstream': ['date'],
  'plan.work.status_update_project': ['date'],
};

/** Message parameters that carry a comma-separated list of weekday numbers (0 = Sunday): shown as weekday names. */
const WEEKDAY_PARAMS: Readonly<Record<string, readonly string[]>> = {
  'plan.assumption.calendar': ['days'],
};

/** "0,1,2,3,4" → "Sunday, Monday, …" in the active language (2026-10-04 is a Sunday); other values are kept as given. */
function weekdayNames(locale: Locale, list: (items: string[]) => string, value: string): string {
  const days = value.split(',').map((d) => d.trim());
  if (!days.every((d) => /^[0-6]$/.test(d))) return value;
  const fmt = new Intl.DateTimeFormat(INTL_LOCALE[locale], { weekday: 'long', timeZone: 'UTC' });
  return list(days.map((d) => fmt.format(new Date(Date.UTC(2026, 9, 4 + Number(d))))));
}

/**
 * Catalogue of a server message code: `plan.*` → `planning.messages`, `authority.*` → `governance.messages`, every other
 * code (status dimensions, gate blockers, JV) → `gates.messages`. apps/web/scripts/check-i18n.mjs checks each catalogue
 * against the domain's English templates (PLANNING_MESSAGES_EN, AUTHORITY_MESSAGES_EN, …).
 */
export function serverMessageKey(code: string): MessageKey {
  const ns = code.startsWith('plan.') ? 'planning' : code.startsWith('authority.') ? 'governance' : 'gates';
  return `${ns}.messages.${code}` as MessageKey;
}

/**
 * Renders server messages in the active locale: `(messages, englishFallback) => text`. Returns the English fallback when
 * the server sent no codes (e.g. rows computed before codes existed) and `null` when there is nothing to show.
 */
export function useServerMessages() {
  const { t, tStatus, formatNumber, formatDate, formatList, locale } = useI18n();
  return useCallback(
    (messages: readonly ServerMessageDto[] | null | undefined, fallback: string | null | undefined): string | null => {
      if (!messages || messages.length === 0) return fallback ?? null;
      return messages
        .map((m) => {
          const values = Object.fromEntries(
            Object.entries(m.params).map(([k, v]) => {
              const e = ENUM_PARAMS[m.code]?.[k];
              if (e) return [k, tStatus(e, String(v))];
              if (DATE_PARAMS[m.code]?.includes(k)) return [k, formatDate(String(v))];
              if (WEEKDAY_PARAMS[m.code]?.includes(k)) return [k, weekdayNames(locale, formatList, String(v))];
              return [k, typeof v === 'number' ? formatNumber(v) : v];
            }),
          );
          return t(serverMessageKey(m.code), values);
        })
        .join(' ');
    },
    [t, tStatus, formatNumber, formatDate, formatList, locale],
  );
}
