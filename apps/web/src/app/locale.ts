// Current UI locale and localized-name helpers.
import { useTranslation } from "react-i18next";
import type { Locale } from "@mth/shared";
import { isLocale } from "../i18n/index.ts";

export function useLocale(): Locale {
  const { i18n } = useTranslation();
  return isLocale(i18n.language) ? i18n.language : "ar";
}

/** An arrow pointing in the reading direction ("from → to" in English, "from ← to" in Arabic). */
export function useForwardArrow(): string {
  return useLocale() === "ar" ? "←" : "→";
}

/** Picks the Arabic or English name of a bilingual record. */
export function localName(
  record: { nameEn: string; nameAr: string } | null | undefined,
  locale: Locale,
): string | null {
  if (!record) return null;
  return locale === "ar" ? record.nameAr : record.nameEn;
}
