// Shared domain constants (ADR-0002, ADR-0003). Dependency-free: safe to import from API, worker and web.
// Values are stable storage codes; user-facing labels live in the web i18n catalogues (ar, en).

/** The six playbook phases (B0021), in order. Storage codes, not display labels. */
export const PHASES = ["diagnose", "define", "design", "mobilize", "transform", "realize"] as const;
export type Phase = (typeof PHASES)[number];

/** Source usage modes (B0009, REQ-PB-003). */
export const TRANSFORMATION_MODES = ["end_to_end", "modular"] as const;
export type TransformationMode = (typeof TRANSFORMATION_MODES)[number];

/** P1 lifecycle status of a transformation record. Archiving is a separate flag (ADR-0003 retention). */
export const TRANSFORMATION_STATUSES = ["draft", "active", "on_hold", "closed"] as const;
export type TransformationStatus = (typeof TRANSFORMATION_STATUSES)[number];

/** Explicit status transitions (REQ-S16-023). Anything not listed is rejected server-side with 422. */
export const TRANSFORMATION_STATUS_TRANSITIONS: Readonly<Record<TransformationStatus, readonly TransformationStatus[]>> = {
  draft: ["active"],
  active: ["on_hold", "closed"],
  on_hold: ["active", "closed"],
  closed: [],
};

/** Optional standalone deliverable for Modular entry (B0008). */
export const STANDALONE_DELIVERABLE_TYPES = ["target_operating_model", "initiative_business_case", "benefits_register"] as const;
export type StandaloneDeliverableType = (typeof STANDALONE_DELIVERABLE_TYPES)[number];

/**
 * Scope types of a scoped role assignment (ADR-0006). P1 implements the first three; the others are reserved
 * so the column constraint and the policy function do not need a breaking change later.
 */
export const SCOPE_TYPES = [
  "organization",
  "business_unit",
  "transformation",
  "portfolio",
  "workstream",
  "initiative",
  "performance_area",
  "forum",
  "record",
] as const;
export type ScopeType = (typeof SCOPE_TYPES)[number];
export const P1_SCOPE_TYPES = ["organization", "business_unit", "transformation"] as const satisfies readonly ScopeType[];

export const LOCALES = ["ar", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Configurable defaults (REQ-S15-008, REQ-S01-002). Runtime overrides come from @mth/config / organization rows. */
export const DEFAULTS = {
  productName: "Mobily Transformation Hub",
  timezone: "Asia/Riyadh",
  currency: "SAR",
  locale: "ar",
} as const satisfies { productName: string; timezone: string; currency: string; locale: Locale };

/** Pagination limits (ADR-0007). */
export const PAGINATION = { defaultLimit: 25, maxLimit: 100 } as const;
