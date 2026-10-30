// T-DG6-BE-J (ADR-0053 §1; REQ-S16-029): the job identity declarations in kit.ts equal the rows migration 0114 seeds
// (the seed.test.ts pattern: the SQL is read as text, no database), every queue of apps/worker/src/queues/** declares
// exactly one identity, and every declared code is a read or write permission (never configure, business_approval
// or finance_validation: a service identity never approves anything). Also the pure parts of service-scope.ts and
// defineJob. The database-backed proofs (scope, parity with the API ReadScope, the missing row) are in
// apps/api/test/integration/operations/service-identity-scope.test.ts.
import { readFileSync } from "node:fs";
import { PERMISSIONS } from "@mth/shared";
import { describe, expect, it } from "vitest";
import {
  defineJob,
  FAILURE_RETRY_QUEUE,
  isServiceIdentityError,
  JOB_FAILED_QUEUE,
  JOB_SERVICE_IDENTITIES,
  jobIdentityCode,
  jobIdentityDeclaration,
  principalOfIdentity,
  ServiceIdentityMissing,
  ServiceScopeViolation,
  type LoadedServiceIdentity,
} from "./kit.ts";
import { RUN_NOW_QUEUE } from "./job-runs.ts";
import { DOMAIN_QUEUES, QUEUES } from "./queues/index.ts";

/** The migrations that seed job identities, each with its VALUES table (T-DG6-BE-P added 0115, the search jobs). */
const MIGRATIONS = [
  {
    url: new URL("../../../packages/db/migrations/0114_p6_job_service_identities.sql", import.meta.url),
    table: "p6_job_identity",
  },
  {
    url: new URL("../../../packages/db/migrations/0115_p6_search_index_jobs.sql", import.meta.url),
    table: "p6_search_job_identity",
  },
  // T-DG6-BE-L2 (0116): the connector cadence job and the connector exception consumer.
  {
    url: new URL("../../../packages/db/migrations/0116_p6_connector_run_jobs.sql", import.meta.url),
    table: "p6_connector_job_identity",
  },
  // T-DG6-BE-K2: the three operations jobs (0117; renumbered from 0116 at the W9 merge).
  {
    url: new URL("../../../packages/db/migrations/0117_p6_operations_triggers_freshness.sql", import.meta.url),
    table: "p6_operations_job_identity",
  },
  // T-DG6-BE-I2 (0120): the notification channel fan-out and its delivery sweep.
  {
    url: new URL("../../../packages/db/migrations/0120_p6_notification_fanout_jobs.sql", import.meta.url),
    table: "p6_notification_job_identity",
  },
] as const;
const CATEGORY: ReadonlyMap<string, string> = new Map(Object.entries(PERMISSIONS));

interface SeededRow {
  readonly code: string;
  readonly queue: string;
  readonly codes: string[];
  readonly sensitive: string;
  readonly en: string;
  readonly ar: string;
}

/** The VALUES rows of the identity tables of 0114 and 0115, parsed from the SQL text. */
function seededRows(): SeededRow[] {
  return MIGRATIONS.flatMap((m) => seededRowsOf(readFileSync(m.url, "utf8"), m.table));
}

