// domain-reviewer DG6 round 5 (T-DG6-REV-DOM-RG-R5): where do the D-239 history texts live? NOT part of the candidate:
// copied into a disposable clone at apps/api/test/integration/text-scan/ and run in the integration project.
// It migrates a scratch database 0001 -> latest (production-initialized) and reports, for (a) the five audit reasons
// D-239 leaves as history and (b) the 0130 `*.reword` events, how many rows exist and whether they carry an
// organization or a transformation. The global audit API serves only rows with an organization (audit/index.ts
// baseQuery: organization_id IS NOT NULL) and the transformation audit only rows of that transformation, so a row with
// neither is not served by either route. Read-only on its own scratch database.
import { describe, expect, inject, it } from "vitest";
import { migrate } from "@mth/db";
import pg from "pg";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";

describe("DOM-R5: scope of the D-239 audit history rows and the 0130 reword events", () => {
  it("reports organization/transformation of the rows", async () => {
    const adminUrl = inject("mthDb").adminUrl;
    const db = await createScratchDatabase(adminUrl, "mth_dom_r5_hist");
    const pool = new pg.Pool({ connectionString: roleUrl(adminUrl, db, "mth_owner"), max: 1 });
    try {
      await migrate(roleUrl(adminUrl, db, "mth_owner"));
      const r = await pool.query<{ kind: string; reason: string; n: string; with_org: string; with_tr: string }>(
        `SELECT CASE WHEN action LIKE '%.reword' THEN 'reword' ELSE 'history' END AS kind,
                CASE WHEN action LIKE '%.reword' THEN action ELSE reason END AS reason,
                count(*) AS n, count(organization_id) AS with_org, count(transformation_id) AS with_tr
           FROM audit_event
          WHERE reason ~ '(T-DG[0-7]|D-[0-9]{3}|ADR-[0-9]{4})' OR action LIKE '%.reword'
          GROUP BY 1, 2 ORDER BY 1, 2`,
      );
      for (const x of r.rows)
        console.log(`[DOM-R5 hist] ${x.kind} ${JSON.stringify(x.reason)}: rows ${x.n}, with organization ${x.with_org}, with transformation ${x.with_tr}`);
      const total = r.rows.reduce((s, x) => s + Number(x.n), 0);
      const scoped = r.rows.reduce((s, x) => s + Number(x.with_org) + Number(x.with_tr), 0);
      console.log(`[DOM-R5 hist] rows ${total}; rows with an organization or transformation ${scoped}`);
      expect(r.rows.filter((x) => x.kind === "history").length).toBe(5);
      expect(scoped).toBe(0);
    } finally {
      await pool.end();
      await dropScratchDatabase(adminUrl, db);
    }
  }, 300_000);
});
