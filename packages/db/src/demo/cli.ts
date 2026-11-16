// `mth-db seed-demo` and `mth-db reset-demo` (ADR-0050 §3, §6, §9; T-DG5-BE-S). Called by ../cli.ts.
//
//   seed-demo   (DATABASE_OWNER_URL; a migrated, EMPTY database) refused (exit 3, nothing changed) when MTH_ENV is
//               production, the database is production-marked, unmarked but not empty, or already a demo database.
//   reset-demo  (MTH_ENV=demo, MTH_DEMO_ADMIN_DATABASE_URL, DATABASE_OWNER_URL of the demo database) refused (exit 3)
//               otherwise, or when the target database is not a demo database.
// With AUTH_MODE=dev (never NODE_ENV=production) both also bind each demo user to the dev issuer (D-165).
// Both take `--as-of <YYYY-MM-DD>` (ADR-0064 A4.6): its month is the period anchor of the date-relative reporting
// periods (default: the real date in the demo organization's timezone); a date that is invalid or after today is
// refused with exit 2, an anchor beyond 2099-12 with exit 1, and nothing is written.
// Both print the run number, the record counts and the checksum. Everything they create is SYNTHETIC: an illustrative
// example, not Mobily actual performance; a demo approval approves nothing real.
import { DemoPeriodAnchorRefused, dateInZone, isCalendarDate } from "./data/kpis.ts";
import { DEMO_ORGANIZATION_TIMEZONE, DemoRefused } from "./guard.ts";
import { resetDemo } from "./reset.ts";
import { seedDemo, type DemoRunSummary } from "./seed.ts";

export interface DemoCliConfig {
  readonly mthEnv: string;
  readonly ownerUrl: string;
  readonly demoAdminUrl: string | null;
  /** D-165: bind the demo users to the dev issuer too (set by ../cli.ts in a dev-mode stack only). */
  readonly devIssuerBinding?: boolean;
  /** ADR-0064 A4.6: `--as-of <YYYY-MM-DD>` as given (validated here). */
  readonly asOf?: string | undefined;
  /** The real instant `--as-of` is compared with (tests pin it); default now. */
  readonly now?: Date;
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
  io.out(periodLine(command, s));
}

/** The A4.6 line (ADR-0064 A4.7). */
export function periodLine(command: string, s: DemoRunSummary): string {
  const head = `mth-db ${command}: reporting periods relative to ${s.periodAsOf} (${s.periodTimezone}): `;
  return s.periodsGenerated === 0
    ? `${head}0 generated, current period ${s.periodAnchor} not generated (anchor not after 2026-09)`
    : `${head}${s.periodsGenerated} generated, current period ${s.periodAnchor} open`;
}

/** The A4.6 `--as-of` refusal (exit 2), or null when the value is a valid date not after today. */
export function asOfRefusal(command: string, asOf: string | undefined, now: Date): string | null {
  if (asOf === undefined) return null;
  const today = dateInZone(now, DEMO_ORGANIZATION_TIMEZONE);
  return isCalendarDate(asOf) && asOf <= today
    ? null
    : `mth-db ${command}: refused: --as-of must be a valid date not after today`;
}

/** Runs one demo command; returns the exit code (0, or 3 when refused). Other errors propagate (exit 1). */
export async function runDemoCommand(
  command: "seed-demo" | "reset-demo",
  config: DemoCliConfig,
  io: DemoCliIo = consoleIo,
): Promise<number> {
  const refusedAsOf = asOfRefusal(command, config.asOf, config.now ?? new Date());
  if (refusedAsOf !== null) {
    io.err(refusedAsOf);
    return 2;
  }
  const asOf = config.asOf === undefined ? {} : { asOf: config.asOf };
  try {
    const summary =
      command === "seed-demo"
        ? await seedDemo(config.ownerUrl, {
            mthEnv: config.mthEnv,
            runKind: "seed",
            requestedVia: "cli",
            requestedBy: null,
            devIssuerBinding: config.devIssuerBinding === true,
            ...asOf,
          })
        : await resetDemo({
            mthEnv: config.mthEnv,
            adminUrl: config.demoAdminUrl,
            ownerUrl: config.ownerUrl,
            requestedVia: "cli",
            requestedBy: null,
            devIssuerBinding: config.devIssuerBinding === true,
            log: (l) => io.out(`mth-db reset-demo: ${l}`),
            ...asOf,
          });
    report(command, summary, io);
    return 0;
  } catch (e) {
    if (e instanceof DemoRefused) {
      io.err(e.message);
      return e.exitCode;
    }
    if (e instanceof DemoPeriodAnchorRefused) {
      io.err(`mth-db ${command}: refused: ${e.message}`);
      return e.exitCode;
    }
    throw e;
  }
}
