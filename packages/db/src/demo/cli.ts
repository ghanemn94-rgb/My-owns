// `mth-db seed-demo` and `mth-db reset-demo` (ADR-0050 §3, §6, §9; T-DG5-BE-S). Called by ../cli.ts.
//
//   seed-demo   (DATABASE_OWNER_URL; a migrated, EMPTY database) refused (exit 3, nothing changed) when MTH_ENV is
//               production, the database is production-marked, unmarked but not empty, or already a demo database.
//   reset-demo  (MTH_ENV=demo, MTH_DEMO_ADMIN_DATABASE_URL, DATABASE_OWNER_URL of the demo database) refused (exit 3)
//               otherwise, or when the target database is not a demo database.
// Both print the run number, the record counts and the checksum. Everything they create is SYNTHETIC: an illustrative
// example, not Mobily actual performance; a demo approval approves nothing real.
import { DemoRefused } from "./guard.ts";
import { resetDemo } from "./reset.ts";
import { seedDemo, type DemoRunSummary } from "./seed.ts";

export interface DemoCliConfig {
  readonly mthEnv: string;
  readonly ownerUrl: string;
  readonly demoAdminUrl: string | null;
}

export interface DemoCliIo {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const consoleIo: DemoCliIo = { out: (l) => console.log(l), err: (l) => console.error(l) };

function report(command: string, s: DemoRunSummary, io: DemoCliIo): void {
  io.out(`mth-db ${command}: SYNTHETIC demonstration dataset (illustrative example; not Mobily actual performance)`);
  io.out(`mth-db ${command}: run ${s.runNo} (${s.runKind}), ${s.seededRecords} seeded record(s)`);
  for (const [table, n] of Object.entries(s.recordCounts)) if (n > 0) io.out(`count  ${table}\t${n}`);
  io.out(`checksum  ${s.checksumSha256}`);
  io.out(
    `coverage  ${s.coverageComplete ? "complete" : "INCOMPLETE"}` +
      (s.coverageNotImplemented.length > 0 ? ` (${s.coverageNotImplemented.length} condition(s) not implemented)` : ""),
  );
}

/** Runs one demo command; returns the exit code (0, or 3 when refused). Other errors propagate (exit 1). */
export async function runDemoCommand(
  command: "seed-demo" | "reset-demo",
  config: DemoCliConfig,
  io: DemoCliIo = consoleIo,
): Promise<number> {
  try {
    const summary =
      command === "seed-demo"
        ? await seedDemo(config.ownerUrl, {
            mthEnv: config.mthEnv,
            runKind: "seed",
            requestedVia: "cli",
            requestedBy: null,
          })
        : await resetDemo({
            mthEnv: config.mthEnv,
            adminUrl: config.demoAdminUrl,
            ownerUrl: config.ownerUrl,
            requestedVia: "cli",
            requestedBy: null,
            log: (l) => io.out(`mth-db reset-demo: ${l}`),
          });
    report(command, summary, io);
    return 0;
  } catch (e) {
    if (e instanceof DemoRefused) {
      io.err(e.message);
      return e.exitCode;
    }
    throw e;
  }
}
