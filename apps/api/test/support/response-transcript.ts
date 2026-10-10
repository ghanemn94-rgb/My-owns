// The A/B recorded-response method of T-DG4-BE-M2 (modular-precondition.test.ts), as a reusable wrapper (T-DG4-BE-R3;
// ADR-0021 amendment W7 item 3). When the environment variable named by the caller is set to a file path, every
// response a wrapped `call` returns (status, ETag, Location, body without `requestId`) is appended to an in-memory
// transcript, with ids, instants and 64-hex hashes replaced by first-appearance placeholders and every other byte
// kept; `flush()` writes it. Unset, the wrapper records nothing and writes nothing. The transcript of a run against the
// base commit's source and one against the new source are then compared with `cmp`.
import { writeFileSync } from "node:fs";
import type { call } from "./harness.ts";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g;
const HASH = /\b[0-9a-f]{64}\b/g;
/** Fixture names derived from random ids ("Synthetic outcome 30cc97"), as BE-M2 normalized them. */
const FIXTURE_NAME = /Synthetic outcome [0-9a-f]{6}/g;

/** Replaces ids, instants and hashes by stable placeholders (first appearance order), keeping every other byte. */
export function transcriptNormalizer(): (text: string) => string {
  const seen = new Map<string, string>();
  const tag = (prefix: string) => (m: string) => {
    if (!seen.has(m)) seen.set(m, `<${prefix}${seen.size}>`);
    return seen.get(m)!;
  };
  return (text: string) =>
    text
      .replace(HASH, tag("hash"))
      .replace(UUID, tag("id"))
      .replace(FIXTURE_NAME, tag("name"))
      .replace(TIMESTAMP, "<ts>");
}

export interface ResponseTranscript {
  /** `call`, recording each response when the transcript is enabled. */
  readonly call: typeof call;
  /** Records one labelled response (for callers that send through another function). */
  readonly note: (label: string, res: { status: number; headers: Record<string, unknown>; body: unknown }) => void;
  /** Writes the transcript to the file named by the environment variable (no-op when it is unset). */
  readonly flush: () => void;
  readonly enabled: boolean;
}

/** Wraps `inner` so that its responses are recorded when `process.env[envVar]` names an output file. */
export function responseTranscript(inner: typeof call, envVar: string): ResponseTranscript {
  const out = process.env[envVar];
  const lines: string[] = [];
  const norm = transcriptNormalizer();
  const note: ResponseTranscript["note"] = (label, res) => {
    if (!out) return;
    const { requestId: _r, ...body } =
      res.body !== null && typeof res.body === "object" && !Array.isArray(res.body)
        ? (res.body as Record<string, unknown>)
        : { value: res.body };
    lines.push(
      norm(
        JSON.stringify({
          label,
          status: res.status,
          etag: res.headers["etag"] ?? null,
          location: res.headers["location"] ?? null,
          body,
        }),
      ),
    );
  };
  const wrapped = (async (app, method, url, opts) => {
    const res = await inner(app, method, url, opts);
    note(`${method} ${norm(url)}`, res as never);
    return res;
  }) as typeof call;
  return {
    call: wrapped,
    note,
    flush: () => {
      if (out) writeFileSync(out, `${lines.join("\n")}\n`);
    },
    enabled: Boolean(out),
  };
}
