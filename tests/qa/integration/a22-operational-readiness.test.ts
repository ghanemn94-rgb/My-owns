// A22 "Operational readiness" for P5 (qa-verifier, T-DG5-QA-F): "Health checks, logs, error alerts, admin job visibility
// and production/demo separation are demonstrated" (master prompt §20).
//
// Binding row texts (docs/delivery/requirements.csv), each tested literally:
//  - REQ-S12-022 "the jobs screen shows last success and next run for each scheduled job; a non-admin gets 403" (API
//    part; the screen itself is e2e/a22-operations-jobs.spec.ts);
//  - REQ-S18-003 "after production initialization, a query finds zero demo records and zero demo users; the demo seed
//    command exits with an error in production mode";
//  - REQ-S18-001 "running the reset twice yields identical record counts and checksums" (+ ADR-0050 §1/§3: a
//    production database reports `production`, demo seeding into a non-empty database is refused, and the demo reset
//    discards only demo data). The "synthetic label on every demo screen and export in en and ar" clause is checked
//    by the text catalogue test (tests/qa/unit/a22-s21-001-text-scan.test.ts) only; see the handback.
// REQ-S21-001's text scan is tests/qa/unit/a22-s21-001-text-scan.test.ts.
//
// The jobs view runs on its own scratch database with the REAL API and the REAL worker (run-now is consumed by the
// worker). The environment checks run the BUILT database CLI (`node packages/db/dist/cli.js`, the `mth-db` binary of
// the package) as a separate process on scratch databases of this run's disposable cluster, exactly as an operator
// would; the API reads the result through GET /api/v1/environment. All data is SYNTHETIC; a demo approval approves
// nothing real, and nothing here touches the engineering gates DG0-DG7.
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RunningWorker } from "../../../apps/worker/src/index.ts";
import { migrate } from "../../../packages/db/src/migrate.ts";
import {
  createScratchDatabase,
  dropScratchDatabase,
  roleUrl,
  testDatabase,
} from "../../../packages/db/test/helpers.ts";
import {
  etagOf,
  inProcessWorker,
  orgWorld,
  qaBoss,
  scratchEnv,
  waitFor,
  type Body,
  type OrgWorld,
  type ScratchEnv,
} from "../support/a13-durable.ts";
import {
  call,
  createOrg,
  createPool,
  createUser,
  expectProblem,
  signIn,
  startApi,
  type TestApi,
} from "../support/api.ts";

const JOBS = "/api/v1/admin/jobs";
const RIYADH = "Asia/Riyadh";

// ------------------------------------------------------------------ REQ-S12-022

/** The next instant after `from` at which a daily "M H * * *" cron fires in Asia/Riyadh (UTC+3, no DST). */
function nextDaily(cron: string, from: Date): string | null {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(cron);
  if (!m) return null;
  const [minute, hour] = [Number(m[1]), Number(m[2])];
  const offsetMs = 3 * 3_600_000;
  const local = new Date(from.getTime() + offsetMs);
  let candidate = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute) - offsetMs;
  if (candidate <= from.getTime()) candidate += 86_400_000;
  return new Date(candidate).toISOString();
}

