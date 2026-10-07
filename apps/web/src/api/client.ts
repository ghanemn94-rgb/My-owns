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

/**
 * F-DG2-530: the answer to a request that was SENT under another session generation than the current one (the session
 * ended, this tab signed out, or GET /me returned another identity in between). Its data belongs to the previous
 * identity, so the client never returns it: no caller can write it into the cache, navigate on it or show it. Callers
 * treat it as silent (no error banner, no navigation): the identity change has already reset the session state.
 */
export class SessionChangedError extends Error {
  readonly sentGeneration: number;
  readonly currentGeneration: number;

  constructor(sentGeneration: number, currentGeneration: number) {
    super("session changed while the request was in flight");
    this.name = "SessionChangedError";
    this.sentGeneration = sentGeneration;
    this.currentGeneration = currentGeneration;
  }
}

export function isSessionChangedError(err: unknown): err is SessionChangedError {
  return err instanceof SessionChangedError;
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
//    tab, idle/absolute expiry, the D-073 commit-time refusal). <RequireSession> reacts to it by navigating once to the
//    sign-in page. The next successful GET /me (signing in again) makes the phase "active" again.
// A 403 (forbidden, CSRF) is never a session end, and neither is a 401 with another code (e.g. auth.login_failed).
//
// F-DG2-500: the session-scoped cache is cleared HERE, in the same place as the transition, whatever page is mounted
// (the sign-in page included): endSession() and noteSessionIdentity() call the registered session-reset hooks
// synchronously, before the error (or the new identity) reaches any component. The app registers one hook per
// QueryClient (app/App.tsx createQueryClient), so no component has to be mounted for the cache to be cleared.
export type SessionPhase = "unknown" | "active" | "ended";

/**
 * Why the session-scoped state is being reset:
 *  - "ended": the session ended (401 `unauthenticated` while active); drop the cached identity and every query;
 *  - "identity-changed": GET /me returned another user or another session than the last one this document saw; drop
 *    every query except GET /me itself, whose new answer is about to be stored.
 */
export type SessionResetReason = "ended" | "identity-changed";
export type SessionResetHook = (reason: SessionResetReason) => void;

let sessionPhase: SessionPhase = "unknown";
/**
 * F-DG2-530: the session generation. Every request records it when it is sent; it moves on every session end, every
 * sign-out here and every identity change, BEFORE the reset hooks run. An answer that arrives under a later generation
 * becomes a SessionChangedError (see apiRequest).
 */
let sessionGeneration = 0;
/** The last identity GET /me returned in this document: organization, user and session (see sessionIdentityKey). */
let lastIdentity: string | null = null;
const phaseListeners = new Set<() => void>();
const resetHooks = new Set<SessionResetHook>();

function setPhase(next: SessionPhase): void {
  if (next === sessionPhase) return;
  sessionPhase = next;
  phaseListeners.forEach((l) => l());
}

/** The current session generation (tests and diagnostics). */
export function getSessionGeneration(): number {
  return sessionGeneration;
}

function nextSessionGeneration(): void {
  sessionGeneration += 1;
}

export function getSessionPhase(): SessionPhase {
  return sessionPhase;
}

/** For useSyncExternalStore. */
export function subscribeSessionPhase(listener: () => void): () => void {
  phaseListeners.add(listener);
  return () => phaseListeners.delete(listener);
}

/**
 * Registers a hook that clears session-scoped client state (the app wires its QueryClient). It runs synchronously on
 * every session end and every identity change, whatever is mounted. Returns the unregister function.
 */
export function registerSessionReset(hook: SessionResetHook): () => void {
  resetHooks.add(hook);
  return () => resetHooks.delete(hook);
}

function runSessionReset(reason: SessionResetReason): void {
  resetHooks.forEach((hook) => hook(reason));
}

/** A GET /me succeeded: a session exists (again). */
export function markSessionActive(): void {
  lastMeAt = Date.now(); // F-DG2-570: the identity was just confirmed
  setPhase("active");
}

/** Signed out in this tab on purpose: later 401s are expected and not a "session ended" event. */
export function markSignedOut(): void {
  csrfToken = null;
  nextSessionGeneration();
  setPhase("unknown");
}

/**
 * The identity of a GET /me answer: organization, user and session. The CSRF token stands for the session: the API
 * derives it from the session token (apps/api identity/sessions.ts csrfTokenFor), so a new session (another user, or
 * the same user signed in again elsewhere) has a new one. Kept only in memory, like the token itself.
 */
export function sessionIdentityKey(me: {
  readonly user: { readonly id: string; readonly organizationId: string };
  readonly csrfToken: string;
}): string {
  return `${me.user.organizationId}\u0000${me.user.id}\u0000${me.csrfToken}`;
}

/**
 * Called with every GET /me answer BEFORE it is stored or rendered. When it is another identity than the last one this
 * document saw, every session-scoped query is removed first (defence in depth: also covers an identity change that no
 * 401 announced, e.g. a sign-out and another user's sign-in in another tab, noticed by a refocus /me here).
 */
export function noteSessionIdentity(key: string): void {
  const previous = lastIdentity;
  lastIdentity = key;
  if (previous !== null && previous !== key) {
    // F-DG2-530: answers to requests sent under the previous identity can no longer be returned to any caller.
    nextSessionGeneration();
    runSessionReset("identity-changed");
  }
}

/** The last identity seen by this document (test and diagnostics only). */
export function getLastSessionIdentity(): string | null {
  return lastIdentity;
}

/** True for the API's "your session is not valid" answer: 401 `unauthenticated` (or a 401 without a problem body). */
export function isSessionEndedError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401 && (err.problem === null || err.code === "unauthenticated");
}

