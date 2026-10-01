// QA round-15 independent probe for F-DG1-136 (qa-verifier; review-time test, NOT part of the candidate).
// Usage (disposable clone only): cp this file to tests/qa/integration/ and run it in the `integration` project:
//   tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/dg1-r15-hooktimeout-probe.test.ts
// Proves the integration project's effective hookTimeout is above vitest's 10_000 ms default: an afterAll that takes
// 12 s passes only if the project-level hookTimeout (expected 30_000) applies. With the round-14 config (no
// hookTimeout) this afterAll fails with "Hook timed out in 10000ms".
import { afterAll, describe, expect, it } from "vitest";

const SLOW_TEARDOWN_MS = 12_000;

afterAll(async () => {
  await new Promise((r) => setTimeout(r, SLOW_TEARDOWN_MS));
});

describe("QA r15 F-DG1-136: integration hookTimeout covers a teardown slower than the 10s default", () => {
  it("runs in the integration project (sanity)", () => {
    expect(SLOW_TEARDOWN_MS).toBeGreaterThan(10_000);
  });
});
