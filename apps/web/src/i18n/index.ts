// i18n (ADR-0009 §2, REQ-S15-007). Two catalogues with identical key sets (tested): Arabic (RTL, default) and English
// (LTR). Each locale is split into namespace files that are merged into one resource per locale.
// The locale choice: /me `preferredLocale` after sign-in (persisted with PUT /me/preferences), and localStorage as
// the pre-sign-in hint. `public/locale-boot.js` applies the stored hint to <html lang dir> before first paint.
import i18next, { type i18n as I18n } from "i18next";
import { initReactI18next } from "react-i18next";
import { DEFAULTS, LOCALES, type Locale } from "@mth/shared";
import arAdmin from "./ar/admin.json" with { type: "json" };
import arDecisions from "./ar/decisions.json" with { type: "json" };
import arDefine from "./ar/define.json" with { type: "json" };
import arDesign from "./ar/design.json" with { type: "json" };
import arDiagnose from "./ar/diagnose.json" with { type: "json" };
import arEvidence from "./ar/evidence.json" with { type: "json" };
import arGates from "./ar/gates.json" with { type: "json" };
import arKpi from "./ar/kpi.json" with { type: "json" };
import arAuth from "./ar/auth.json" with { type: "json" };
import arCommon from "./ar/common.json" with { type: "json" };
import arNav from "./ar/nav.json" with { type: "json" };
import arProblems from "./ar/problems.json" with { type: "json" };
import arTeam from "./ar/team.json" with { type: "json" };
import arTransformations from "./ar/transformations.json" with { type: "json" };
import enAdmin from "./en/admin.json" with { type: "json" };
import enDecisions from "./en/decisions.json" with { type: "json" };
import enDefine from "./en/define.json" with { type: "json" };
import enDesign from "./en/design.json" with { type: "json" };
import enDiagnose from "./en/diagnose.json" with { type: "json" };
import enEvidence from "./en/evidence.json" with { type: "json" };
import enGates from "./en/gates.json" with { type: "json" };
import enKpi from "./en/kpi.json" with { type: "json" };
import enAuth from "./en/auth.json" with { type: "json" };
import enCommon from "./en/common.json" with { type: "json" };
import enNav from "./en/nav.json" with { type: "json" };
import enProblems from "./en/problems.json" with { type: "json" };
import enTeam from "./en/team.json" with { type: "json" };
import enTransformations from "./en/transformations.json" with { type: "json" };

/** Namespace files per locale; the key-parity test walks exactly these. */
export const catalogues = {
  ar: {
    common: arCommon,
    nav: arNav,
    auth: arAuth,
    transformations: arTransformations,
    admin: arAdmin,
    problems: arProblems,
    diagnose: arDiagnose,
    kpi: arKpi,
    define: arDefine,
    design: arDesign,
    decisions: arDecisions,
    gates: arGates,
    evidence: arEvidence,
    team: arTeam,
  },
  en: {
    common: enCommon,
    nav: enNav,
    auth: enAuth,
    transformations: enTransformations,
    admin: enAdmin,
    problems: enProblems,
    diagnose: enDiagnose,
    kpi: enKpi,
    define: enDefine,
    design: enDesign,
    decisions: enDecisions,
    gates: enGates,
    evidence: enEvidence,
    team: enTeam,
  },
} as const;

export const LOCALE_STORAGE_KEY = "mth.locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function directionOf(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

export function storedLocale(): Locale | null {
  try {
    const v = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

export function rememberLocale(locale: Locale): void {
  try {
    globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage may be disabled; the server preference still persists the choice after sign-in.
  }
}

/** Sets <html lang dir> (ADR-0009: logical CSS then mirrors the whole layout). */
export function applyDocumentLocale(locale: Locale, doc: Document = document): void {
  doc.documentElement.lang = locale;
  doc.documentElement.dir = directionOf(locale);
}

export function initialLocale(): Locale {
  return storedLocale() ?? (DEFAULTS.locale satisfies Locale);
}

export function createI18n(locale: Locale = initialLocale()): I18n {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    resources: {
      ar: { translation: catalogues.ar },
      en: { translation: catalogues.en },
    },
    lng: locale,
    fallbackLng: false, // a missing key must be visible in tests, never silently English in an Arabic screen
    supportedLngs: [...LOCALES],
    interpolation: { escapeValue: false }, // React escapes
    returnNull: false,
    initAsync: false,
  });
  instance.on("languageChanged", (lng) => {
    if (isLocale(lng) && typeof document !== "undefined") applyDocumentLocale(lng);
  });
  if (typeof document !== "undefined") applyDocumentLocale(locale);
  return instance;
}

export function currentLocale(instance: I18n): Locale {
  return isLocale(instance.language) ? instance.language : DEFAULTS.locale;
}
