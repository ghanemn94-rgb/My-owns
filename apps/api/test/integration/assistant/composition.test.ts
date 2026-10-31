// The assistant's ports and the A21 connection log through the REAL composition root (T-DG6-BE-X3; ADR-0059 §2,
// §4, §12; ADR-0052 §5; REQ-S17-009, REQ-S17-010, REQ-S17-007). The same class of gap as F-DG6-QA-A-1: every other
// assistant suite injects the secret registry (provider.test.ts) or registers the two retrieval ports itself
// (be-u-fixtures.ts), which hid that `buildServer` wired none of them, and `installConnectionLog` was called nowhere.
// This file never calls a setter or a register function to install anything; it only reads what buildServer installed:
//  1. the HTTP adapter resolves its `credentialRef` through buildServer's own registry (the built-in `env` provider):
//     the fake model receives `authorization: Bearer <value>`; an unset reference sends nothing (`unavailable`,
//     assistant.provider_error) and the value never appears in a response;
//  2. the playbook passage port is registered: a question on "case for change" from a user who reads no record gives
//     the model playbook passages (without the port it would be `no_sources` and no call); both retrieval ports are
//     the composition's (each register function returns the port buildServer set, never null);
//  3. MTH_CONNECTION_LOG set when buildServer runs gives the log with `process: "api"`: one undici line for the call
//     to the fake, and for a TCP attempt that never connects the requested host and port (QA-D-2), never nulls;
//     the log is held per app and removed when the last app holding it closes.
// The model is the local fake chat-completions server on loopback (NOT a model, NOT an IT endpoint). All data is
// SYNTHETIC; nothing here approves anything (G1-G6) or touches DG0-DG7.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { connect, createServer, type AddressInfo, type LookupFunction, type TcpNetConnectOpts } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONNECTION_LOG_VARIABLE, type ConnectionLogLine } from "@mth/config";
import { migrate } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import {
  registerAssistantEvidenceTextPort,
  registerAssistantPlaybookPassagePort,
} from "../../../src/modules/assistant/retrieval.ts";
import { loadSetting } from "../../../src/modules/assistant/settings.ts";
import { FakeModel } from "../../support/fake-model.ts";
import {
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const S = "/api/v1/admin/assistant";
const C = "/api/v1/assistant/conversations";
const ifm = (v: number | string) => ({ "if-match": `"${v}"` });
// Variable names unique to this file; the values are SYNTHETIC canaries.
const KEY_NAME = "MTH_BE_X3_COMPOSITION_MODEL_KEY";
const KEY_VALUE = "synthetic-canary-be-x3-model-key-6b0e";
const UNSET_NAME = "MTH_BE_X3_COMPOSITION_NEVER_SET";
// TEST-NET-1 (RFC 5737): never routed, so a connect to it never succeeds.
const UNREACHABLE = { host: "192.0.2.10", port: 443 };

let api: TestApi;
let scratchDb: string;
let fake: FakeModel;
let admin: Session;
let reader: Session; // assistant.use, no record read anywhere
let logFile: string;
let previousLogVariable: string | undefined;

const readLines = (file: string): ConnectionLogLine[] =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l) as ConnectionLogLine)
    : [];
const newLogFile = (name: string) => join(mkdtempSync(join(tmpdir(), "mth-be-x3-connlog-")), name);

/** A deterministic failing resolver: no DNS traffic, no dependency on this machine's resolver. */
const failingLookup = ((_host: string, _options: unknown, callback: (err: Error) => void) =>
  process.nextTick(() =>
    callback(Object.assign(new Error("synthetic"), { code: "ENOTFOUND" })),
  )) as unknown as LookupFunction;

