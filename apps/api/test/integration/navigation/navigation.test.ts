// GET /api/v1/me/navigation against a real PostgreSQL (ADR-0049 §9; REQ-S03-007; p5-work-split §I.4; T-DG5-BE-R2).
// Literal tests:
//  - REQ-S03-007: an ADM test user holding every role default sees 14 areas in en and ar; WL does not see
//    Administration; each area lists its M0100-M0113 contents;
// plus: the grants come from the database at each request (a revoked grant hides its items on the next request), the
// answer does not depend on the scope of a grant, hidden areas and items are omitted (never flagged), TO and AUD see
// Administration (Studio review; read-only access), 400 on an undeclared parameter and 401 without a session. Every
// user is SYNTHETIC; reading navigation approves nothing and names no engineering delivery gate.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ROLE_CODES } from "@mth/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { navigationMirror } from "../contract/p5-exercises-be-r2.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const N = "/api/v1/me/navigation";

/** The ADR-0049 §9 table: areas in order with their M0100-M0113 contents. */
const CONTENTS: readonly [string, readonly string[]][] = [
  ["my_work", ["assignedActions", "drafts", "reviews", "approvals", "missingUpdates", "upcomingDeadlines"]],
  ["executive_overview", ["outcomes", "value", "criticalInitiatives", "adoption", "blockers", "decisions"]],
  ["transformations", ["portfolio", "workspaces"]],
  ["playbook_procedures", ["source", "guidance", "procedures"]],
  ["strategy_kpis", ["outcomeTrees", "definitions", "targets", "actuals", "performanceReviews"]],
  ["target_operating_model", ["canvas", "gaps", "capabilities", "processes", "designDecisions"]],
  ["initiatives_roadmaps", ["cases", "prioritization", "waves", "resources", "milestones", "dependencies"]],
  ["governance", ["forums", "meetings", "decisionRights", "raci", "approvals", "stageGates"]],
  ["risks_actions", ["raid", "correctiveActions", "escalations"]],
  ["benefits_finance", ["formulas", "realization", "validation", "forecasts"]],
  ["change_adoption", ["stakeholders", "interventions", "adoptionIndicators"]],
  ["evidence_reports", ["deliverables", "attachments", "snapshots", "packs"]],
  ["bau_improvement", ["handovers", "controls", "lessons", "improvementBacklog"]],
  [
    "administration",
    ["methodology", "forms", "workflows", "automation", "organization", "access", "branding", "environment"],
  ],
];

