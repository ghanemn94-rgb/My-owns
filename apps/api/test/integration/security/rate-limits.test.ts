// The security suite, clause "rate limiting" (T-DG6-BE-E2; ADR-0052 §4, §11; REQ-S16-030; p6-work-split §E/F.8)
// against a real PostgreSQL. For each class of the ADR-0052 §4 matrix with its budget set to 1 (its own API instance),
// two calls of one operation of the class from the same caller: the first is not 429, the second is 429
// `rate_limited` (problem+json) with a positive `Retry-After`. The class limiter runs on request, before
// authentication and validation, so the synthetic calls need not succeed to be counted.
//   global    RATE_LIMIT_PER_MINUTE           getMe without a session (keyed by IP)
//   auth      AUTH_RATE_LIMIT_PER_MINUTE      devLogin (keyed by IP)
//   upload    UPLOAD_RATE_LIMIT_PER_MINUTE    uploadEvidenceContent, createImport (the import upload) (keyed by user)
//   search    SEARCH_RATE_LIMIT_PER_MINUTE    searchRecords (keyed by user)
//   assistant ASSISTANT_RATE_LIMIT_PER_MINUTE postAssistantMessage (keyed by user)
//   webhook   WEBHOOK_RATE_LIMIT_PER_MINUTE   receiveWebhook (keyed by endpoint key: a second key is not counted)
//   export    EXPORT_RATE_LIMIT_PER_MINUTE    createExport (export start) (keyed by user)
// T-DG6-BE-Y4 (F-DG6-141): every operation id of every class has a case (pinned against RATE_LIMIT_CLASSES, so a newly
// wired operation cannot go untested); for each user-keyed class a second user's call in the same minute is not
// counted (the per-user bucket); every class refusal writes one "rate limit class exceeded" log line naming the class,
// without the user id or the client IP.
// All data is SYNTHETIC; nothing here approves anything or touches the engineering gates DG0-DG7.
import { describe, expect, it } from "vitest";
import { RATE_LIMIT_CLASSES } from "../../../src/modules/platform/index.ts";
import { call, seedWorld, signIn, startApi, type Res, type Session, type TestApi } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
type Attempt = (api: TestApi, session: Session | null) => Promise<Res<Body>>;

const uuid = () => crypto.randomUUID();
const endpointKey = (c: string) => c.repeat(40);
const webhook = (key: string) => (api: TestApi) =>
  call<Body>(api.app, "POST", `/api/v1/webhooks/${key}`, {
    headers: {
      "content-type": "application/json",
      "x-mth-webhook-timestamp": String(Math.floor(Date.now() / 1000)),
      "x-mth-webhook-delivery": `synthetic-${uuid()}`,
      "x-mth-webhook-signature": `v1=${"0".repeat(64)}`,
    },
    body: { items: [] },
  });

interface ClassCase {
  readonly name: string;
  /** user-keyed classes: a second user's call is not counted against the first user's budget. */
  readonly perUser?: boolean;
  readonly variable: string;
  readonly operationId: string;
  /** Whether the attempts carry a signed-in session (user-keyed classes). */
  readonly withSession: boolean;
  readonly attempt: Attempt;
}

