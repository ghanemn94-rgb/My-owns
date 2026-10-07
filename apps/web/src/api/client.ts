// Thin typed fetch wrapper (ADR-0009 §1, ADR-0005, ADR-0007).
//  - same-origin cookies (the session cookie is HttpOnly; the browser never sees tokens);
//  - `X-CSRF-Token` on every unsafe method, from the latest GET /api/v1/me;
//  - `If-Match: "<version>"` for versioned changes, `Idempotency-Key` for creates;
//  - problem+json bodies become a typed ApiError whose `code` the UI translates (ar/en).
import type { FieldError, ProblemDetails } from "@mth/shared";

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails | null;

  constructor(status: number, problem: ProblemDetails | null, message?: string) {
    super(message ?? problem?.title ?? `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
  }

  get code(): string | null {
    return this.problem?.code ?? null;
  }
  get requestId(): string | null {
    return this.problem?.requestId ?? null;
  }
  get fieldErrors(): readonly FieldError[] {
    return this.problem?.errors ?? [];
  }
  get currentVersion(): number | null {
    return this.problem?.currentVersion ?? null;
  }
  get isConflict(): boolean {
    return this.status === 409 && this.problem?.type === "urn:mth:problem:version-conflict";
  }
}

/** Network failure (no HTTP response at all): offline, server down, proxy error. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super("network error", { cause });
    this.name = "NetworkError";
  }
}

let csrfToken: string | null = null;

/** Set from GET /api/v1/me (ADR-0005 §4). */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

// ------------------------------------------------------------------------------------------------ session phase
// F-DG2-480: one rule for "the session has ended". The phase is module state (not React Query state), so a stale cached
// identity can never contradict it:
//  - "unknown": no session confirmed in this tab (first load, or after signing out here);
//  - "active": the last GET /me succeeded;
//  - "ended": a request answered 401 `unauthenticated` while the session was active (revoked, signed out in another
//    tab, idle/absolute expiry, the D-073 commit-time refusal). <RequireSession> reacts to it: it clears the cached
//    identity and every session-scoped query once (claimSessionEnd) and navigates once to the sign-in page. The next
//    successful GET /me (signing in again) makes the phase "active" again.
// A 403 (forbidden, CSRF) is never a session end, and neither is a 401 with another code (e.g. auth.login_failed).
export type SessionPhase = "unknown" | "active" | "ended";

let sessionPhase: SessionPhase = "unknown";
let sessionEndClaimed = false;
const phaseListeners = new Set<() => void>();

function setPhase(next: SessionPhase): void {
  if (next === sessionPhase) return;
  sessionPhase = next;
  phaseListeners.forEach((l) => l());
}

export function getSessionPhase(): SessionPhase {
  return sessionPhase;
}

/** For useSyncExternalStore. */
export function subscribeSessionPhase(listener: () => void): () => void {
  phaseListeners.add(listener);
  return () => phaseListeners.delete(listener);
}

/** A GET /me succeeded: a session exists (again). */
export function markSessionActive(): void {
  setPhase("active");
}

/** Signed out in this tab on purpose: later 401s are expected and not a "session ended" event. */
export function markSignedOut(): void {
  csrfToken = null;
  setPhase("unknown");
}

/** True for the API's "your session is not valid" answer: 401 `unauthenticated` (or a 401 without a problem body). */
export function isSessionEndedError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401 && (err.problem === null || err.code === "unauthenticated");
}

function endSession(): void {
  if (sessionPhase !== "active") return; // never signed in here, already ended, or signed out on purpose
  csrfToken = null;
  sessionEndClaimed = false;
  setPhase("ended");
}

/**
 * The first caller after a session end gets true and clears the session-scoped cache; every later caller (a StrictMode
 * re-run, a remount after the back button) gets false.
 */
export function claimSessionEnd(): boolean {
  if (sessionPhase !== "ended" || sessionEndClaimed) return false;
  sessionEndClaimed = true;
  return true;
}

/** Test isolation only: module state survives between tests in one file. */
export function resetSessionStateForTests(): void {
  csrfToken = null;
  sessionPhase = "unknown";
  sessionEndClaimed = false;
}

export interface RequestOptions {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly body?: unknown;
  readonly query?: Readonly<Record<string, string | number | boolean | readonly string[] | null | undefined>>;
  /** Version of the representation being changed; sent as a strong ETag in If-Match. */
  readonly ifMatch?: number;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
  /**
   * A 401 from this request is not a session end (the sign-in form, its contract probe and sign-out, whose 401 means
   * "already signed out").
   */
  readonly silent401?: boolean;
  /**
   * Raw request body (file upload, application/octet-stream). Mutually exclusive with `body`; the bytes are sent
   * as-is with `contentType`.
   */
  readonly rawBody?: Blob;
  readonly contentType?: string;
  /** Extra request headers (e.g. X-File-Name for an evidence upload). Never credentials. */
  readonly headers?: Readonly<Record<string, string>>;
}

export function buildUrl(path: string, query?: RequestOptions["query"]): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    if (Array.isArray(value)) for (const v of value) params.append(key, String(v));
    else params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

function isProblem(value: unknown): value is ProblemDetails {
  return typeof value === "object" && value !== null && "status" in value && "code" in value && "type" in value;
}

export interface ApiResponse<T> {
  readonly data: T;
  readonly status: number;
  readonly etag: string | null;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<ApiResponse<T>> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = {
    ...options.headers,
    Accept: "application/json, application/problem+json",
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  else if (options.rawBody !== undefined) headers["Content-Type"] = options.contentType ?? "application/octet-stream";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  if (options.ifMatch !== undefined) headers["If-Match"] = `"${options.ifMatch}"`;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      credentials: "same-origin",
      ...(options.body !== undefined
        ? { body: JSON.stringify(options.body) }
        : options.rawBody !== undefined
          ? { body: options.rawBody }
          : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (err) {
    if ((err as { name?: string }).name === "AbortError") throw err;
    throw new NetworkError(err);
  }

  const text = response.status === 204 ? "" : await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) {
    const problem = isProblem(parsed) ? parsed : null;
    const error = new ApiError(response.status, problem);
    if (!options.silent401 && isSessionEndedError(error)) endSession();
    throw error;
  }
  return { data: parsed as T, status: response.status, etag: response.headers.get("ETag") };
}

export const api = {
  get: async <T>(path: string, query?: RequestOptions["query"], signal?: AbortSignal): Promise<T> =>
    (await apiRequest<T>(path, { ...(query ? { query } : {}), ...(signal ? { signal } : {}) })).data,
  send: async <T>(path: string, options: RequestOptions): Promise<T> => (await apiRequest<T>(path, options)).data,
};

/** A new idempotency key (UUID) for a create form; reused on retries of the same submission. */
export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}
