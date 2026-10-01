// DG1 round-15 domain-reviewer probe (reviewer-authored evidence; NOT part of the candidate).
// Copied into the disposable clone (commit f27b5a6, candidate 76d8b304) as apps/api/test/integration/zz-dom-r15-hook.test.ts
// and run ONLY through the `integration` vitest project, then removed. It checks F-DG1-136 behaviourally: an afterAll
// hook that takes 12 s (longer than vitest's default 10 s hookTimeout, shorter than the configured 30 s) must complete.
// Control: the same probe run with the round-14 vitest.config.ts (no hookTimeout) must fail with "Hook timed out in 10000ms".
import { afterAll, expect, it } from "vitest";

let ran = false;
it("a trivial test so the file has a test", () => {
  ran = true;
  expect(ran).toBe(true);
});

afterAll(async () => {
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 12_000));
  console.log(`afterAll slept ${Date.now() - t0} ms`);
});
