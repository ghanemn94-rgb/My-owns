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
          include: ["apps/api/src/**/*.test.ts", "apps/worker/src/**/*.test.ts", "packages/*/src/**/*.test.ts", "tests/qa/unit/**/*.test.ts"],
        },
      },
      "apps/web/vitest.config.ts",
      {
        resolve: { conditions: ["@mth/source"] },
        ssr: { resolve: { conditions: ["@mth/source"], externalConditions: ["@mth/source"] } },
        test: {
          name: "integration",
          environment: "node",
          include: ["apps/*/test/integration/**/*.test.ts", "packages/*/test/integration/**/*.test.ts", "tests/qa/integration/**/*.test.ts"],
          // One disposable database per run; created/dropped by the global setup owned by backend-workflow-engineer.
          globalSetup: ["packages/db/test/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
        },
      },
    ],
  },
});
