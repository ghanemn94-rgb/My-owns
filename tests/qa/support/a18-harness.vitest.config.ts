// qa-verifier (T-DG7-QA-E): a Vitest config used ONLY by tests/qa/unit/a18-harness-blocked.test.ts, which runs the
// A18 harness file in a child process with `-t "A18 transfer drill"` to prove its absent/invalid/ready behaviour.
// That filter selects only the part-2 blocks (drill harness and drill), which need no database, so this config has no
// global setup; part 1 ("A18 clean environment starts") is filtered out and its hooks do not run. The resolve
// conditions mirror the root `integration` project (vitest.config.ts) so the file's imports load from source.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  root: fileURLToPath(new URL("../../..", import.meta.url)),
  resolve: { conditions: ["@mth/source"] },
  ssr: { resolve: { conditions: ["@mth/source"], externalConditions: ["@mth/source"] } },
  test: {
    name: "qa-a18-harness",
    environment: "node",
    include: ["tests/qa/integration/a18-transfer-drill.test.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
