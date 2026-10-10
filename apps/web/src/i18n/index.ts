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
// P3 (DG3) namespaces: one per page area, each owned by its FE task (p3-work-split §4).
import arPortfolio from "./ar/portfolio.json" with { type: "json" };
import arReadiness from "./ar/readiness.json" with { type: "json" };
import arDispensations from "./ar/dispensations.json" with { type: "json" };
import arPrioritization from "./ar/prioritization.json" with { type: "json" };
import arRoadmap from "./ar/roadmap.json" with { type: "json" };
import arDependencies from "./ar/dependencies.json" with { type: "json" };
import arCapacity from "./ar/capacity.json" with { type: "json" };
import arBusinessCases from "./ar/businessCases.json" with { type: "json" };
import arBenefitFormulas from "./ar/benefitFormulas.json" with { type: "json" };
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
import enPortfolio from "./en/portfolio.json" with { type: "json" };
import enReadiness from "./en/readiness.json" with { type: "json" };
// P4 slices I and C namespaces (T-DG4-FE-A).
import arMyWorkP4 from "./ar/myWork.json" with { type: "json" };
import arApprovalsP4 from "./ar/approvals.json" with { type: "json" };
import arDelegationsP4 from "./ar/delegations.json" with { type: "json" };
import arCalendarP4 from "./ar/calendar.json" with { type: "json" };
import arGroupsP4 from "./ar/groups.json" with { type: "json" };
import arDecisionRightsP4 from "./ar/decisionRights.json" with { type: "json" };
import arRaciP4 from "./ar/raci.json" with { type: "json" };
import enMyWorkP4 from "./en/myWork.json" with { type: "json" };
import enApprovalsP4 from "./en/approvals.json" with { type: "json" };
import enDelegationsP4 from "./en/delegations.json" with { type: "json" };
import enCalendarP4 from "./en/calendar.json" with { type: "json" };
import enGroupsP4 from "./en/groups.json" with { type: "json" };
import enDecisionRightsP4 from "./en/decisionRights.json" with { type: "json" };
import enRaciP4 from "./en/raci.json" with { type: "json" };
// P4 slice A namespace (T-DG4-FE-B): the KPI engine screens (pages/kpi).
import arKpiP4 from "./ar/kpiP4.json" with { type: "json" };
import enKpiP4 from "./en/kpiP4.json" with { type: "json" };
import arBenefitsP4 from "./ar/benefitsP4.json" with { type: "json" };
import enBenefitsP4 from "./en/benefitsP4.json" with { type: "json" };
import arRaidP4 from "./ar/raidP4.json" with { type: "json" };
import enRaidP4 from "./en/raidP4.json" with { type: "json" };
import arGovernanceP4 from "./ar/governanceP4.json" with { type: "json" };
import enGovernanceP4 from "./en/governanceP4.json" with { type: "json" };
import arAdoptionP4 from "./ar/adoptionP4.json" with { type: "json" };
import enAdoptionP4 from "./en/adoptionP4.json" with { type: "json" };
import arSustainP4 from "./ar/sustainP4.json" with { type: "json" };
import enSustainP4 from "./en/sustainP4.json" with { type: "json" };
// P4 slice J namespace (T-DG4-FE-G): dashboards, Executive Overview, workspace header, My Work sections.
import arDashboards from "./ar/dashboards.json" with { type: "json" };
import enDashboards from "./en/dashboards.json" with { type: "json" };
// P4 slice E execution panels on the initiative page (T-DG4-FE-D2): budget lines, execution, schedule network.
import arExecutionP4 from "./ar/executionP4.json" with { type: "json" };
import enExecutionP4 from "./en/executionP4.json" with { type: "json" };
import enDispensations from "./en/dispensations.json" with { type: "json" };
import enPrioritization from "./en/prioritization.json" with { type: "json" };
import enRoadmap from "./en/roadmap.json" with { type: "json" };
import enDependencies from "./en/dependencies.json" with { type: "json" };
import enCapacity from "./en/capacity.json" with { type: "json" };
import enBusinessCases from "./en/businessCases.json" with { type: "json" };
import enBenefitFormulas from "./en/benefitFormulas.json" with { type: "json" };

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
    portfolio: arPortfolio,
    readiness: arReadiness,
    dispensations: arDispensations,
    prioritization: arPrioritization,
    roadmap: arRoadmap,
    dependencies: arDependencies,
    capacity: arCapacity,
    businessCases: arBusinessCases,
    benefitFormulas: arBenefitFormulas,
    myWork: arMyWorkP4,
    approvals: arApprovalsP4,
    delegations: arDelegationsP4,
    calendar: arCalendarP4,
    groups: arGroupsP4,
    decisionRights: arDecisionRightsP4,
    raci: arRaciP4,
    kpiP4: arKpiP4,
    benefitsP4: arBenefitsP4,
    raidP4: arRaidP4,
    governanceP4: arGovernanceP4,
    adoptionP4: arAdoptionP4,
    sustainP4: arSustainP4,
    dashboards: arDashboards,
    executionP4: arExecutionP4,
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
    portfolio: enPortfolio,
    readiness: enReadiness,
    dispensations: enDispensations,
    prioritization: enPrioritization,
    roadmap: enRoadmap,
    dependencies: enDependencies,
    capacity: enCapacity,
    businessCases: enBusinessCases,
    benefitFormulas: enBenefitFormulas,
    myWork: enMyWorkP4,
    approvals: enApprovalsP4,
    delegations: enDelegationsP4,
    calendar: enCalendarP4,
    groups: enGroupsP4,
    decisionRights: enDecisionRightsP4,
    raci: enRaciP4,
    kpiP4: enKpiP4,
    benefitsP4: enBenefitsP4,
    raidP4: enRaidP4,
    governanceP4: enGovernanceP4,
    adoptionP4: enAdoptionP4,
    sustainP4: enSustainP4,
    dashboards: enDashboards,
    executionP4: enExecutionP4,
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