describe("REQ-S12-022: the jobs view shows last success and next run for each scheduled job; a non-admin gets 403", () => {
  let env: ScratchEnv;
  let boss: ReturnType<typeof qaBoss>;
  let worker: RunningWorker;
  let w: OrgWorld;
  beforeAll(async () => {
    env = await scratchEnv("mth_qa_a22_jobs");
    boss = qaBoss(env.appUrl, "qa-a22-boss");
    await boss.start();
    worker = await inProcessWorker(env, boss);
    w = await orgWorld(env.api);
  }, 120_000);
  afterAll(async () => {
    await worker?.stop().catch(() => undefined);
    await boss?.stop({ graceful: false, wait: true, timeout: 5000 }).catch(() => undefined);
    await env?.close();
  });

  it("lists every job_schedule row: never-run shows lastSuccessAt null; nextRunAt is the cron's next instant in its time zone", async () => {
    const before = Date.now();
    const r = await call<Body>(env.api.app, "GET", JOBS, { session: w.tech.session });
    expect(r.status).toBe(200);
    const schedules = await env.api.db
      .selectFrom("job_schedule")
      .select(["code", "cron", "timezone", "enabled"])
      .execute();
    expect(schedules.length).toBeGreaterThan(0);
    const items = r.body.items as Body[];
    expect(items.map((i) => i.code).sort(), "one row per scheduled job").toEqual(schedules.map((s) => s.code).sort());
    for (const s of schedules) {
      const job = items.find((i) => i.code === s.code)!;
      expect([s.code, job.cron, job.timezone, job.enabled]).toEqual([s.code, s.cron, s.timezone, s.enabled]);
      expect([s.code, job.lastSuccessAt, job.lastOutcome], "never run: null, not a time or OK").toEqual([
        s.code,
        null,
        null,
      ]);
      expect([s.code, typeof job.nextRunAt, job.nextRunUnknownReason]).toEqual([s.code, "string", null]);
      expect(Date.parse(job.nextRunAt), `${s.code}: next run is in the future`).toBeGreaterThan(before - 1000);
      if (s.timezone === RIYADH) {
        const expected = nextDaily(s.cron, new Date(before));
        if (expected !== null) expect([s.code, job.nextRunAt]).toEqual([s.code, expected]);
      }
      expect(job.openFailures).toBe(0);
    }
  });

  it(
    "after a run, the job shows its last success, last outcome and the run in its history",
    { timeout: 90_000 },
    async () => {
      const code = "governance.meeting_cutoff_scan";
      const ran = await call<Body>(env.api.app, "POST", `${JOBS}/${code}/run`, { session: w.tech.session });
      expect(ran.status, JSON.stringify(ran.body)).toBe(202);
      const job = await waitFor(
        async () => {
          const r = await call<Body>(env.api.app, "GET", JOBS, { session: w.tech.session });
          const j = (r.body.items as Body[]).find((i) => i.code === code);
          return j?.lastSuccessAt ? j : null;
        },
        "the run is recorded",
        60_000,
      );
      expect(job.lastOutcome).toBe("succeeded");
      expect(Date.parse(job.lastSuccessAt)).toBeLessThanOrEqual(Date.now() + 1000);
      expect(job.nextRunAt).not.toBeNull();
      const detail = await call<Body>(env.api.app, "GET", `${JOBS}/${code}`, { session: w.tech.session });
      expect(detail.status).toBe(200);
      expect(detail.body.runs.length).toBeGreaterThanOrEqual(1);
      expect(detail.body.runs[0]).toMatchObject({ outcome: "succeeded", errorCode: null });
    },
  );

  it("a disabled schedule shows next run null 'disabled' and refuses run-now with 422 job.schedule_disabled", async () => {
    const code = "launch.day_ninety_tests";
    const S = `/api/v1/admin/job-schedules/${code}`;
    const list = await call<Body>(env.api.app, "GET", "/api/v1/admin/job-schedules?limit=100", {
      session: w.tech.session,
    });
    expect(list.status).toBe(200);
    const cur = (list.body.items as Body[]).find((s) => s.code === code);
    const off = await call<Body>(env.api.app, "PATCH", S, {
      session: w.tech.session,
      headers: { "if-match": `"${cur.version}"` },
      body: { enabled: false },
    });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    try {
      const r = await call<Body>(env.api.app, "GET", JOBS, { session: w.tech.session });
      const job = (r.body.items as Body[]).find((i) => i.code === code);
      expect(job).toMatchObject({ enabled: false, nextRunAt: null, nextRunUnknownReason: "disabled" });
      const run = await call<Body>(env.api.app, "POST", `${JOBS}/${code}/run`, { session: w.tech.session });
      expectProblem(run, 422, run.body.type);
      expect(run.body.code).toBe("job.schedule_disabled");
    } finally {
      const back = await call<Body>(env.api.app, "PATCH", S, {
        session: w.tech.session,
        headers: { "if-match": etagOf(off) },
        body: { enabled: true },
      });
      expect(back.status).toBe(200);
    }
  });

  it("every non-admin role gets 403 on the view, a job's detail and run-now", async () => {
    for (const [role, p] of [
      ["TL", w.lead],
      ["TO", w.office],
      ["AUD", w.auditor],
      ["ADM_METHOD", w.method],
    ] as const) {
      for (const [method, url] of [
        ["GET", JOBS],
        ["GET", `${JOBS}/governance.meeting_cutoff_scan`],
        ["POST", `${JOBS}/governance.meeting_cutoff_scan/run`],
      ] as const) {
        const r = await call<Body>(env.api.app, method, url, { session: p.session });
        expect([role, method, url, r.status]).toEqual([role, method, url, 403]);
        expectProblem(r, 403, r.body.type);
      }
    }
    const anonymous = await call<Body>(env.api.app, "GET", JOBS, {});
    expect(anonymous.status).toBe(401);
  });
});