function seededRowsOf(sql: string, table: string): SeededRow[] {
  const start = sql.indexOf(`INSERT INTO ${table} VALUES`);
  expect(start, table).toBeGreaterThanOrEqual(0);
  const values = sql.slice(start, sql.indexOf("INSERT INTO service_identity", start));
  const row =
    /\('([0-9a-f-]{36})', '([^']+)', '([^']+)', (?:ARRAY\[([^\]]*)\]::text\[\]|'\{\}'::text\[\]), '([a-z_]+)', '((?:[^']|'')+)', '((?:[^']|'')+)'\)/g;
  const out: SeededRow[] = [];
  for (const m of values.matchAll(row))
    out.push({
      code: m[2]!,
      queue: m[3]!,
      codes: m[4] === undefined ? [] : [...m[4].matchAll(/'([^']+)'/g)].map((c) => c[1]!),
      sensitive: m[5]!,
      en: m[6]!.replace(/''/g, "'"),
      ar: m[7]!.replace(/''/g, "'"),
    });
  return out;
}

const identity = (over: Partial<LoadedServiceIdentity> = {}): LoadedServiceIdentity => ({
  id: "01920006-0114-7000-8000-0000000000ff",
  code: "job:kpi.recalculate",
  scopeLevel: "platform",
  organizationId: null,
  grantedPermissionCodes: ["transformation.read"],
  sensitiveAccess: "none",
  ...over,
});

describe("job service identities (ADR-0053 §1)", () => {
  it("declares exactly one identity per queue of apps/worker/src/queues/**", () => {
    const queues = new Set<string>([
      ...Object.values(QUEUES),
      ...DOMAIN_QUEUES.map((q) => q.name),
      FAILURE_RETRY_QUEUE,
      JOB_FAILED_QUEUE,
      RUN_NOW_QUEUE,
    ]);
    const declared = JOB_SERVICE_IDENTITIES.map((d) => d.queue);
    expect(new Set(declared).size).toBe(declared.length);
    expect([...declared].sort()).toEqual([...queues].sort());
    expect(declared).toHaveLength(49); // 40 (T-DG6-BE-J) + two search jobs (T-DG6-BE-P) + two connector jobs (T-DG6-BE-L2) + three operations jobs (T-DG6-BE-K2) + two notification jobs (T-DG6-BE-I2)
  });

  it("migrations 0114 and 0115 seed exactly the declarations (code, queue, codes, sensitive access, labels)", () => {
    const seeded = seededRows();
    expect(seeded).toHaveLength(JOB_SERVICE_IDENTITIES.length);
    const byQueue = new Map(seeded.map((r) => [r.queue, r]));
    for (const d of JOB_SERVICE_IDENTITIES) {
      const r = byQueue.get(d.queue);
      expect(r, d.queue).toBeDefined();
      expect(r).toEqual({
        code: jobIdentityCode(d.queue),
        queue: d.queue,
        codes: [...d.permissions],
        sensitive: d.sensitiveAccess,
        en: d.labelEn,
        ar: d.labelAr,
      });
    }
  });

  it("every declared code is a known read or write permission; no configure, approval or Finance code", () => {
    for (const d of JOB_SERVICE_IDENTITIES) {
      for (const code of d.permissions) expect(["read", "write"], `${d.queue}: ${code}`).toContain(CATEGORY.get(code));
      expect(d.scope).toBe("platform");
      expect(new Set(d.permissions).size).toBe(d.permissions.length);
    }
    // Only the benefit recalculations may count sensitive records, and only into aggregates (D-195 Q3).
    expect(
      JOB_SERVICE_IDENTITIES.filter((d) => d.sensitiveAccess === "aggregate_only")
        .map((d) => d.queue)
        .sort(),
    ).toEqual(["benefits.recalculate_pending", "benefits.value_decided"]);
  });

  it("defineJob refuses a queue without a declaration and a restated identity that differs", () => {
    const handle = async () => "ok";
    expect(() => defineJob({ queue: "nothing.declared", handle })).toThrow(/declares no service identity/);
    expect(() =>
      defineJob({
        queue: "kpi.recalculate",
        identity: { permissions: ["transformation.read", "user.read"], scope: "platform", sensitiveAccess: "none" },
        handle,
      }),
    ).toThrow(/differs from its declaration/);
    const ok = defineJob({
      queue: "kpi.recalculate",
      identity: { permissions: ["transformation.read"], scope: "platform", sensitiveAccess: "none" },
      handle,
    });
    expect(ok.queue).toBe("kpi.recalculate");
    expect(jobIdentityDeclaration("kpi.recalculate")?.permissions).toEqual(["transformation.read"]);
  });

  it("a platform identity acts per organization; an organization identity only in its own", () => {
    const orgA = "01920006-0114-7000-8000-00000000000a";
    const orgB = "01920006-0114-7000-8000-00000000000b";
    const p = principalOfIdentity(identity(), orgA);
    expect(p).toMatchObject({ kind: "service", code: "job:kpi.recalculate", organizationId: orgA });
    expect([...p.permissions]).toEqual(["transformation.read"]);
    const connector = identity({ code: "connector:x", scopeLevel: "organization", organizationId: orgA });
    expect(principalOfIdentity(connector, orgA).organizationId).toBe(orgA);
    expect(() => principalOfIdentity(connector, orgB)).toThrow(ServiceScopeViolation);
  });

  it("the refusals carry the exact ADR-0053 §2 codes and English texts", () => {
    const missing = new ServiceIdentityMissing();
    expect(missing.code).toBe("service_identity.missing");
    expect(missing.message).toBe("The job has no service identity, so it did not run.");
    const outside = new ServiceScopeViolation();
    expect(outside.code).toBe("service_identity.out_of_scope");
    expect(outside.message).toBe("The job tried to read a record outside its service identity's scope.");
    expect(isServiceIdentityError(missing)).toBe(true);
    expect(isServiceIdentityError({ code: "service_identity.out_of_scope" })).toBe(true);
    expect(isServiceIdentityError(new Error("x"))).toBe(false);
  });
});