/** Opens a TCP connection attempt and waits until the socket closes (connected, refused, unreachable or aborted). */
function attempt(options: TcpNetConnectOpts, abortAfterMs = 500): Promise<void> {
  return new Promise<void>((resolve) => {
    const s = connect(options, () => s.end());
    const timer = setTimeout(() => s.destroy(), abortAfterMs);
    s.on("error", () => undefined);
    s.on("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function configureHttp(credentialName: string | null): Promise<void> {
  let current = await loadSetting(api.db);
  if (current?.enabled) {
    const off = await call<Body>(api.app, "POST", `${S}/disable`, {
      session: admin,
      body: { reason: "Synthetic: off" },
      headers: ifm(current.version),
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    current = await loadSetting(api.db);
  }
  const saved = await call<Body>(api.app, "PUT", S, {
    session: admin,
    body: {
      providerKind: "http_endpoint",
      endpointUrl: fake.url,
      apiStyle: "openai_chat_completions",
      modelName: "synthetic-model",
      credentialRef: credentialName === null ? null : { provider: "env", name: credentialName },
      authorizationReference: "IT-APPROVAL-SYNTHETIC-BE-X3",
      requestTimeoutMs: 5000,
      maxOutputTokens: 512,
      maxContextRecords: 5,
      reason: "Synthetic: the local fake model with a credential reference",
    },
    headers: ifm(current?.version ?? 0),
  });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const on = await call<Body>(api.app, "POST", `${S}/enable`, {
    session: admin,
    body: { reason: "Synthetic: on (fake)" },
    headers: ifm(saved.body.version),
  });
  expect(on.status, JSON.stringify(on.body)).toBe(200);
}

async function askCaseForChange(): Promise<Body> {
  const conv = await call<Body>(api.app, "POST", C, { session: reader, body: { title: "Synthetic BE-X3" } });
  expect(conv.status, JSON.stringify(conv.body)).toBe(201);
  const res = await call<Body>(api.app, "POST", `${C}/${conv.body.id}/messages`, {
    session: reader,
    body: { content: "What is the case for change?" },
    headers: ifm(conv.body.version),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

beforeAll(async () => {
  process.env[KEY_NAME] = KEY_VALUE;
  delete process.env[UNSET_NAME];
  previousLogVariable = process.env[CONNECTION_LOG_VARIABLE];
  logFile = newLogFile("api.jsonl");
  process.env[CONNECTION_LOG_VARIABLE] = logFile; // read by buildServer (server.ts), as main.ts's process would
  const { adminUrl } = inject("mthDb");
  scratchDb = await createScratchDatabase(adminUrl, "mth_asst_comp");
  await migrate(roleUrl(adminUrl, scratchDb, "mth_owner"));
  api = await startApi({ database: scratchDb });
  const w = await seedWorld(api.db);
  fake = await new FakeModel().start();
  admin = await signIn(api.app, w.admin.subject);
  // ADM_ACCESS holds assistant.use but no transformation.read: only the playbook can be retrieved.
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "ADM_ACCESS", { type: "organization", id: w.orgA.id }, w.orgA.id);
  reader = await signIn(api.app, u.subject);
}, 120_000);

afterAll(async () => {
  delete process.env[KEY_NAME];
  if (previousLogVariable === undefined) delete process.env[CONNECTION_LOG_VARIABLE];
  else process.env[CONNECTION_LOG_VARIABLE] = previousLogVariable;
  await fake?.stop();
  await api?.close();
  await dropScratchDatabase(inject("mthDb").adminUrl, scratchDb);
});

describe("buildServer hands its SecretProvider registry to the assistant (BE-X2 handback §5)", () => {
  it("a set credential reference reaches the model as `authorization: Bearer`; the value is never in a response", async () => {
    await configureHttp(KEY_NAME);
    fake.configure({ kind: "envelope", answer: "Synthetic answer from the fake.", citations: [] });
    const before = fake.requestCount;
    const body = await askCaseForChange();
    expect(body.reply.replyKind, JSON.stringify(body.reply)).toBe("answer");
    expect(fake.requestCount).toBe(before + 1);
    expect(fake.requests[fake.requests.length - 1]!.authorization).toBe(`Bearer ${KEY_VALUE}`);
    expect(JSON.stringify(body)).not.toContain(KEY_VALUE);
  });

  it("an unset reference sends nothing: `unavailable` with assistant.provider_error", async () => {
    await configureHttp(UNSET_NAME);
    const before = fake.requestCount;
    const body = await askCaseForChange();
    expect([body.reply.replyKind, body.reply.errorCode]).toEqual(["unavailable", "assistant.provider_error"]);
    expect(fake.requestCount).toBe(before);
  });
});

describe("buildServer registers the two retrieval ports (ADR-0059 §4; BE-U's composition lines)", () => {
  it("the playbook port gives a reader of no record the playbook passages on 'case for change'", async () => {
    await configureHttp(null); // no credential: this case depends on the playbook port only
    fake.configure({ kind: "envelope", answer: "Synthetic answer from the fake.", citations: [] });
    const body = await askCaseForChange();
    // An uncited answer cites every item given: here only playbook passages (no record is readable).
    expect(body.reply.replyKind).toBe("answer");
    expect(body.reply.citations.length).toBeGreaterThan(0);
    for (const c of body.reply.citations) {
      expect(c.source).toBe("playbook");
      expect(c.blockRef).toMatch(/^B0[0-9]{3}$/);
    }
  });

  it("both ports are the ones buildServer set (each register function returns it; restored at once)", () => {
    const evidence = registerAssistantEvidenceTextPort(null);
    registerAssistantEvidenceTextPort(evidence);
    const playbook = registerAssistantPlaybookPassagePort(null);
    registerAssistantPlaybookPassagePort(playbook);
    expect(evidence).not.toBeNull();
    expect(typeof evidence?.excerpt).toBe("function");
    expect(playbook).not.toBeNull();
    expect(typeof playbook?.find).toBe("function");
  });
});

describe("the API connection log is installed by buildServer (QA-D-1, QA-D-2; ADR-0059 §12)", () => {
  it("logs the call to the model as the api process, with the destination only", () => {
    // Each answered post above opened its own connection to the fake (keep-alive is off there).
    const lines = readLines(logFile);
    const toFake = lines.filter((l) => l.channel === "undici:client:beforeConnect" && l.port === fake.port);
    expect(toFake.length).toBeGreaterThanOrEqual(1);
    for (const l of toFake) expect(l).toMatchObject({ process: "api", host: "127.0.0.1", address: null });
    for (const l of lines) {
      expect(l.process).toBe("api");
      expect(Object.keys(l).sort()).toEqual(["address", "at", "channel", "host", "port", "process"]);
    }
    const text = readFileSync(logFile, "utf8");
    expect(text).not.toContain("chat/completions"); // no path, header or body
    expect(text).not.toContain(KEY_VALUE);
  });

  it("a TCP attempt that never connects is logged with the requested host and port, not nulls (QA-D-2)", async () => {
    await attempt(UNREACHABLE);
    const line = readLines(logFile).find((l) => l.channel === "net.client.socket" && l.port === UNREACHABLE.port);
    expect(line).toMatchObject({ process: "api", host: UNREACHABLE.host, address: UNREACHABLE.host });
  });

  it("a connection refused on loopback keeps its host, address and port", async () => {
    // A port nothing listens on: bind one, read its number, close it, then connect.
    const probe = await new Promise<number>((resolve) => {
      const s = createServer();
      s.listen(0, "127.0.0.1", () => {
        const port = (s.address() as AddressInfo).port;
        s.close(() => resolve(port));
      });
    });
    await attempt({ host: "127.0.0.1", port: probe });
    const line = readLines(logFile).find((l) => l.channel === "net.client.socket" && l.port === probe);
    expect(line).toMatchObject({ process: "api", host: "127.0.0.1", address: "127.0.0.1", port: probe });
  });

  it("a failed lookup is logged with the host asked for; no address or port was dialled", async () => {
    const name = "be-x3-unresolvable.invalid";
    await attempt({
      host: name,
      port: 8443,
      lookup: failingLookup,
    });
    const line = readLines(logFile).find((l) => l.channel === "net.client.socket" && l.host === name);
    expect(line).toMatchObject({ process: "api", host: name, address: null, port: null });
  });

  it("is held per app: a second app on the same file keeps it after closing; the last holder's close removes it", async () => {
    // A second composition on the same file joins the first one's log (one subscription: each attempt is one line).
    const second = await startApi({ database: scratchDb });
    await second.close();
    const countFor = (file: string, port: number) =>
      readLines(file).filter((l) => l.channel === "net.client.socket" && l.port === port).length;
    await attempt({ host: "192.0.2.11", port: 4431 });
    expect(countFor(logFile, 4431)).toBe(1); // still logged (the suite's app holds it), and not twice
    // A third app on a file of its own: its close is that file's last holder, so nothing more is written there.
    const ownFile = newLogFile("own.jsonl");
    process.env[CONNECTION_LOG_VARIABLE] = ownFile;
    const third = await startApi({ database: scratchDb });
    process.env[CONNECTION_LOG_VARIABLE] = logFile;
    await attempt({ host: "192.0.2.12", port: 4432 });
    expect(countFor(ownFile, 4432)).toBe(1);
    await third.close();
    await attempt({ host: "192.0.2.13", port: 4433 });
    expect(countFor(ownFile, 4433)).toBe(0);
    expect(countFor(logFile, 4433)).toBe(1);
  }, 60_000);
});