// ------------------------------------------------------------------ REQ-S18-003, REQ-S18-001 (production/demo separation)

interface CliResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the BUILT `mth-db` (packages/db/dist/cli.js) as an operator would, with only the given environment. */
function mthDb(args: readonly string[], env: Record<string, string>): CliResult {
  const r = spawnSync(process.execPath, ["packages/db/dist/cli.js", ...args], {
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: process.env["HOME"] ?? "/tmp",
      LOG_LEVEL: "warn",
      NODE_ENV: "production",
      ...env,
    },
    encoding: "utf8",
    timeout: 300_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

async function tableCounts(url: string): Promise<Record<string, number>> {
  const pool = createPool(url, { max: 1, applicationName: "qa-a22-counts" });
  try {
    const tables = (
      await pool.query<{ t: string }>(
        "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY 1",
      )
    ).rows.map((r) => r.t);
    const out: Record<string, number> = {};
    for (const t of tables)
      out[t] = Number((await pool.query(`SELECT count(*)::int AS n FROM public."${t}"`)).rows[0].n);
    return out;
  } finally {
    await pool.end();
  }
}

async function scalar(url: string, sql: string): Promise<unknown> {
  const pool = createPool(url, { max: 1, applicationName: "qa-a22-q" });
  try {
    return (await pool.query(sql)).rows[0]?.v;
  } finally {
    await pool.end();
  }
}

describe("REQ-S18-003 / REQ-S18-001: production and demo databases are separate, and a production database stays clean", () => {
  const adminUrl = () => testDatabase().adminUrl;
  const made: string[] = [];
  let prodDb: string;
  let demoDb: string;
  const su = (db: string) => roleUrl(adminUrl(), db, null);
  const owner = (db: string) => roleUrl(adminUrl(), db, "mth_owner");
  const ISSUER = "urn:mth:qa-a22-prod";

  beforeAll(async () => {
    prodDb = await createScratchDatabase(adminUrl(), "mth_qa_a22_prod");
    demoDb = await createScratchDatabase(adminUrl(), "mth_qa_a22_demo");
    made.push(prodDb, demoDb);
    for (const db of [prodDb, demoDb]) await migrate(owner(db));
  }, 120_000);
  afterAll(async () => {
    for (const db of made) await dropScratchDatabase(adminUrl(), db).catch(() => undefined);
  });

  it(
    "production initialization (mth-db bootstrap): zero demo records, zero demo users; GET /environment is production",
    { timeout: 120_000 },
    async () => {
      const r = mthDb(
        [
          "bootstrap",
          "--org-code",
          "QAPROD",
          "--org-name-en",
          "Synthetic QA production organization",
          "--org-name-ar",
          "مؤسسة إنتاج تجريبية",
          "--admin-name",
          "Synthetic QA administrator",
          "--admin-issuer",
          ISSUER,
          "--admin-subject",
          "qa-a22-admin",
        ],
        { NODE_ENV: "production", MTH_ENV: "production", DATABASE_OWNER_URL: owner(prodDb) },
      );
      expect([r.status, r.stderr], r.stdout).toEqual([0, ""]);
      // The REQ-S18-003 query.
      expect(await scalar(su(prodDb), "SELECT count(*)::int AS v FROM demo_seed_record")).toBe(0);
      expect(await scalar(su(prodDb), "SELECT count(*)::int AS v FROM demo_dataset_run")).toBe(0);
      expect(
        await scalar(su(prodDb), "SELECT count(*)::int AS v FROM app_user WHERE id::text LIKE '01995000-%'"),
        "no user of the demo id namespace",
      ).toBe(0);
      expect(
        await scalar(
          su(prodDb),
          "SELECT count(*)::int AS v FROM app_user u WHERE EXISTS (SELECT 1 FROM user_identity i WHERE i.user_id = u.id)",
        ),
        "the bootstrap administrator is the only person who can sign in",
      ).toBe(1);
      expect(
        await scalar(su(prodDb), `SELECT count(*)::int AS v FROM user_identity WHERE issuer <> '${ISSUER}'`),
        "no identity of another issuer (no demo or dev credential)",
      ).toBe(0);
      expect(await scalar(su(prodDb), "SELECT count(*)::int AS v FROM transformation")).toBe(0);
      expect(await scalar(su(prodDb), "SELECT environment_kind AS v FROM deployment_environment")).toBe("production");

      const api = await startApi({ database: prodDb });
      try {
        const subject = (await scalar(su(prodDb), "SELECT subject AS v FROM user_identity")) as string;
        void subject;
        const org = (await scalar(su(prodDb), "SELECT id AS v FROM organization")) as string;
        const u = await createUser(api.db, org); // a signed-in reader (dev-login issuer of the test harness)
        const s = await signIn(api.app, u.subject);
        const e = await call<Body>(api.app, "GET", "/api/v1/environment", { session: s });
        expect(e.status).toBe(200);
        expect(e.body).toEqual({
          kind: "production",
          synthetic: false,
          datasetCode: null,
          datasetVersion: null,
          syntheticClockAt: null,
        });
      } finally {
        await api.close();
      }
    },
  );

  it(
    "the demo seed command exits with an error in production mode, on a production database and on a non-empty one; nothing changes",
    { timeout: 300_000 },
    async () => {
      const before = await tableCounts(su(prodDb));
      const inProdMode = mthDb(["seed-demo"], { NODE_ENV: "production", DATABASE_OWNER_URL: owner(demoDb) });
      expect([inProdMode.status, inProdMode.stderr.trim()]).toEqual([
        3,
        "mth-db seed-demo: refused: MTH_ENV is production",
      ]);
      const onProd = mthDb(["seed-demo"], {
        NODE_ENV: "production",
        MTH_ENV: "demo",
        DATABASE_OWNER_URL: owner(prodDb),
      });
      expect([onProd.status, onProd.stderr.trim()]).toEqual([
        3,
        "mth-db seed-demo: refused: this database was initialized for production",
      ]);
      expect(await tableCounts(su(prodDb)), "the refused seed changed nothing").toEqual(before);
      expect(await scalar(su(demoDb), "SELECT count(*)::int AS v FROM demo_seed_record")).toBe(0);

      // An unmarked database that already holds data (e.g. migrated before P5 and in use) is not seeded either.
      const used = await createScratchDatabase(adminUrl(), "mth_qa_a22_used");
      made.push(used);
      await migrate(owner(used));
      const api = await startApi({ database: used });
      try {
        const org = await createOrg(api.db);
        await createUser(api.db, org.id);
      } finally {
        await api.close();
      }
      const usedBefore = await tableCounts(su(used));
      const onUsed = mthDb(["seed-demo"], { MTH_ENV: "demo", DATABASE_OWNER_URL: owner(used) });
      expect([onUsed.status, onUsed.stderr.trim()]).toEqual([
        3,
        "mth-db seed-demo: refused: this database is not empty",
      ]);
      expect(await tableCounts(su(used))).toEqual(usedBefore);
    },
  );

  it(
    "a separately initialized demo database: seeded, reported synthetic; reset twice gives identical counts and checksums; the production database is untouched",
    { timeout: 600_000 },
    async () => {
      const prodBefore = await tableCounts(su(prodDb));
      const prodAuditMax = await scalar(su(prodDb), "SELECT max(id::text) AS v FROM audit_event");

      const seeded = mthDb(["seed-demo"], { MTH_ENV: "demo", DATABASE_OWNER_URL: owner(demoDb) });
      expect(seeded.status, seeded.stderr).toBe(0);
      expect(seeded.stdout).toContain("SYNTHETIC demonstration dataset");
      expect(await scalar(su(demoDb), "SELECT environment_kind AS v FROM deployment_environment")).toBe("demo");

      const again = mthDb(["seed-demo"], { MTH_ENV: "demo", DATABASE_OWNER_URL: owner(demoDb) });
      expect([again.status, again.stderr.trim()]).toEqual([
        3,
        "mth-db seed-demo: refused: this database is already a demo database; use reset-demo",
      ]);
      const boot = mthDb(
        [
          "bootstrap",
          "--org-code",
          "QADEMO",
          "--org-name-en",
          "x",
          "--org-name-ar",
          "x",
          "--admin-name",
          "x",
          "--admin-issuer",
          ISSUER,
          "--admin-subject",
          "x",
        ],
        { MTH_ENV: "demo", DATABASE_OWNER_URL: owner(demoDb) },
      );
      expect([boot.status, boot.stderr.trim()]).toEqual([
        3,
        "mth-db bootstrap: refused: this database is a demo database",
      ]);

      const resetEnv = {
        MTH_ENV: "demo",
        DATABASE_OWNER_URL: owner(demoDb),
        MTH_DEMO_ADMIN_DATABASE_URL: roleUrl(adminUrl(), "postgres", null),
      };
      const refusedInProd = mthDb(["reset-demo"], { ...resetEnv, MTH_ENV: "production" });
      expect([refusedInProd.status, refusedInProd.stderr.trim()]).toEqual([
        3,
        "mth-db reset-demo: refused: MTH_ENV is not demo",
      ]);
      const refusedOnProd = mthDb(["reset-demo"], { ...resetEnv, DATABASE_OWNER_URL: owner(prodDb) });
      expect([refusedOnProd.status, refusedOnProd.stderr.trim()]).toEqual([
        3,
        "mth-db reset-demo: refused: the target database is not a demo database",
      ]);
      expect(await tableCounts(su(prodDb)), "the refused reset changed nothing in production").toEqual(prodBefore);

      const parse = (out: string) => ({
        counts: out
          .split("\n")
          .filter((l) => l.startsWith("count  "))
          .sort(),
        checksum: /checksum {2}([0-9a-f]{64})/.exec(out)?.[1] ?? null,
      });
      const first = mthDb(["reset-demo"], resetEnv);
      expect(first.status, first.stderr).toBe(0);
      const firstCounts = await tableCounts(su(demoDb));
      const second = mthDb(["reset-demo"], resetEnv);
      expect(second.status, second.stderr).toBe(0);
      const secondCounts = await tableCounts(su(demoDb));
      const a = parse(first.stdout);
      const b = parse(second.stdout);
      expect(a.checksum).toMatch(/^[0-9a-f]{64}$/);
      expect(b, "two resets: identical record counts and checksum (CLI report)").toEqual(a);
      expect(a.counts.length).toBeGreaterThan(0);
      // Independently of the CLI's own report: every table's row count is identical after the two resets.
      expect(secondCounts, "two resets: identical row counts of every table").toEqual(firstCounts);
      expect(seeded.stdout.match(/checksum {2}([0-9a-f]{64})/)?.[1], "the reset re-creates the seeded state").toBe(
        a.checksum,
      );

      // The status view of the demo deployment reports the same run data.
      const api = await startApi({ database: demoDb, env: { MTH_ENV: "demo" } });
      try {
        const org = (await scalar(su(demoDb), "SELECT organization_id::text AS v FROM app_user LIMIT 1")) as string;
        const u = await createUser(api.db, org);
        const s = await signIn(api.app, u.subject);
        const e = await call<Body>(api.app, "GET", "/api/v1/environment", { session: s });
        expect(e.status).toBe(200);
        expect(e.body).toMatchObject({ kind: "demo", synthetic: true, datasetCode: "international_roaming" });
      } finally {
        await api.close();
      }

      // "The demo reset discards only demo data": the production database is exactly as before.
      expect(await tableCounts(su(prodDb))).toEqual(prodBefore);
      expect(await scalar(su(prodDb), "SELECT max(id::text) AS v FROM audit_event")).toBe(prodAuditMax);
    },
  );

  it("the in-app demo reset is refused in a production database (409 environment.not_demo)", async () => {
    const api: TestApi = await startApi({ database: prodDb });
    try {
      const w = await orgWorld(api);
      const st = await call<Body>(api.app, "GET", "/api/v1/admin/environment", { session: w.tech.session });
      expect(st.status).toBe(200);
      expect(st.body).toMatchObject({ kind: "production", latestRun: null });
      const r = await call<Body>(api.app, "POST", "/api/v1/admin/environment/demo-resets", {
        session: w.tech.session,
        headers: { "if-match": etagOf(st) },
      });
      expectProblem(r, 409, r.body.type);
      expect(r.body.code).toBe("environment.not_demo");
    } finally {
      await api.close();
    }
  });
});
