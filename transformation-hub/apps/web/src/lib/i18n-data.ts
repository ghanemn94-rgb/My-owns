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
  // Carve-out (QA-P34-01a/f)
  'perimeter.impact.change.add': { disposition: 'perimeterDispositions' },
  'perimeter.history.change_request_raised': { disposition: 'perimeterDispositions' },
  'perimeter.history.transferability': { transferClass: 'contractTransferClasses' },
  'perimeter.history.transfer': { from: 'transferStatuses', to: 'transferStatuses' },
  'newco.history.incorporation_recorded': { status: 'incorporationStatuses' },
  'perimeter.transfer_note.scope_reset': { from: 'perimeterDispositions', to: 'perimeterDispositions' },
  'perimeter.transfer_note.scope_reset_cr': { from: 'perimeterDispositions', to: 'perimeterDispositions' },
};

/**
 * Message parameters that carry a vocabulary key translated with a catalogue entry `<prefix>.<value>` (a comma-separated
 * list is translated item by item and joined as a list). Values outside `values` are shown as given.
 */
const KEY_PARAMS: Readonly<Record<string, Readonly<Record<string, { prefix: string; values: readonly string[] }>>>> = {
  'perimeter.recon.day1_position_incomplete': {
    missing: { prefix: 'carveout.day1.missing', values: ['specialistClassification', 'interimArrangement', 'serviceAccountableOwner', 'billingAccountableOwner', 'slaAccountableOwner', 'remediationPlan'] },
  },
  'perimeter.history.aspect_not_applicable_requested': { aspect: { prefix: 'carveout.aspect', values: ['legal', 'economic'] } },
  'perimeter.history.transfer_evidence_invalidated': { aspects: { prefix: 'carveout.aspect', values: ['legal', 'economic'] } },
  'perimeter.history.transfer': {
    aspect: { prefix: 'carveout.aspect', values: ['legal', 'economic'] },
    command: { prefix: 'carveout.transfer.cmd', values: ['plan', 'start', 'report_transferred', 'verify', 'reject_evidence', 'block', 'unblock', 'mark_not_applicable', 'determine_not_applicable'] },
  },
};

/** Message parameters that carry a business date (YYYY-MM-DD): formatted for the active locale. */
const DATE_PARAMS: Readonly<Record<string, readonly string[]>> = {
  'plan.rag.override': ['until'],
  'plan.red.milestone_overdue': ['date'],
  'plan.work.status_update_workstream': ['date'],
  'plan.work.status_update_project': ['date'],
  'tsa.escalation.expired_unresolved': ['endDate'],
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

/** Code prefix → catalogue (`<namespace>.messages`); any other code → `gates.messages`. Mirrored in check-i18n.mjs. */
const ROUTED_PREFIXES: readonly (readonly [string, string])[] = [
  ['plan.', 'planning'],
  ['authority.', 'governance'],
  ['perimeter.', 'carveout'],
  ['tsa.', 'readiness'],
  ['cutover.', 'readiness'],
  ['newco.', 'newco'],
];

/**
 * Catalogue of a server message code: `plan.*` → `planning.messages`, `authority.*` → `governance.messages`,
 * `perimeter.*` → `carveout.messages`, `tsa.*` / `cutover.*` → `readiness.messages`, `newco.*` → `newco.messages`, every
 * other code (status dimensions, gate blockers, JV) → `gates.messages`. apps/web/scripts/check-i18n.mjs checks each
 * catalogue against the domain's English templates (PLANNING_MESSAGES_EN, AUTHORITY_MESSAGES_EN, PERIMETER_MESSAGES_EN,
 * READINESS_MESSAGES_EN, NEWCO_HISTORY_MESSAGES_EN, …).
 */
export function serverMessageKey(code: string): MessageKey {
  const ns = ROUTED_PREFIXES.find(([prefix]) => code.startsWith(prefix))?.[1] ?? 'gates';
  return `${ns}.messages.${code}` as MessageKey;
}

/**
 * Codes whose parameters carry recorded data (record names, committee names, the user's justification…) that is often
 * Latin text with its own punctuation. In the Arabic UI each parameter is wrapped in a first-strong isolate
 * (U+2068 … U+2069) so its direction and parentheses do not reorder the Arabic sentence around it (QA-P34-01b).
 */
const ISOLATED_PREFIXES = ['perimeter.', 'tsa.', 'cutover.', 'newco.'];
const isolate = (v: string) => `\u2068${v}\u2069`;

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
              const vocabulary = KEY_PARAMS[m.code]?.[k];
              if (vocabulary) {
                const items = String(v).split(',').map((x) => x.trim()).filter(Boolean);
                return [k, formatList(items.map((x) => (vocabulary.values.includes(x) ? t(`${vocabulary.prefix}.${x}` as MessageKey) : x)))];
              }
              if (DATE_PARAMS[m.code]?.includes(k)) return [k, formatDate(String(v))];
              if (WEEKDAY_PARAMS[m.code]?.includes(k)) return [k, weekdayNames(locale, formatList, String(v))];
              if (typeof v === 'string' && locale === 'ar' && ISOLATED_PREFIXES.some((p) => m.code.startsWith(p))) return [k, isolate(v)];
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
