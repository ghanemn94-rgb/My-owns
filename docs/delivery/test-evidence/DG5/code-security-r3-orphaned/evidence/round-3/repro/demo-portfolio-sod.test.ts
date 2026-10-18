// code-security-reviewer, DG5 round 3 (T-DG5-REV-SEC-R3): database-level probe of T-DG5-BE-X2's new demo rows (the
// approved G4 portfolio, roaming-portfolio.ts, and the initiative business cases, business-cases.ts). Checked on a
// freshly seeded demo database, independently of the product's own tests:
//   (1) every validated business case baseline: validator <> author, and the validator holds finance.validate in the
//       transformation;
//   (2) every funding decision: the decider holds funding.approve in the transformation through a role whose code is
//       the recorded approver_role_code, the role is not technical_admin, no on-behalf-of;
//   (3) every selection: the decider holds portfolio.select; committed demand: committed_by holds capacity.commit;
//       approved milestones: approved_by holds roadmap.approve; launches: launched_by holds initiative.launch;
//       ranking snapshot: proposed_by holds prioritization.edit;
//   (4) every row of the new tables has an audit event for its creation (prior_version null) and one audit event per
//       version step, with prior/new versions contiguous;
//   (5) no gate exception exists, the counters carry the seeded codes (the next product DEC/BC codes cannot collide);
//   (6) the seed is refused for MTH_ENV=production and on a production-initialized database;
//   (7) no technical_admin role holds a business_approval or finance_validation permission, and the demo access
//       administrator holds no such permission through any assignment.
// How it runs (disposable clone only): copied to apps/api/test/integration/environment/zz-sec-r3-demo-sod.test.ts and run
// with `with-pg.sh npx vitest run --configLoader runner --project integration <file>`; deleted afterwards.
// All data is SYNTHETIC; nothing here approves anything real or touches DG0-DG7.
import { migrate, seedDemo, sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb, createPool } from "@mth/db";
import { DEMO_ANCHORS } from "../../../../../packages/db/src/demo/data/kpis.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";

const T = DEMO_ANCHORS.transformationId;
let scratch: string | null = null;
let ownerUrl = "";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pool: any;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rows = async <R,>(q: any): Promise<R[]> => (await q.execute(db)).rows as R[];

/** Users holding `perm` in T through an active scoped assignment (transformation T, its BU, or its organization). */
const holders = (perm: string, roleCode?: string) => sql<{ user_id: string; role_code: string; kind: string }>`
  SELECT DISTINCT a.user_id::text AS user_id, r.code AS role_code, r.kind
    FROM scoped_assignment a
    JOIN role r ON r.id = a.role_id
    JOIN role_permission p ON p.role_id = r.id AND p.permission_code = ${perm}
    JOIN transformation t ON t.id = ${T}::uuid
   WHERE a.revoked_at IS NULL AND (a.effective_to IS NULL OR a.effective_to > now())
     AND ((a.scope_type = 'transformation' AND a.scope_id = t.id)
       OR (a.scope_type = 'organization' AND a.scope_id = t.organization_id)
       OR (a.scope_type = 'business_unit' AND a.scope_id = t.business_unit_id))
     ${roleCode === undefined ? sql`` : sql`AND r.code = ${roleCode}`}`;

async function mustHold(perm: string, userId: string, what: string, roleCode?: string) {
  const h = await rows<{ user_id: string; role_code: string; kind: string }>(holders(perm, roleCode));
  const mine = h.filter((x) => x.user_id === userId);
  expect(mine.length, `${what}: ${userId} must hold ${perm}${roleCode ? ` as ${roleCode}` : ""}`).toBeGreaterThan(0);
  for (const m of mine) expect(m.kind, `${what}: ${m.role_code}`).not.toBe("technical_admin");
}

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_sec_r3_demo_sod");
  ownerUrl = roleUrl(adminUrl, scratch, "mth_owner");
  await migrate(ownerUrl);
  await seedDemo(ownerUrl, {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
    devIssuerBinding: true,
  });
  pool = createPool(ownerUrl, { max: 2, applicationName: "sec-r3-probe" });
  db = createDb(pool);
}, 300_000);

