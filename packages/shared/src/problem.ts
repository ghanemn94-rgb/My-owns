// RFC 9457 problem details (ADR-0007). `type` values are URNs so no external host is implied.
// The web client maps `code` to a translated message (ar/en); `title`/`detail` are English diagnostics only.

export const PROBLEM_TYPES = {
  validation: "urn:mth:problem:validation",
  unauthenticated: "urn:mth:problem:unauthenticated",
  forbidden: "urn:mth:problem:forbidden",
  notFound: "urn:mth:problem:not-found",
  versionConflict: "urn:mth:problem:version-conflict",
  preconditionRequired: "urn:mth:problem:precondition-required",
  invalidTransition: "urn:mth:problem:invalid-transition",
  duplicate: "urn:mth:problem:duplicate",
  csrf: "urn:mth:problem:csrf",
  rateLimited: "urn:mth:problem:rate-limited",
  unavailable: "urn:mth:problem:unavailable",
  internal: "urn:mth:problem:internal",
} as const;
export type ProblemType = (typeof PROBLEM_TYPES)[keyof typeof PROBLEM_TYPES];

export interface FieldError {
  /** RFC 6901 JSON pointer into the request body or `/query/<name>` for query parameters. */
  readonly pointer: string;
  /** Stable i18n key, e.g. `validation.required`. */
  readonly code: string;
  readonly message: string;
}

export interface ProblemDetails {
  readonly type: ProblemType;
  readonly title: string;
  readonly status: number;
  readonly detail?: string;
  readonly instance?: string;
  /** Stable machine code, also the i18n key suffix (`problem.<code>`). */
  readonly code: string;
  readonly requestId: string;
  readonly errors?: readonly FieldError[];
  /** Present on 409 version-conflict: the version the server currently holds. */
  readonly currentVersion?: number;
}
