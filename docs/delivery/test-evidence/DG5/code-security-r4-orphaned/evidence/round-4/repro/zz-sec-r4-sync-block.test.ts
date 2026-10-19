// SEC-R4 experiment (code-security-reviewer, round 4): does ONE synchronous test that blocks a vitest worker for longer
// than birpc's 60 s default make vitest report "[vitest-worker]: Timeout calling \"onTaskUpdate\"" (an unhandled error,
// exit 1) even though the test's own timeout is not exceeded? BLOCK_MS comes from the environment (default 70000).
// Copied into a disposable clone as apps/api/src/zz-sec-r4-sync-block.test.ts; never part of the candidate.
import { expect, it } from "vitest";

const BLOCK_MS = Number(process.env.SEC_R4_BLOCK_MS ?? "70000");

it("a cheap first test (lets the runner schedule its task updates)", async () => {
  await new Promise((r) => setTimeout(r, 50));
  expect(1).toBe(1);
});

it(`blocks the worker synchronously for ${BLOCK_MS} ms, well inside its 200 s budget`, () => {
  const end = Date.now() + BLOCK_MS;
  let n = 0;
  while (Date.now() < end) n++;
  expect(n).toBeGreaterThan(0);
}, 200_000);

it("a cheap last test", () => {
  expect(2).toBe(2);
});
