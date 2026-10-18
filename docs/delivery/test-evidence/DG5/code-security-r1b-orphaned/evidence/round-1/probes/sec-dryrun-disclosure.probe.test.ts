// code-security-reviewer DG5 round-1 probe (T-DG5-REV-SEC-R1B). NOT part of the candidate: copied into the disposable
// clone at apps/api/test/integration/automation/ and run there against a disposable PostgreSQL.
// Question: an ADM_METHOD-only caller "sees nothing transformation-scoped" (ADR-0006). Does the automation dry run
// (automation.configure) disclose, for a transformation that caller cannot read, (a) whether it exists and (b) which
// users hold a business role on it (planned action target.recipientUserIds)? And is that persisted for every
// automation.read holder (ADM_TECH) to read back?
// Synthetic data only; a dry run approves nothing in the business; nothing touches DG0-DG7.
import { readFileSync } from "node:fs";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

let api: TestApi;
let w: World;
let author: Session;
let authorId: string;
let techAdmin: Session;
let txA: string;
let txB: string;
let sponsorId: string;
const R = "/api/v1/admin/automation-rules";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  const u = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, u.id, "ADM_METHOD", { type: "organization", id: w.orgA.id }, w.orgA.id);
  authorId = u.id;
  author = await signIn(api.app, u.subject);
  techAdmin = await signIn(api.app, w.admin.subject); // ADM_ACCESS + ADM_TECH @ A
  txA = await createTransformationRow(api.db, w.orgA.id, w.a1, w.grantor.id);
  txB = await createTransformationRow(api.db, w.orgB.id, w.b1, w.grantor.id);
  const sp = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, sp.id, "SP", { type: "transformation", id: txA }, w.orgA.id);
  sponsorId = sp.id;
}, 60_000);
afterAll(() => api.close());

const spec = parseYaml(readFileSync(new URL("../../../../../docs/api/openapi.yaml", import.meta.url), "utf8")) as Body;
const [example] = spec.components.schemas.AutomationDryRunRequest.examples as Body[];

describe("SEC probe: dry-run disclosure to an ADM_METHOD-only caller", () => {
  it("discloses existence and role holders of a transformation the caller cannot read", async () => {
    const read = await call<Body>(api.app, "GET", `/api/v1/transformations/${txA}`, { session: author });
    console.log("ADM_METHOD GET transformation txA ->", read.status);
    const rule = await call<Body>(api.app, "POST", R, {
      session: author,
      body: {
        code: `test.${uniq("sec").toLowerCase()}`,
        nameEn: "Synthetic probe rule",
        nameAr: "قاعدة فحص تجريبية",
        scopeLevel: "organization",
        organizationId: w.orgA.id,
        ownerUserId: authorId,
        content: {
          triggerCodes: ["gate.submitted"],
          conditions: [],
          actions: [{ type: "notify", parameters: { recipientRole: "SP", messageKey: "automation.message.update_due" } }],
          runAs: "service",
        },
      },
    });
    expect(rule.status, JSON.stringify(rule.body)).toBe(201);
    const url = `${R}/${rule.body.id as string}/versions/1/dry-runs`;
    const run = async (t: string) => {
      const r = await call<Body>(api.app, "POST", url, {
        session: author,
        body: { ...example, payload: { ...example.payload, transformationId: t } },
      });
      return r;
    };
    const own = await run(txA);
    const other = await run(txB);
    const missing = await run(uuidv7());
    for (const [n, r] of [["txA (orgA, unreadable)", own], ["txB (orgB)", other], ["random id", missing]] as const)
      console.log("dry run", n, "->", r.status, JSON.stringify(r.body?.plannedActions?.[0]?.target ?? r.body));
    // Persisted and readable by another automation.read holder (ADM_TECH, also no transformation scope).
    const list = await call<Body>(api.app, "GET", url, { session: techAdmin });
    const leaked = JSON.stringify(list.body).includes(sponsorId);
    console.log("ADM_TECH GET dry-runs ->", list.status, "contains sponsor id:", leaked);
    // What the reviewer expects for an ADM-only caller: no role holder of an unreadable transformation is disclosed.
    expect(read.status).toBe(404);
    expect(JSON.stringify(own.body).includes(sponsorId), "recipientUserIds of txA disclosed to ADM_METHOD").toBe(false);
  });
});