afterAll(async () => {
  await db?.destroy?.();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("SEC-R3 probe: the demo's approved G4 portfolio respects SoD, approvers and audit (synthetic)", () => {
  it("(1) validated baselines: validator is not the author and holds finance.validate", async () => {
    const cases = await rows<{ code: string; created_by: string; baseline_validated_by: string | null; level: string }>(
      sql`SELECT code, level, created_by::text AS created_by, baseline_validated_by::text AS baseline_validated_by
            FROM business_case WHERE transformation_id = ${T}::uuid ORDER BY code`,
    );
    expect(cases.map((c) => c.code)).toEqual(["BC-01", "BC-02", "BC-03", "BC-04"]);
    for (const c of cases) {
      expect(c.baseline_validated_by, c.code).not.toBeNull();
      expect(c.baseline_validated_by, `${c.code} validator is its author`).not.toBe(c.created_by);
      await mustHold("finance.validate", c.baseline_validated_by!, c.code);
    }
    const formulas = await rows<{ id: string; created_by: string; validated_by: string | null }>(
      sql`SELECT id::text AS id, created_by::text AS created_by, validated_by::text AS validated_by
            FROM benefit_formula_version WHERE transformation_id = ${T}::uuid`,
    );
    for (const f of formulas) if (f.validated_by !== null) expect(f.validated_by, f.id).not.toBe(f.created_by);
  });

  it("(2) funding decisions: by a holder of funding.approve through the recorded approver role, never on behalf", async () => {
    const f = await rows<{
      id: string;
      decided_by: string;
      approver_role_code: string;
      on_behalf_of_user_id: string | null;
      outcome: string;
      amount: string;
      decision_by: string;
      decision_kind: string;
    }>(
      sql`SELECT f.id::text AS id, f.decided_by::text AS decided_by, f.approver_role_code, f.on_behalf_of_user_id,
                 f.outcome, f.amount::text AS amount, d.decided_by::text AS decision_by, d.kind AS decision_kind
            FROM funding_decision f JOIN decision d ON d.id = f.decision_id
           WHERE f.transformation_id = ${T}::uuid ORDER BY f.id`,
    );
    expect(f).toHaveLength(3);
    for (const x of f) {
      expect([x.outcome, x.on_behalf_of_user_id, x.decision_kind], x.id).toEqual(["approved", null, "executive"]);
      expect(x.decision_by, `${x.id} canonical decision by the same decider`).toBe(x.decided_by);
      await mustHold("funding.approve", x.decided_by, `funding ${x.id}`, x.approver_role_code);
      // The product's approverRoleOf: FIN when the decider holds funding.approve as FIN.
      expect(x.approver_role_code, x.id).toBe("FIN");
    }
    expect(f.map((x) => x.amount).sort()).toEqual(["2400000.0000", "360000.0000", "900000.0000"].sort());
  });

  it("(3) selections, ranking, demand commitment, milestone approval and launch are by permission holders", async () => {
    for (const s of await rows<{ decided_by: string; action: string; on_behalf_of_user_id: string | null }>(
      sql`SELECT decided_by::text AS decided_by, action, on_behalf_of_user_id FROM portfolio_selection
           WHERE transformation_id = ${T}::uuid`,
    )) {
      expect([s.action, s.on_behalf_of_user_id]).toEqual(["selected", null]);
      await mustHold("portfolio.select", s.decided_by, "selection");
    }
    for (const r of await rows<{ proposed_by: string }>(
      sql`SELECT proposed_by::text AS proposed_by FROM ranking_snapshot WHERE transformation_id = ${T}::uuid`,
    ))
      await mustHold("prioritization.edit", r.proposed_by, "ranking snapshot");
    const committed = await rows<{ committed_by: string }>(
      sql`SELECT committed_by::text AS committed_by FROM resource_demand
           WHERE transformation_id = ${T}::uuid AND status = 'committed'`,
    );
    expect(committed.length).toBeGreaterThanOrEqual(3);
    for (const d of committed) await mustHold("capacity.commit", d.committed_by, "demand commit");
    const ms = await rows<{ approved_by: string }>(
      sql`SELECT approved_by::text AS approved_by FROM milestone
           WHERE transformation_id = ${T}::uuid AND approved_date IS NOT NULL`,
    );
    expect(ms.length).toBeGreaterThanOrEqual(6);
    for (const m of ms) await mustHold("roadmap.approve", m.approved_by, "milestone approval");
    const launched = await rows<{ code: string; launched_by: string }>(
      sql`SELECT code, launched_by::text AS launched_by FROM initiative
           WHERE transformation_id = ${T}::uuid AND status = 'launched' ORDER BY code`,
    );
    expect(launched.map((i) => i.code)).toEqual(["INI-01", "INI-02", "INI-03"]);
    for (const i of launched) await mustHold("initiative.launch", i.launched_by, `launch ${i.code}`);
  });

  it("(4) every new row has a creation audit event and one audit event per version step", async () => {
    const tables = [
      "business_case",
      "initiative_score_result",
      "ranking_snapshot",
      "ranking_entry",
      "portfolio_selection",
      "decision",
      "funding_decision",
      "resource_role",
      "capacity",
      "resource_demand",
      "milestone",
      "initiative",
    ];
    for (const table of tables) {
      const hasVersion =
        (
          await rows<{ n: number }>(
            sql`SELECT count(*)::int AS n FROM information_schema.columns
                 WHERE table_name = ${table} AND column_name = 'version'`,
          )
        )[0]!.n > 0;
      const recs = await rows<{ id: string; version: number | null }>(
        sql`SELECT id::text AS id, ${hasVersion ? sql`version` : sql`NULL::int`} AS version
              FROM ${sql.table(table)} WHERE transformation_id = ${T}::uuid`,
      );
      expect(recs.length, table).toBeGreaterThan(0);
      for (const r of recs) {
        const ev = await rows<{ prior_version: number | null; new_version: number | null; action: string }>(
          sql`SELECT prior_version, new_version, action FROM audit_event
               WHERE record_type = ${table} AND record_id = ${r.id}::uuid ORDER BY seq`,
        );
        expect(ev.length, `${table} ${r.id}: no audit event`).toBeGreaterThan(0);
        if (hasVersion && r.version !== null) {
          // One step per version above 1, contiguous (1->2, 2->3, ...).
          const steps = ev.filter((e) => e.prior_version !== null).map((e) => `${e.prior_version}->${e.new_version}`);
          const want = Array.from({ length: r.version - 1 }, (_, k) => `${k + 1}->${k + 2}`);
          expect(steps, `${table} ${r.id} version steps`).toEqual(want);
        }
      }
    }
  });

  it("(5) no gate exception; the code counters cover the seeded DEC and BC codes", async () => {
    const ex = await rows<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM gate_exception WHERE transformation_id = ${T}::uuid`,
    );
    expect(ex[0]!.n).toBe(0);
    const c = await rows<{ prefix: string; last_value: number }>(
      sql`SELECT prefix, last_value FROM record_code_counter WHERE transformation_id = ${T}::uuid
           AND prefix IN ('DEC', 'BC') ORDER BY prefix`,
    );
    expect(c).toEqual([
      { prefix: "BC", last_value: 4 },
      { prefix: "DEC", last_value: 4 },
    ]);
  });

  it("(6) the seed is refused for MTH_ENV=production and on an already-seeded (demo) database", async () => {
    await expect(
      seedDemo(ownerUrl, { mthEnv: "production", runKind: "seed", requestedVia: "cli", requestedBy: null }),
    ).rejects.toThrow(/production/);
    await expect(
      seedDemo(ownerUrl, { mthEnv: "demo", runKind: "seed", requestedVia: "cli", requestedBy: null }),
    ).rejects.toThrow(/refused/);
  });

  it("(7) no technical_admin role holds a business_approval or finance_validation permission", async () => {
    const bad = await rows<{ code: string; permission_code: string }>(
      sql`SELECT r.code, p.permission_code FROM role r
            JOIN role_permission p ON p.role_id = r.id
            JOIN permission pe ON pe.code = p.permission_code
           WHERE r.kind = 'technical_admin' AND pe.category IN ('business_approval', 'finance_validation')`,
    );
    expect(bad).toEqual([]);
    const admins = await rows<{ user_id: string }>(
      sql`SELECT DISTINCT a.user_id::text AS user_id FROM scoped_assignment a JOIN role r ON r.id = a.role_id
           WHERE r.kind = 'technical_admin' AND a.revoked_at IS NULL`,
    );
    expect(admins.length).toBeGreaterThan(0);
    for (const a of admins) {
      const approvals = await rows<{ permission_code: string }>(
        sql`SELECT DISTINCT p.permission_code FROM scoped_assignment s
              JOIN role_permission p ON p.role_id = s.role_id
              JOIN permission pe ON pe.code = p.permission_code
             WHERE s.user_id = ${a.user_id}::uuid AND s.revoked_at IS NULL
               AND pe.category IN ('business_approval', 'finance_validation')`,
      );
      expect(approvals, `technical admin ${a.user_id} holds an approval permission`).toEqual([]);
    }
  });
});
