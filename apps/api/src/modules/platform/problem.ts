// RFC 9457 problem details as a throwable (ADR-0007). Handlers throw HttpProblem; the error handler renders it as
// application/problem+json with `code` (i18n key suffix) and `requestId`. Nothing internal is ever leaked.
import { PROBLEM_TYPES, type FieldError, type ProblemDetails, type ProblemType } from "@mth/shared";

/** Set when the policy function denied an existing target; used to audit failed authorization of mutations. */
export interface DenialInfo {
  readonly permission: string;
  readonly recordType: string;
  readonly recordId: string;
  readonly organizationId: string | null;
  readonly transformationId: string | null;
}

export class HttpProblem extends Error {
  readonly status: number;
  readonly type: ProblemType;
  readonly code: string;
  readonly title: string;
  readonly detail: string | undefined;
  readonly errors: readonly FieldError[] | undefined;
  readonly currentVersion: number | undefined;
  denial: DenialInfo | undefined;

  constructor(init: {
    status: number;
    type: ProblemType;
    code: string;
    title: string;
    detail?: string;
    errors?: readonly FieldError[];
    currentVersion?: number;
  }) {
    super(init.detail ?? init.title);
    this.name = "HttpProblem";
    this.status = init.status;
    this.type = init.type;
    this.code = init.code;
    this.title = init.title;
    this.detail = init.detail;
    this.errors = init.errors;
    this.currentVersion = init.currentVersion;
  }

  withDenial(denial: DenialInfo): this {
    this.denial = denial;
    return this;
  }

  toBody(requestId: string, instance?: string): ProblemDetails {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      ...(this.detail !== undefined ? { detail: this.detail } : {}),
      ...(instance !== undefined ? { instance } : {}),
      code: this.code,
      requestId,
      ...(this.errors !== undefined ? { errors: this.errors } : {}),
      ...(this.currentVersion !== undefined ? { currentVersion: this.currentVersion } : {}),
    };
  }
}

export const problems = {
  validation: (errors: readonly FieldError[], detail = "The request is not valid.") =>
    new HttpProblem({
      status: 400,
      type: PROBLEM_TYPES.validation,
      code: "validation",
      title: "Validation failed",
      detail,
      errors,
    }),
  badRequest: (code: string, detail: string, pointer = "") =>
    new HttpProblem({
      status: 400,
      type: PROBLEM_TYPES.validation,
      code: "validation",
      title: "Validation failed",
      detail,
      errors: [{ pointer, code, message: detail }],
    }),
  unauthenticated: () =>
    new HttpProblem({
      status: 401,
      type: PROBLEM_TYPES.unauthenticated,
      code: "unauthenticated",
      title: "Sign-in required",
    }),
  loginFailed: () =>
    new HttpProblem({
      status: 401,
      type: PROBLEM_TYPES.unauthenticated,
      code: "auth.login_failed",
      title: "Sign-in failed",
    }),
  forbidden: (detail = "You do not have permission for this action.") =>
    new HttpProblem({ status: 403, type: PROBLEM_TYPES.forbidden, code: "forbidden", title: "Forbidden", detail }),
  csrf: (detail: string) =>
    new HttpProblem({ status: 403, type: PROBLEM_TYPES.csrf, code: "csrf", title: "CSRF check failed", detail }),
  notFound: () => new HttpProblem({ status: 404, type: PROBLEM_TYPES.notFound, code: "not_found", title: "Not found" }),
  versionConflict: (currentVersion: number) =>
    new HttpProblem({
      status: 409,
      type: PROBLEM_TYPES.versionConflict,
      code: "version_conflict",
      title: "Version conflict",
      detail: "The record was changed by someone else. Review the current version and re-apply your change.",
      currentVersion,
    }),
  duplicate: (code: string, detail: string) =>
    new HttpProblem({ status: 409, type: PROBLEM_TYPES.duplicate, code, title: "Duplicate", detail }),
  businessRule: (code: string, detail: string) =>
    new HttpProblem({ status: 422, type: PROBLEM_TYPES.validation, code, title: "Business rule violated", detail }),
  invalidTransition: (detail: string) =>
    new HttpProblem({
      status: 422,
      type: PROBLEM_TYPES.invalidTransition,
      code: "invalid_transition",
      title: "Invalid transition",
      detail,
    }),
  preconditionRequired: () =>
    new HttpProblem({
      status: 428,
      type: PROBLEM_TYPES.preconditionRequired,
      code: "precondition_required",
      title: "If-Match required",
      detail: 'Send the ETag of the version you are changing in If-Match, e.g. If-Match: "3".',
    }),
  /** Node's request timeout (connection level, before routing; T-DG2-BE12). */
  requestTimeout: () =>
    new HttpProblem({
      status: 408,
      type: PROBLEM_TYPES.validation,
      code: "request_timeout",
      title: "Request timeout",
      detail: "The request was not received completely in time.",
    }),
  rateLimited: () =>
    new HttpProblem({ status: 429, type: PROBLEM_TYPES.rateLimited, code: "rate_limited", title: "Too many requests" }),
  unavailable: () =>
    new HttpProblem({
      status: 503,
      type: PROBLEM_TYPES.unavailable,
      code: "unavailable",
      title: "Service unavailable",
    }),
  internal: () =>
    new HttpProblem({ status: 500, type: PROBLEM_TYPES.internal, code: "internal", title: "Internal error" }),
};
