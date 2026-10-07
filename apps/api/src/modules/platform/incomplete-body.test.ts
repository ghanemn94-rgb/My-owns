// T-DG2-BE17 unit tests of the central error mapping for request bodies that were not received completely (F-DG2-412)
// and for an exhausted database pool (F-DG2-411 defence in depth). No network and no database; the real-socket
// behaviour is covered by apps/api/test/integration/request-io.test.ts. Synthetic errors only.
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { incompleteBodyProblem, isIncompleteBodyError, problemForError, registerPlatformHooks } from "./hooks.ts";

type Raw = { complete?: unknown; aborted?: unknown; destroyed?: unknown };
const req = (raw?: Raw) => ({ routeOptions: { config: {} }, ...(raw ? { raw } : {}) });

/** Node's IncomingMessage abort error (`connResetException("aborted")`), with Fastify rawBody's statusCode stamp. */
function nodeAbortError(statusCode = 400): Error {
  return Object.assign(new Error("aborted"), { code: "ECONNRESET", statusCode });
}
/** A database socket reset as node-postgres surfaces it (`read ECONNRESET`, a syscall error). */
function dbSocketReset(): Error {
  return Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET", errno: -104, syscall: "read" });
}
function prematureClose(): Error {
  return Object.assign(new Error("Premature close"), { code: "ERR_STREAM_PREMATURE_CLOSE" });
}

describe("isIncompleteBodyError: only a body that did not arrive, never a server fault", () => {
  it("matches Node's request-abort error on an incomplete request (client disconnect or requestTimeout)", () => {
    expect(isIncompleteBodyError(nodeAbortError(), req({ complete: false }))).toBe(true);
    expect(isIncompleteBodyError(nodeAbortError(), req({ complete: false, aborted: true }))).toBe(true);
    // Without Fastify's statusCode stamp (the upload route iterating the stream itself).
    expect(
      isIncompleteBodyError(Object.assign(new Error("aborted"), { code: "ECONNRESET" }), req({ complete: false })),
    ).toBe(true);
  });

  it("matches a premature close only when Node marked the request aborted or destroyed", () => {
    expect(isIncompleteBodyError(prematureClose(), req({ complete: false, aborted: true }))).toBe(true);
    expect(isIncompleteBodyError(prematureClose(), req({ complete: false, destroyed: true }))).toBe(true);
    expect(isIncompleteBodyError(prematureClose(), req({ complete: false }))).toBe(false);
  });

  it("never matches when the body arrived completely, or under inject (no `complete` flag)", () => {
    expect(isIncompleteBodyError(nodeAbortError(), req({ complete: true }))).toBe(false);
    expect(isIncompleteBodyError(nodeAbortError(), req({}))).toBe(false);
    expect(isIncompleteBodyError(nodeAbortError(), req())).toBe(false);
  });

  it("does not over-match: a database ECONNRESET is not a client abort, even while the body is incomplete", () => {
    expect(isIncompleteBodyError(dbSocketReset(), req({ complete: false }))).toBe(false);
    expect(isIncompleteBodyError(dbSocketReset(), req({ complete: false, aborted: true }))).toBe(false);
    expect(isIncompleteBodyError(new Error("Connection terminated unexpectedly"), req({ complete: false }))).toBe(
      false,
    );
    const pgTerminated = Object.assign(new Error("terminating connection due to administrator command"), {
      code: "57P01",
      severity: "FATAL",
    });
    expect(isIncompleteBodyError(pgTerminated, req({ complete: false, aborted: true }))).toBe(false);
    expect(isIncompleteBodyError(Object.assign(new Error("x"), { code: "ECONNRESET" }), req({ complete: false }))).toBe(
      false,
    );
    expect(isIncompleteBodyError(null, req({ complete: false }))).toBe(false);
    expect(isIncompleteBodyError("aborted", req({ complete: false }))).toBe(false);
  });
});

describe("problemForError", () => {
  it("an incomplete body is the declared 400 validation.malformed_request", () => {
    const p = problemForError(nodeAbortError() as never, req({ complete: false }));
    expect(p.toBody("r")).toEqual(incompleteBodyProblem().toBody("r"));
    expect(p.status).toBe(400);
    expect(p.errors?.[0]?.code).toBe("validation.malformed_request");
  });

  it("the same error on a fully received request, and a database reset, stay 500 internal", () => {
    expect(problemForError(nodeAbortError() as never, req({ complete: true })).status).toBe(500);
    expect(problemForError(dbSocketReset() as never, req({ complete: false })).status).toBe(500);
  });

  it("a pool checkout timeout (pg-pool's messages) is 503 unavailable, any other pg connect error stays 500", () => {
    for (const message of [
      "timeout exceeded when trying to connect",
      "Connection terminated due to connection timeout",
    ]) {
      const p = problemForError(new Error(message) as never, req({ complete: true }));
      expect([p.status, p.code]).toEqual([503, "unavailable"]);
    }
    expect(problemForError(new Error("connect ECONNREFUSED 127.0.0.1:5432") as never, req()).status).toBe(500);
  });
});

describe("setErrorHandler: the log level and the answer", () => {
  async function run(error: () => Error, complete: boolean | undefined) {
    const lines: Array<{ level: number; msg: string }> = [];
    const app = Fastify({
      logger: { level: "info", stream: { write: (l: string) => void lines.push(JSON.parse(l)) } },
    });
    registerPlatformHooks(app);
    app.post("/x", { config: { access: { public: true } } }, async (request) => {
      if (complete !== undefined) Object.defineProperty(request.raw, "complete", { value: complete });
      throw error();
    });
    await app.ready();
    const res = await app.inject({ method: "POST", url: "/x", payload: { a: 1 } });
    await app.close();
    return { status: res.statusCode, body: res.json(), errorLines: lines.filter((l) => l.level >= 50), lines };
  }

  it("an incomplete body: 400 validation.malformed_request, logged at info, no error-level line", async () => {
    const r = await run(nodeAbortError, false);
    expect(r.status).toBe(400);
    expect(r.body.errors[0].code).toBe("validation.malformed_request");
    expect(r.errorLines).toEqual([]);
    expect(r.lines.some((l) => l.level === 30 && l.msg === "request body not received completely")).toBe(true);
  });

  it("a database socket reset while the body is incomplete: 500 with an error-level log", async () => {
    const r = await run(dbSocketReset, false);
    expect(r.status).toBe(500);
    expect(r.body.code).toBe("internal");
    expect(r.errorLines.map((l) => l.msg)).toEqual(["unhandled error"]);
  });

  it("an abort-shaped error on a fully received request is a genuine fault: 500 with an error-level log", async () => {
    const r = await run(nodeAbortError, true);
    expect(r.status).toBe(500);
    expect(r.errorLines.map((l) => l.msg)).toEqual(["unhandled error"]);
  });
});
