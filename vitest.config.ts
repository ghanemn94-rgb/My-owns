// Root Vitest config (ADR-0012). Four projects:
//   unit-node              - pure unit tests of API/worker/packages (no network, no database)
//   unit-web               - React component/unit tests in jsdom (apps/web/vitest.config.ts)
//   unit-formula-nocodegen - the formula engine tests again, in a Node process started with
//                            --disallow-code-generation-from-strings (ADR-0024 §6, F-DG3-100)
//   integration            - tests against a real, disposable PostgreSQL database per run (TEST_DATABASE_ADMIN_URL)
// qa-verifier's acceptance suites live under tests/qa/{unit,integration}/ and join the matching project.
import { configDefaults, defineConfig } from "vitest/config";

/** The canary only holds in the no-codegen process, so it runs in that project alone. */
const NOCODEGEN_CANARY = "packages/shared/src/formula/**/*.nocodegen.test.ts";
const NOCODEGEN_PROJECT = "unit-formula-nocodegen";
const NOCODEGEN_FLAG = "--disallow-code-generation-from-strings";
/** Lets tinypool start a fork under the flag (see the file header); it enables no code generation. */
const NOCODEGEN_PRELOAD = new URL("./packages/shared/src/formula/test-support/nocodegen-preload.mjs", import.meta.url)
  .href;

/**
 * The --project names selected on this Vitest command line. Vitest 3.2 takes the forks pool execArgv from the ROOT
 * poolOptions only (a project-level poolOptions.forks.execArgv is ignored), worker threads refuse the flag
 * (ERR_WORKER_INVALID_EXEC_ARGV) and node:vm contexts (vmForks) re-enable string code generation. So the no-codegen
 * project runs as its own Vitest invocation (`pnpm test` runs it after unit-node and unit-web), and only that
 * invocation starts its forks with the flag.
 */
const selectedProjects = process.argv.flatMap((arg, i, all) =>
  arg === "--project" && all[i + 1] !== undefined
    ? [all[i + 1]]
    : arg.startsWith("--project=")
      ? [arg.slice("--project=".length)]
      : [],
);
const nocodegenRun = selectedProjects.includes(NOCODEGEN_PROJECT);
if (nocodegenRun && selectedProjects.length > 1) {
  throw new Error(
    `Run --project ${NOCODEGEN_PROJECT} in its own vitest invocation: its forks start with ${NOCODEGEN_FLAG}, which the other projects must not inherit.`,
  );
}

export default defineConfig({
  test: {
    // Root-level, so Vitest honours it; empty except in the no-codegen invocation (see selectedProjects above).
    poolOptions: { forks: { execArgv: nocodegenRun ? [NOCODEGEN_FLAG, "--import", NOCODEGEN_PRELOAD] : [] } },
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
          exclude: [...configDefaults.exclude, NOCODEGEN_CANARY],
        },
      },
      {
        // ADR-0024 §6 run-time guard (F-DG3-100): the whole formula test corpus (formula.test.ts, fuzz.test.ts and every
        // other test under packages/shared/src/formula) runs a second time in forked Node processes started with
        // --disallow-code-generation-from-strings. There, eval and every Function, AsyncFunction or GeneratorFunction
        // construction from a string throw EvalError, however the constructor was reached and whatever the key was
        // spelled. Any engine path that generates code from a string, and that a test exercises, fails here. The canary
        // (*.nocodegen.test.ts) proves the flag is active, so the guard cannot silently disappear: run this project in any
        // other way (without --project unit-formula-nocodegen) and the canary fails. Vitest itself is unaffected: it
        // loads modules through node:vm script compilation, which the flag does not restrict.
        resolve: { conditions: ["@mth/source"] },
        ssr: { resolve: { conditions: ["@mth/source"], externalConditions: ["@mth/source"] } },
        test: {
          name: NOCODEGEN_PROJECT,
          environment: "node",
          include: ["packages/shared/src/formula/**/*.test.ts"],
          pool: "forks",
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