const CASES: readonly ClassCase[] = [
  {
    name: "global",
    variable: "RATE_LIMIT_PER_MINUTE",
    operationId: "getMe",
    withSession: false,
    attempt: (api) => call<Body>(api.app, "GET", "/api/v1/me"),
  },
  {
    name: "auth",
    variable: "AUTH_RATE_LIMIT_PER_MINUTE",
    operationId: "devLogin",
    withSession: false,
    attempt: (api) => call<Body>(api.app, "POST", "/api/v1/auth/dev-login", { body: { username: "synthetic-nobody" } }),
  },
  {
    name: "upload",
    variable: "UPLOAD_RATE_LIMIT_PER_MINUTE",
    operationId: "uploadEvidenceContent",
    withSession: true,
    perUser: true,
    attempt: (api, session) =>
      call<Body>(api.app, "POST", `/api/v1/transformations/${uuid()}/evidence/${uuid()}/content`, {
        session,
        headers: { ...ifm(1), "content-type": "application/octet-stream", "x-file-name": "extract.csv" },
        body: Buffer.from("a,b\n1,2\n"),
      }),
  },
  {
    name: "upload",
    variable: "UPLOAD_RATE_LIMIT_PER_MINUTE",
    operationId: "createImport",
    withSession: true,
    perUser: true,
    attempt: (api, session) =>
      call<Body>(api.app, "POST", `/api/v1/transformations/${uuid()}/imports?template=actuals.v1`, {
        session,
        headers: { "content-type": "text/csv", "x-file-name": "actuals.csv", "idempotency-key": uuid() },
        body: Buffer.from("a,b\n1,2\n"),
      }),
  },
  {
    name: "search",
    variable: "SEARCH_RATE_LIMIT_PER_MINUTE",
    operationId: "searchRecords",
    withSession: true,
    perUser: true,
    attempt: (api, session) => call<Body>(api.app, "GET", "/api/v1/search?q=synthetic", { session }),
  },
  {
    name: "assistant",
    variable: "ASSISTANT_RATE_LIMIT_PER_MINUTE",
    operationId: "postAssistantMessage",
    withSession: true,
    perUser: true,
    attempt: (api, session) =>
      call<Body>(api.app, "POST", `/api/v1/assistant/conversations/${uuid()}/messages`, {
        session,
        body: { content: "Synthetic question" },
      }),
  },
  {
    name: "webhook",
    variable: "WEBHOOK_RATE_LIMIT_PER_MINUTE",
    operationId: "receiveWebhook",
    withSession: false,
    attempt: (api) => webhook(endpointKey("a"))(api),
  },
  {
    name: "export",
    variable: "EXPORT_RATE_LIMIT_PER_MINUTE",
    operationId: "createExport",
    withSession: true,
    perUser: true,
    attempt: (api, session) =>
      call<Body>(api.app, "POST", "/api/v1/exports", {
        session,
        headers: { "idempotency-key": uuid() },
        body: { transformationId: uuid(), definitionCode: "registers", format: "csv", selection: { register: "raid" } },
      }),
  },
];

/** The class limiter's log lines (JSON, one per refusal). */
const classLines = (lines: readonly string[]) =>
  lines
    .filter((l) => l.includes('"rate limit class exceeded"'))
    .map((l) => JSON.parse(l) as { rateLimitClass?: string; route?: string; requestId?: string });

interface Ctx {
  readonly api: TestApi;
  readonly session: Session | null;
  /** A second signed-in user (user-keyed classes), or null. */
  readonly other: Session | null;
  /** The server's log lines so far. */
  readonly lines: readonly string[];
  readonly officeId: string | null;
}

/** A fresh API whose `variable` budget is 1 per minute (every other budget stays the harness's high value). */
async function withBudgetOfOne<T>(variable: string, run: (ctx: Ctx) => Promise<T>) {
  const lines: string[] = [];
  const api = await startApi({
    env: { [variable]: "1" },
    logStream: { write: (line: string) => void lines.push(line) },
  });
  try {
    // The global case signs nobody in: the sign-in's own requests would consume its budget of 1.
    const w =
      variable === "RATE_LIMIT_PER_MINUTE" || variable === "AUTH_RATE_LIMIT_PER_MINUTE"
        ? null
        : await seedWorld(api.db);
    const session = w === null ? null : await signIn(api.app, w.office.subject);
    const other = w === null ? null : await signIn(api.app, w.admin.subject);
    return await run({ api, session, other, lines, officeId: w === null ? null : w.office.id });
  } finally {
    await api.close();
  }
}

