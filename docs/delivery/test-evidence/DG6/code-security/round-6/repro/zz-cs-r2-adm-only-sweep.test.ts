// code-security-reviewer DG6 round 2 sweep: an ADM-only caller (ADM_TECH + ADM_ACCESS at the organization, nothing else)
// sees nothing transformation-scoped. NOT part of the candidate; copied into a disposable clone's tests/qa/integration by
// checks.sh and removed afterwards. Demo data is SYNTHETIC.
//
// Every GET operation of docs/api/openapi.yaml whose only path parameter is {transformationId} is called for the
// demo-seeded transformation (rich P1-P6 data) by an ADM-only user. Expected: 403 or 404, or a 200 that discloses no
// transformation record (an empty list). A control TO at the organization must get 200 with content on most of them,
// so the sweep can see a leak. The list of operations and every answer is logged.
import { operations } from "../../../apps/api/test/support/contract.ts";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { migrate, seedDemo } from "../../../packages/db/src/index.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../packages/db/test/helpers.ts";
import { DEMO_ANCHORS } from "../support/a02.ts";
import { call, createUser, grant, signIn, startApi, type Loose, type Session, type TestApi } from "../support/api.ts";

const T = DEMO_ANCHORS.transformationId;
const ORG = DEMO_ANCHORS.organizationId;

let scratch = "";
let api: TestApi;
let adm: Session;
let to: Session;

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_cs_r2_adm");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  const grantor = await createUser(api.db, ORG);
  const a = await createUser(api.db, ORG);
  await grant(api.db, grantor.id, a.id, "ADM_TECH", { type: "organization", id: ORG } as never, ORG);
  await grant(api.db, grantor.id, a.id, "ADM_ACCESS", { type: "organization", id: ORG } as never, ORG);
  adm = await signIn(api.app, a.subject);
  const o = await createUser(api.db, ORG);
  await grant(api.db, grantor.id, o.id, "TO", { type: "organization", id: ORG } as never, ORG);
  to = await signIn(api.app, o.subject);
}, 300_000);

afterAll(async () => {
  await api?.close();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

function discloses(body: Loose): boolean {
  if (body === null || body === undefined) return false;
  if (typeof body === "string") return body.trim().length > 0;
  if (Array.isArray(body)) return body.length > 0;
  if (Array.isArray(body.items)) return body.items.length > 0;
  return Object.keys(body).length > 0;
}

describe("cs-r2: ADM-only sweep over transformation-scoped GET operations", () => {
  it("an ADM-only caller gets 403/404 or nothing on every one", async () => {
    const ops: { id: string; path: string }[] = [];
    for (const o of operations) {
      const params = [...o.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      if (o.method !== "GET" || params.length !== 1 || params[0] !== "transformationId") continue;
      ops.push({ id: o.operationId, path: o.path.replace("{transformationId}", T) });
    }
    console.log("transformation-scoped GET operations with only {transformationId}:", ops.length);
    const leaks: string[] = [];
    const tally: Record<string, number> = {};
    let controlContent = 0;
    for (const op of ops) {
      const r = await call<Loose>(api.app, "GET", op.path, { session: adm, contract: false });
      const c = await call<Loose>(api.app, "GET", op.path, { session: to, contract: false });
      tally[String(r.status)] = (tally[String(r.status)] ?? 0) + 1;
      if (c.status === 200 && discloses(c.body)) controlContent += 1;
      if (r.status === 200 && discloses(r.body)) {
        leaks.push(`${op.id} ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
      }
      console.log("ADM-only", op.id, r.status, "| control TO", c.status);
    }
    console.log("ADM-only statuses", JSON.stringify(tally), "| control TO 200 with content on", controlContent, "of", ops.length);
    console.log("ADM-only 200 with content:", leaks.length, JSON.stringify(leaks, null, 1));
    expect(ops.length).toBeGreaterThan(20);
    expect(controlContent).toBeGreaterThan(10);
    expect(leaks).toEqual([]);
  }, 600_000);
});
