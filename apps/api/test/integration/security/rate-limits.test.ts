// The security suite, clause "rate limiting" (T-DG6-BE-E2; ADR-0052 §4, §11; REQ-S16-030; p6-work-split §E/F.8)
// against a real PostgreSQL. For each class of the ADR-0052 §4 matrix with its budget set to 1 (its own API instance),
// two calls of one operation of the class from the same caller: the first is not 429, the second is 429
// `rate_limited` (problem+json) with a positive `Retry-After`. The class limiter runs on request, before
// authentication and validation, so the synthetic calls need not succeed to be counted.
//   global    RATE_LIMIT_PER_MINUTE           getMe without a session (keyed by IP)
//   auth      AUTH_RATE_LIMIT_PER_MINUTE      devLogin (keyed by IP)
//   upload    UPLOAD_RATE_LIMIT_PER_MINUTE    uploadEvidenceContent (keyed by user)
//   search    SEARCH_RATE_LIMIT_PER_MINUTE    searchRecords (keyed by user)
//   assistant ASSISTANT_RATE_LIMIT_PER_MINUTE postAssistantMessage (keyed by user)
//   webhook   WEBHOOK_RATE_LIMIT_PER_MINUTE   receiveWebhook (keyed by endpoint key: a second key is not counted)
//   export    EXPORT_RATE_LIMIT_PER_MINUTE    no operation is wired to the class yet (RATE_LIMIT_CLASSES lists none;
//             the reporting/exports owner adds it, T-DG6-BE-E handback §6): recorded as a todo, never as a pass.
// The matrix of every class is pinned against RATE_LIMIT_CLASSES so a newly wired class cannot go untested.
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
    attempt: (api, session) =>
      call<Body>(api.app, "POST", `/api/v1/transformations/${uuid()}/evidence/${uuid()}/content`, {
        session,
        headers: { ...ifm(1), "content-type": "application/octet-stream", "x-file-name": "extract.csv" },
        body: Buffer.from("a,b\n1,2\n"),
      }),
  },
  {
    name: "search",
    variable: "SEARCH_RATE_LIMIT_PER_MINUTE",
    operationId: "searchRecords",
    withSession: true,
    attempt: (api, session) => call<Body>(api.app, "GET", "/api/v1/search?q=synthetic", { session }),
  },
  {
    name: "assistant",
    variable: "ASSISTANT_RATE_LIMIT_PER_MINUTE",
    operationId: "postAssistantMessage",
    withSession: true,
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
];

/** A fresh API whose `variable` budget is 1 per minute (every other budget stays the harness's high value). */
async function withBudgetOfOne<T>(variable: string, run: (api: TestApi, session: Session | null) => Promise<T>) {
  const api = await startApi({ env: { [variable]: "1" } });
  try {
    // The global case signs nobody in: the sign-in's own requests would consume its budget of 1.
    const w =
      variable === "RATE_LIMIT_PER_MINUTE" || variable === "AUTH_RATE_LIMIT_PER_MINUTE"
        ? null
        : await seedWorld(api.db);
    const session = w === null ? null : await signIn(api.app, w.office.subject);
    return await run(api, session);
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
  it("the cases cover every class of the matrix that has an operation, with the matrix's own operation and variable", () => {
    const wired = RATE_LIMIT_CLASSES.filter((c) => c.name === "global" || c.operationIds.length > 0);
    expect(CASES.map((c) => c.name)).toEqual(wired.map((c) => c.name));
    for (const c of CASES) {
      const spec = RATE_LIMIT_CLASSES.find((s) => s.name === c.name)!;
      expect(spec.variable).toBe(c.variable);
      if (c.name !== "global") expect(spec.operationIds).toContain(c.operationId);
    }
    // The one class without an operation yet is export (see the todo below).
    expect(
      RATE_LIMIT_CLASSES.filter((c) => c.name !== "global" && c.operationIds.length === 0).map((c) => c.name),
    ).toEqual(["export"]);
  });

  for (const c of CASES) {
    it(`${c.name} (${c.variable}=1, ${c.operationId}): the second call is 429 rate_limited with Retry-After`, async () => {
      await withBudgetOfOne(c.variable, async (api, session) => {
        if (c.withSession) expect(session).not.toBeNull();
        const first = await c.attempt(api, c.withSession ? session : null);
        expect(first.status, JSON.stringify(first.body)).not.toBe(429);
        const second = await c.attempt(api, c.withSession ? session : null);
        expectRateLimited(second);
        if (c.name === "webhook") {
          // Keyed by endpoint key: another endpoint's first call is not counted against the first one's budget.
          expect((await webhook(endpointKey("b"))(api)).status).not.toBe(429);
        }
      });
      passed.add(c.name);
    }, 60_000);
  }

  it.todo(
    "export (EXPORT_RATE_LIMIT_PER_MINUTE=1): pending - no export start operation is wired to the class yet (owner of reporting/exports; T-DG6-BE-E handback §6)",
  );

  it("clause summary", () => {
    expect([...passed].sort()).toEqual(CASES.map((c) => c.name).sort());
    console.log(
      `PASS REQ-S16-030 rate limiting: ${CASES.length} classes (${CASES.map((c) => c.name).join(", ")}) at budget 1 -> second call 429 rate_limited with Retry-After; export: no operation wired yet (todo)`,
    );
  });
});
