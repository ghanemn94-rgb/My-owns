'use client';

import type { ServerMessageDto } from '@hub/contracts';
import { useI18n } from '@/i18n/provider';
import { langAttrs, useLocalizedText, useServerMessages } from '@/lib/i18n-data';

/**
 * Bilingual server data (`<field>` + `<field>Ar`) in the active locale. When the Arabic UI has to fall back to the
 * English text, the span is marked `lang="en" dir="ltr"` so screen readers switch voice (WCAG 3.1.2); otherwise it only
 * isolates the direction (`dir="auto"`).
 */
export function LocalizedText({ text, textAr, className }: { text: string | null | undefined; textAr: string | null | undefined; className?: string }) {
  const pick = useLocalizedText();
  const { text: shown, lang } = pick(text, textAr);
  if (!shown) return null;
  return (
    <span className={className} {...lang}>
      {shown}
    </span>
  );
}

/**
 * Server-computed explanation: translated from its codes (`<field>I18n`), or — when the server sent no codes — the
 * English sentence, marked `lang="en"` in the Arabic UI.
 */
export function ServerMessageText({
  messages,
  fallback,
  className,
}: {
  messages: readonly ServerMessageDto[] | null | undefined;
  fallback: string | null | undefined;
  className?: string;
}) {
  const { locale } = useI18n();
  const serverText = useServerMessages();
  const shown = serverText(messages, fallback);
  if (!shown) return null;
  const translated = Boolean(messages && messages.length > 0);
  return (
    <span className={className} {...(translated ? {} : langAttrs(locale, shown, true))}>
      {shown}
    </span>
  );
}
