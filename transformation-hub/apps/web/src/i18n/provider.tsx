'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import type { Messages } from './messages';
import { DISPLAY_TIME_ZONE, INTL_LOCALE, dirOf, type Locale } from './config';

type PluralForms = { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>;

/** Dot-separated keys of every leaf string (or plural group) in the catalogue, excluding `statuses`. */
type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string
    ? `${P}${K}`
    : T[K] extends { other: string }
      ? `${P}${K}`
      : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Paths<Omit<Messages, 'statuses'>>;
export type StatusEnum = keyof Messages['statuses'];
export type Values = Record<string, string | number | null | undefined>;

export interface I18nValue {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  appName: string;
  t: (key: MessageKey, values?: Values) => string;
  /** Translate an enum value: `statuses.<enumName>.<value>`; unknown values are humanised, never hidden. */
  tStatus: (enumName: StatusEnum, value: string | null | undefined) => string;
  hasStatus: (enumName: StatusEnum, value: string) => boolean;
  formatDate: (isoDate: string | null | undefined) => string;
  formatDateTime: (instant: string | null | undefined) => string;
  formatNumber: (n: number | null | undefined) => string;
  formatList: (items: string[]) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export const EM_DASH = '—';

function lookup(messages: unknown, key: string): unknown {
  let node: unknown = messages;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) node = (node as Record<string, unknown>)[part];
    else return undefined;
  }
  return node;
}

function interpolate(template: string, values?: Values): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const v = values[name];
    return v === undefined || v === null ? match : String(v);
  });
}

export function humanize(value: string): string {
  const s = value.replace(/[._]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function I18nProvider({
  locale,
  messages,
  appName,
  children,
}: {
  locale: Locale;
  messages: Messages;
  appName: string;
  children: ReactNode;
}) {
  const intl = INTL_LOCALE[locale];
  const plural = useMemo(() => new Intl.PluralRules(intl), [intl]);
  const dateFmt = useMemo(() => new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }), [intl]);
  const dateTimeFmt = useMemo(
    () => new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: DISPLAY_TIME_ZONE }),
    [intl],
  );
  const numberFmt = useMemo(() => new Intl.NumberFormat(intl), [intl]);
  const listFmt = useMemo(() => new Intl.ListFormat(intl, { style: 'short', type: 'unit' }), [intl]);

  const t = useCallback(
    (key: MessageKey, values?: Values) => {
      const node = lookup(messages, key);
      if (typeof node === 'string') return interpolate(node, values);
      if (node && typeof node === 'object' && 'other' in node) {
        const forms = node as PluralForms;
        const count = typeof values?.count === 'number' ? values.count : 0;
        const exact = count === 0 ? forms.zero : undefined;
        const form = exact ?? forms[plural.select(count)] ?? forms.other;
        return interpolate(form, { ...values, count: numberFmt.format(count) });
      }
      if (process.env.NODE_ENV !== 'production') console.warn(`[i18n] missing key ${key} (${locale})`);
      return key;
    },
    [messages, plural, numberFmt, locale],
  );

  const tStatus = useCallback(
    (enumName: StatusEnum, value: string | null | undefined) => {
      if (value === null || value === undefined || value === '') return EM_DASH;
      const group = messages.statuses[enumName] as Record<string, string> | undefined;
      return group?.[value] ?? humanize(value);
    },
    [messages],
  );

  const hasStatus = useCallback(
    (enumName: StatusEnum, value: string) => Boolean((messages.statuses[enumName] as Record<string, string> | undefined)?.[value]),
    [messages],
  );

  const value = useMemo<I18nValue>(
    () => ({
      locale,
      dir: dirOf(locale),
      appName,
      t,
      tStatus,
      hasStatus,
      formatDate: (iso) => {
        if (!iso) return EM_DASH;
        // Business dates (YYYY-MM-DD) are calendar dates: format them in UTC so they never shift a day.
        const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00Z`) : new Date(iso);
        return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
      },
      formatDateTime: (instant) => {
        if (!instant) return EM_DASH;
        const d = new Date(instant);
        return Number.isNaN(d.getTime()) ? instant : dateTimeFmt.format(d);
      },
      formatNumber: (n) => (n === null || n === undefined ? EM_DASH : numberFmt.format(n)),
      formatList: (items) => listFmt.format(items),
    }),
    [locale, appName, t, tStatus, hasStatus, dateFmt, dateTimeFmt, numberFmt, listFmt],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

export function useT() {
  return useI18n().t;
}
