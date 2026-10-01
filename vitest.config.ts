// Root Vitest config (ADR-0012). Three projects:
//   unit-node   - pure unit tests of API/worker/packages (no network, no database)
//   unit-web    - React component/unit tests in jsdom (apps/web/vitest.config.ts)
//   integration - tests against a real, disposable PostgreSQL database per run (TEST_DATABASE_ADMIN_URL)
// qa-verifier's acceptance suites live under tests/qa/{unit,integration}/ and join the matching project.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { conditions: ["@mth/source"] },
        // Node-environment tests transform workspace deps through Vite's SSR pipeline, which uses its own condition
        // list; without this, `@mth/source` is honored only by the non-SSR resolver and tests load stale built dist
        // (T-DG1-BE R-1). Mirror the source condition into SSR resolution and externalization.
        ssr: { resolve: { conditions: ["@mth/source"], externalConditions: ["@mth/source"] } },
        test: {
          name: "unit-node",
          environment: "node",
          include: [
            "apps/api/src/**/*.test.ts",
            "apps/worker/src/**/*.test.ts",
            "packages/*/src/**/*.test.ts",
            "tests/qa/unit/**/*.test.ts",
          ],
        },
      },
      "apps/web/vitest.config.ts",
      {
        resolve: { conditions: ["@mth/source"] },
        ssr: { resolve: { conditions: ["@mth/source"], externalConditions: ["@mth/source"] } },
        test: {
          name: "integration",
          environment: "node",
          include: [
            "apps/*/test/integration/**/*.test.ts",
            "packages/*/test/integration/**/*.test.ts",
            "tests/qa/integration/**/*.test.ts",
          ],
          // One disposable database per run; created/dropped by the global setup owned by backend-workflow-engineer.
          globalSetup: ["packages/db/test/global-setup.ts"],
          // Integration files MUST run serially: they share the disposable database, and project-level
          // `fileParallelism` is not honored by this vitest (F-DG1-009). `poolOptions.forks.singleFork` IS honored
          // per project and runs every file of this project in a single fork, one after another, so no two integration
          // files run concurrently (no cross-file row pollution, and a forced database drop never races another file).
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
          fileParallelism: false,
          testTimeout: 30_000,
          // F-DG1-136: hooks get the same budget as tests. A teardown afterAll (DDL + api.close() + dropScratchDatabase(),
          // which itself waits up to 10s for other backends to disconnect) must not hit vitest's default 10_000 ms hookTimeout.
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
