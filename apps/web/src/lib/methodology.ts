// Bilingual methodology labels (ADR-0016 §2). The catalogue carries the playbook's source text verbatim in English and
// a provisional Arabic translation; the UI shows the one of the current language.
import type { Locale } from "@mth/shared";
import type { GateDefinition, MethodologyCatalogue } from "../api/types.ts";

export const pick = (locale: Locale, en: string, ar: string): string => (locale === "ar" ? ar : en);

export function diagnosticDimensionLabel(m: MethodologyCatalogue, code: string, locale: Locale): string | null {
  const d = m.diagnosticDimensions.find((x) => x.code === code);
  return d ? pick(locale, d.labelEn, d.labelAr) : null;
}

export function workstreamName(m: MethodologyCatalogue, code: string | null, locale: Locale): string | null {
  const w = code ? m.diagnosticWorkstreams.find((x) => x.code === code) : undefined;
  return w ? pick(locale, w.sourceNameEn, w.nameAr) : null;
}

export function tomDimensionLabel(m: MethodologyCatalogue, code: string | null, locale: Locale): string | null {
  const d = code ? m.tomDimensions.find((x) => x.code === code) : undefined;
  return d ? pick(locale, d.labelEn, d.labelAr) : null;
}

/**
 * The ONE place a product gate's display name is composed (F-DG2-151, REQ-PB-017 / B0023). The catalogue carries the
 * verbatim B0023 gate name, which already contains the code ("G2 - Direction" / "G2 - التوجّه"), so it is shown
 * exactly once, as given: never prefixed with the code again, never stripped or rebuilt.
 */
export function gateLabel(def: Pick<GateDefinition, "sourceNameEn" | "nameAr">, locale: Locale): string {
  return pick(locale, def.sourceNameEn, def.nameAr);
}

/** The gate name for a code from the catalogue; the bare code when the catalogue has no such gate. */
export function gateName(m: MethodologyCatalogue, code: string, locale: Locale): string {
  const g = m.gateDefinitions.find((x) => x.code === code);
  return g ? gateLabel(g, locale) : code;
}

/** Options for a TOM-dimension <select>, in source order. */
export function tomDimensionOptions(m: MethodologyCatalogue, locale: Locale) {
  return [...m.tomDimensions]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((d) => ({ value: d.code, label: pick(locale, d.labelEn, d.labelAr) }));
}

export function workstreamOptions(m: MethodologyCatalogue, locale: Locale) {
  return [...m.diagnosticWorkstreams]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((w) => ({ value: w.code, label: pick(locale, w.sourceNameEn, w.nameAr) }));
}