const catalogue = (lang: "en" | "ar") =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../../web/src/i18n/${lang}/nav.json`, import.meta.url)), "utf8"),
  ) as Record<string, unknown>;
const lookup = (cat: Record<string, unknown>, key: string): unknown =>
  key
    .replace(/^nav\./, "")
    .split(".")
    .reduce<unknown>(
      (o, k) => (o !== null && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
      cat,
    );

let api: TestApi;
let w: World;
let admUser: { id: string; subject: string };

const nav = async (subject: string) => {
  const session = await signIn(api.app, subject);
  const r = await call<Body>(api.app, "GET", N, { session });
  expect(r.status).toBe(200);
  expect(navigationMirror.safeParse(r.body).success).toBe(true);
  return r.body as { areas: { code: string; labelKey: string; webId: string; items: { code: string }[] }[] };
};

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  admUser = await createUser(api.db, w.orgA.id);
  for (const role of ROLE_CODES) {
    await grant(api.db, w.grantor.id, admUser.id, role, { type: "organization", id: w.orgA.id }, w.orgA.id);
  }
}, 120_000);
afterAll(() => api.close());

describe("REQ-S03-007: the 14 areas and their contents", () => {
  it("an ADM test user holding every role default sees the 14 areas, each with its M0100-M0113 contents", async () => {
    const body = await nav(admUser.subject);
    expect(body.areas.map((a) => [a.code, a.items.map((i) => i.code)])).toEqual(CONTENTS);
  });

  it("the 14 area labels render in en and ar (nav.json), and en differs from ar", async () => {
    const body = await nav(admUser.subject);
    const en = catalogue("en");
    const ar = catalogue("ar");
    for (const area of body.areas) {
      const e = lookup(en, area.labelKey);
      const a = lookup(ar, area.labelKey);
      expect([typeof e, typeof a], area.labelKey).toEqual(["string", "string"]);
      expect((a as string).trim().length > 0 && a !== e, area.labelKey).toBe(true);
      expect(/[؀-ۿ]/.test(a as string), area.labelKey).toBe(true);
    }
    expect(body.areas).toHaveLength(14);
  });

  it("a Workstream Lead does not see Administration (and its items are not sent with a flag)", async () => {
    const wl = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, wl.id, "WL", { type: "business_unit", id: w.a1 }, w.orgA.id);
    const body = await nav(wl.subject);
    expect(body.areas.map((a) => a.code)).not.toContain("administration");
    const raw = JSON.stringify(body);
    for (const hidden of ["/admin", "branding", "environment", "visible", "hidden"]) expect(raw).not.toContain(hidden);
  });

  it("TO sees Administration for the Studio review page; AUD sees it read-only (access only)", async () => {
    const office = await nav(w.office.subject); // TO @ organization A
    expect(office.areas.find((a) => a.code === "administration")?.items.map((i) => i.code)).toEqual(["methodology"]);
    const auditor = await nav(w.auditor.subject); // AUD @ organization A
    expect(auditor.areas.find((a) => a.code === "administration")?.items.map((i) => i.code)).toEqual(["access"]);
  });

  it("a user without any grant sees only the session items (My Work; the playbook's source and guidance)", async () => {
    const body = await nav(w.nobody.subject);
    expect(body.areas.map((a) => [a.code, a.items.map((i) => i.code)])).toEqual([
      CONTENTS[0],
      ["playbook_procedures", ["source", "guidance"]],
    ]);
  });
});

describe("visibility from the database's grants, the same for every scope", () => {
  it("the same role at two different business units gives the same answer (no scope parameter)", async () => {
    const one = await createUser(api.db, w.orgA.id);
    const two = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, one.id, "WL", { type: "business_unit", id: w.a1 }, w.orgA.id);
    await grant(api.db, w.grantor.id, two.id, "WL", { type: "business_unit", id: w.a2 }, w.orgA.id);
    expect(await nav(one.subject)).toEqual(await nav(two.subject));
  });

  it("a revoked grant hides its items on the next request", async () => {
    const tech = await createUser(api.db, w.orgA.id);
    const assignment = await grant(
      api.db,
      w.grantor.id,
      tech.id,
      "ADM_TECH",
      { type: "organization", id: w.orgA.id },
      w.orgA.id,
    );
    const session = await signIn(api.app, tech.subject);
    const before = await call<Body>(api.app, "GET", N, { session });
    expect(before.body.areas.map((a: Body) => a.code)).toContain("administration");
    await api.owner.query(
      `update scoped_assignment set revoked_at = now(), revoked_by = $1, revoke_reason = 'synthetic navigation test' where id = $2`,
      [w.grantor.id, assignment],
    );
    const after = await call<Body>(api.app, "GET", N, { session });
    expect(after.status).toBe(200);
    expect(after.body.areas.map((a: Body) => a.code)).toEqual(["my_work", "playbook_procedures"]);
  });
});

describe("refusals", () => {
  it("400 on an undeclared parameter; 401 without a session", async () => {
    const session = await signIn(api.app, w.leadA1.subject);
    const bad = await call<Body>(api.app, "GET", `${N}?transformationId=${w.a1}`, { session });
    expect([bad.status, bad.body.code]).toEqual([400, "validation"]);
    expect((await call(api.app, "GET", N)).status).toBe(401);
  });
});