function expectRateLimited(res: Res<Body>): void {
  expect([res.status, res.body?.code], JSON.stringify(res.body)).toEqual([429, "rate_limited"]);
  expect(String(res.headers["content-type"])).toContain("application/problem+json");
  expect(Number(res.headers["retry-after"])).toBeGreaterThan(0);
}

const passed = new Set<string>();

describe("rate limiting (REQ-S16-030; ADR-0052 §4): each class with its budget set to 1", () => {
  it("the cases cover every operation of every class of the matrix, with the matrix's own variable", () => {
    expect([...new Set(CASES.map((c) => c.name))]).toEqual(RATE_LIMIT_CLASSES.map((c) => c.name));
    for (const c of CASES) {
      const spec = RATE_LIMIT_CLASSES.find((s) => s.name === c.name)!;
      expect(spec.variable).toBe(c.variable);
      if (c.name !== "global") expect(spec.operationIds).toContain(c.operationId);
    }
    // Every operation of each budgeted class (the auth class is identity's own per-route limit, ADR-0007 §5b, shared
    // by its three operations: devLogin represents it).
    for (const spec of RATE_LIMIT_CLASSES.filter((c) => c.name !== "auth"))
      for (const op of spec.operationIds)
        expect(
          CASES.some((c) => c.name === spec.name && c.operationId === op),
          `${spec.name}/${op}`,
        ).toBe(true);
    // Every class except global (every operation without a class) has at least one operation (F-DG6-141).
    expect(RATE_LIMIT_CLASSES.filter((c) => c.name !== "global" && c.operationIds.length === 0)).toEqual([]);
  });

  for (const c of CASES) {
    it(`${c.name} (${c.variable}=1, ${c.operationId}): the second call is 429 rate_limited with Retry-After`, async () => {
      await withBudgetOfOne(c.variable, async ({ api, session, other, lines, officeId }) => {
        if (c.withSession) expect(session).not.toBeNull();
        const first = await c.attempt(api, c.withSession ? session : null);
        expect(first.status, JSON.stringify(first.body)).not.toBe(429);
        const second = await c.attempt(api, c.withSession ? session : null);
        expectRateLimited(second);
        if (c.name === "webhook") {
          // Keyed by endpoint key: another endpoint's first call is not counted against the first one's budget.
          expect((await webhook(endpointKey("b"))(api)).status).not.toBe(429);
        }
        if (c.perUser) {
          // The per-user bucket: another signed-in user's call in the same minute is not counted against the first
          // user's budget, while the first user stays limited.
          expect(other).not.toBeNull();
          const others = await c.attempt(api, other);
          expect(others.status, JSON.stringify(others.body)).not.toBe(429);
          expectRateLimited(await c.attempt(api, session));
        }
        if (c.name !== "global" && c.name !== "auth") {
          // The class limiter's log line: one per refusal, naming the class and the route, never the key.
          const refusals = classLines(lines);
          expect(refusals.length).toBe(c.perUser ? 2 : 1);
          for (const r of refusals) {
            expect(r.rateLimitClass).toBe(c.name);
            expect(typeof r.requestId).toBe("string");
          }
          const text = refusals.map((r) => JSON.stringify(r)).join("\n");
          expect(text).not.toContain("127.0.0.1");
          if (officeId !== null) expect(text).not.toContain(officeId);
        }
      });
      passed.add(`${c.name}/${c.operationId}`);
    }, 60_000);
  }

  it("clause summary", () => {
    expect([...passed].sort()).toEqual(CASES.map((c) => `${c.name}/${c.operationId}`).sort());
    console.log(
      `PASS REQ-S16-030 rate limiting: ${new Set(CASES.map((c) => c.name)).size} classes, ${CASES.length} operations (${CASES.map((c) => `${c.name}/${c.operationId}`).join(", ")}) at budget 1 -> second call 429 rate_limited with Retry-After; user-keyed classes counted per user; one class log line per refusal`,
    );
  });
});
