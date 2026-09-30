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
const unauthenticatedListeners = new Set<() => void>();

/** Set from GET /api/v1/me (ADR-0005 §4). */
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

/** Called when any request other than the session probe answers 401 (session expired or revoked). */
export function onUnauthenticated(listener: () => void): () => void {
  unauthenticatedListeners.add(listener);
  return () => unauthenticatedListeners.delete(listener);
}

export interface RequestOptions {
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly body?: unknown;
  readonly query?: Readonly<Record<string, string | number | boolean | readonly string[] | null | undefined>>;
  /** Version of the representation being changed; sent as a strong ETag in If-Match. */
  readonly ifMatch?: number;
  readonly idempotencyKey?: string;
  readonly signal?: AbortSignal;
  /** Do not notify 401 listeners (used by the session probe itself). */
  readonly silent401?: boolean;
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
  const headers: Record<string, string> = { Accept: "application/json, application/problem+json" };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["X-CSRF-Token"] = csrfToken;
  if (options.ifMatch !== undefined) headers["If-Match"] = `"${options.ifMatch}"`;
  if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      credentials: "same-origin",
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
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
    if (response.status === 401 && !options.silent401) unauthenticatedListeners.forEach((l) => l());
    throw new ApiError(response.status, problem);
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
