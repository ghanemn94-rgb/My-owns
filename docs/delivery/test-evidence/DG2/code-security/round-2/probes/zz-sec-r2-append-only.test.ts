// code-security-reviewer DG2 round-2: disambiguates r1-probe SEC-5 `owner_delete_evidence_content` (COMMITTED in
// probe-run2 because evidence_content was EMPTY - the append-only trigger is FOR EACH ROW). Here a row exists first.
// Disposable clone + disposable PostgreSQL only. All data SYNTHETIC.
import { afterAll, beforeAll, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi } from "../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../support/p2-fixtures.ts";

let api: TestApi;
let p: P2World;
beforeAll(async () => {
  api = await startApi();
  p = await setupP2World(api, await seedWorld(api.db));
});
afterAll(() => api.close());

it("owner DELETE / UPDATE on a NON-EMPTY evidence_content is refused by the append-only trigger", async () => {
  const T = `/api/v1/transformations/${p.transformationId}`;
  const e = await call(api.app, "POST", `${T}/evidence`, { session: p.lead.session, body: { kind: "file", title: "f", ownerUserId: p.lead.id } });
  const up = await call(api.app, "POST", `${T}/evidence/${e.body.id}/content`, { session: p.lead.session, headers: { ...ifm(1), "content-type": "application/octet-stream", "x-file-name": "a.csv" }, body: Buffer.from("1\n") });
  const before = Number((await api.owner.query("SELECT count(*) AS n FROM evidence_content")).rows[0].n);
  const attempt = async (q: string) => {
    const c = await api.owner.connect();
    try {
      await c.query("BEGIN");
      const r = await c.query(q);
      await c.query("COMMIT");
      return `COMMITTED rows=${r.rowCount}`;
    } catch (err) {
      await c.query("ROLLBACK").catch(() => undefined);
      return `${(err as { code?: string }).code}:${(err as Error).message.slice(0, 60)}`;
    } finally {
      c.release();
    }
  };
  const del = await attempt("DELETE FROM evidence_content WHERE true");
  const upd = await attempt("UPDATE evidence_content SET sha256 = sha256");
  const after = Number((await api.owner.query("SELECT count(*) AS n FROM evidence_content")).rows[0].n);
  console.log(`PROBE append_only: ${JSON.stringify({ upload: up.status, before, del, upd, after })}`);
  expect(up.status).toBe(200);
  expect(before).toBeGreaterThan(0);
  expect(del.startsWith("42501")).toBe(true);
  expect(upd.startsWith("42501")).toBe(true);
  expect(after).toBe(before);
});
