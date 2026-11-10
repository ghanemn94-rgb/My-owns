// Runs the log-scan self-test (node:test, deploy/scripts/tests/log-scan.test.mjs) inside `pnpm test` (unit-node), the
// way dep-audit.vitest.mjs runs the offline audit (ADR-0053 §5; T-DG6-DO-D). No network, no database.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

it("deploy/scripts/log-scan.mjs: its node:test self-test passes (negative fixture FAIL, clean PASS, BLOCKED cases)", () => {
  const r = spawnSync(process.execPath, ["--test", join(here, "log-scan.test.mjs")], { encoding: "utf8" });
  expect(`${r.stdout}${r.stderr}`).toMatch(/# fail 0|ℹ fail 0/);
  expect(r.status).toBe(0);
}, 60_000);