function endSession(): void {
  if (sessionPhase !== "active") return; // never signed in here, already ended, or signed out on purpose
  csrfToken = null;
  nextSessionGeneration(); // F-DG2-530: nothing sent under the ended session is returned to a caller any more
  // F-DG2-500: clear the session-scoped cache here, before any component can observe the phase (and whichever page is
  // mounted), then announce the end.
  runSessionReset("ended");
  setPhase("ended");
}

// ------------------------------------------------------------------------------------------------ identity recheck
// F-DG2-570 (T-DG2-FE15): the header (the identity of the last GET /me) and the page data must belong to one identity,
// also on in-app navigation and inside the query fresh window. The session cookie is HttpOnly and the CSRF token is
// not in a cookie, so a sign-out and another sign-in in another tab cannot be seen from here without asking the server.
// Rules:
//  1. every in-app navigation (another path) revalidates GET /me before the new page's data is fetched
//     (revalidateSessionIdentity, called by auth/session.tsx <RequireSession>);
//  2. any other GET for page data that would be sent more than SESSION_RECHECK_MS after the last GET /me (a filter,
//     a page of results, a refetch after a write) revalidates GET /me first too.
// The check goes through the app's query cache, so the header follows the same answer. Every GET sent while a check or
// any other GET /me is in flight waits for it, and a GET whose session generation moved while it waited is never sent
// (SessionChangedError): if /me returned another identity, the reset has already removed the previous identity's
// queries and the new subtree fetches its own.
//  - bounded: one /me per in-app navigation (shared by the page's whole burst of requests and joined with a /me already
//    in flight); otherwise at most one per SESSION_RECHECK_MS while the page is making requests, none while it is idle;
//    every /me (a focus revalidation, the session gate, a permission refresh) restarts the window;
//  - unsafe methods (writes) neither trigger nor wait for it: they are sent as before with the CSRF token of the
//    identity the user acted under, so a write never goes out for an identity the user did not act as (another
//    session's cookie refuses it with 403 csrf, which is never a session end);
//  - residual (stated in the handback): another sign-in less than SESSION_RECHECK_MS after the last /me, followed by
//    a request that is NOT a navigation inside that window, is detected by the next navigation, the next request after
//    the window, or a refocus.

/** How old the last GET /me may be when a page GET is sent before /me is revalidated first. */
export const SESSION_RECHECK_MS = 2_000;

type SessionCheckRunner = () => Promise<unknown>;
const checkRunners = new Set<SessionCheckRunner>();
let pendingCheck: Promise<void> | null = null;
/** When the last GET /me was sent or answered (ms since epoch), whichever is later. */
let lastMeAt = Number.NEGATIVE_INFINITY;

/**
 * Registers how this app revalidates GET /me (the app wires its QueryClient, so the cached identity, and with it the
 * header, is updated by the same answer). Returns the unregister function.
 */
export function registerSessionCheck(run: SessionCheckRunner): () => void {
  checkRunners.add(run);
  return () => checkRunners.delete(run);
}

/**
 * Revalidates GET /me now (joining one already in flight), whatever its age: page GETs sent meanwhile wait for it.
 * Used on every in-app navigation (auth/session.tsx), so a page opened after another sign-in in another tab is fetched
 * only once the header shows the identity the browser's cookie now carries. No-op without an active session.
 */
export function revalidateSessionIdentity(): Promise<void> {
  if (sessionPhase !== "active" || checkRunners.size === 0) return Promise.resolve();
  return startSessionCheck();
}

/** The identity check in flight, if any (tests and diagnostics). */
export function getPendingSessionCheck(): Promise<void> | null {
  return pendingCheck ?? probesIdle;
}

let probesInFlight = 0;
let probesIdle: Promise<void> | null = null;
let resolveProbesIdle: (() => void) | null = null;

/**
 * Runs one GET /me and the bookkeeping of its answer (noteSessionIdentity, the CSRF token, the phase): page GETs sent
 * meanwhile wait until it is done, so none of them is sent under an identity this /me is about to replace. Used by
 * api/queries.ts fetchMe, i.e. by every /me of the app (session gate, refocus, recheck, permission refresh, sign-in).
 */
export async function asIdentityProbe<T>(probe: () => Promise<T>): Promise<T> {
  if (probesInFlight++ === 0) {
    probesIdle = new Promise<void>((resolve) => {
      resolveProbesIdle = resolve;
    });
  }
  try {
    return await probe();
  } finally {
    if (--probesInFlight === 0) {
      const resolve = resolveProbesIdle;
      probesIdle = null;
      resolveProbesIdle = null;
      resolve?.();
    }
  }
}

function recheckDue(): boolean {
  return sessionPhase === "active" && checkRunners.size > 0 && Date.now() - lastMeAt >= SESSION_RECHECK_MS;
}

function startSessionCheck(): Promise<void> {
  if (pendingCheck) return pendingCheck;
  lastMeAt = Date.now(); // bounded even when the check fails (offline): no /me per request
  const run = Promise.all([...checkRunners].map((r) => r()))
    .then(
      () => undefined,
      () => undefined, // a failed /me is handled where it is stored (401: the session ended; network: unchanged)
    )
    .finally(() => {
      if (pendingCheck === run) pendingCheck = null;
    });
  pendingCheck = run;
  return run;
}

/** Test isolation only: module state survives between tests in one file. */
export function resetSessionStateForTests(): void {
  csrfToken = null;
  sessionPhase = "unknown";
  lastIdentity = null;
  sessionGeneration = 0;
  resetHooks.clear();
  checkRunners.clear();
  pendingCheck = null;
  lastMeAt = Number.NEGATIVE_INFINITY;
  probesInFlight = 0;
  resolveProbesIdle?.();
  probesIdle = null;
  resolveProbesIdle = null;
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
  /** This request IS the identity probe (GET /me): it never waits for, nor starts, an identity recheck. */
  readonly sessionProbe?: boolean;
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
  // F-DG2-530: the generation this request is sent under. Checked again when its answer (or failure) arrives.
  const sentGeneration = sessionGeneration;
  const changed = () => sessionGeneration !== sentGeneration;
  if (options.sessionProbe) {
    lastMeAt = Date.now();
  } else if (method === "GET") {
    // F-DG2-570: page data is fetched only under an identity confirmed within SESSION_RECHECK_MS (see above).
    if (recheckDue()) void startSessionCheck();
    if (pendingCheck) await pendingCheck;
    if (probesIdle) await probesIdle;
    // The identity changed (or the session ended) while this GET waited: it belongs to the previous identity's screen,
    // which has been reset. It is never sent.
    if (changed()) throw new SessionChangedError(sentGeneration, sessionGeneration);
  }
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
    if (changed()) throw new SessionChangedError(sentGeneration, sessionGeneration);
    throw new NetworkError(err);
  }

  let text: string;
  try {
    text = response.status === 204 ? "" : await response.text();
  } catch (err) {
    if (changed()) throw new SessionChangedError(sentGeneration, sessionGeneration);
    throw err;
  }
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) {
    // A failure of a request sent under a previous generation says nothing about the current session: in particular
    // its 401 must not end the session of the identity that has replaced it.
    if (changed()) throw new SessionChangedError(sentGeneration, sessionGeneration);
    const problem = isProblem(parsed) ? parsed : null;
    const error = new ApiError(response.status, problem);
    if (!options.silent401 && isSessionEndedError(error)) endSession();
    throw error;
  }
  if (changed()) throw new SessionChangedError(sentGeneration, sessionGeneration);
  if (options.sessionProbe) lastMeAt = Date.now();
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
