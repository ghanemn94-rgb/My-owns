// domain-reviewer DG5 round-2 probe (demo stack): what the approved demo G4 actually rests on. Dumps, as the demo
// Transformation Lead, the initiatives, their milestones, the funding decisions, the resource demands, the capacity plan,
// the prioritization and the organization's portfolios, next to the live G4 readiness. SYNTHETIC data only; nothing
// here approves anything; product gates G1-G6 are unrelated to DG0-DG7. Read-only (GET requests only).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "@playwright/test";
import { apiSession, langOf } from "../apps/web/e2e/support/ui.ts";

const OUT = process.env["PROBE_OUT"]!;
const T = "01995000-0000-7000-8000-000000000001";
const ORG = "01995000-0000-7000-8000-000000000002";
const dump = (name: string, data: unknown) => {
  mkdirSync(join(OUT, "api-g4"), { recursive: true });
  writeFileSync(join(OUT, "api-g4", `${name}.json`), JSON.stringify(data, null, 1));
};

test("G4 basis on the demo database (en project only)", async ({ playwright }, info) => {
  test.skip(langOf(info) !== "en");
  const tl = await apiSession(playwright, "roaming.user.tl");
  const get = async (name: string, path: string) => {
    const res = await tl.req.get(path);
    const body = await res.json().catch(() => null);
    dump(name, { path, status: res.status(), body });
    return body as { items?: { id: string }[] } | null;
  };
  const inits = await get("initiatives", `/api/v1/initiatives?transformationId=${T}&limit=100`);
  for (const i of inits?.items ?? []) await get(`milestones-${i.id}`, `/api/v1/initiatives/${i.id}/milestones`);
  await get("funding-decisions", `/api/v1/funding-decisions?transformationId=${T}&limit=100`);
  await get("resource-demands", `/api/v1/resource-demands?transformationId=${T}&limit=100`);
  await get("capacity-plan", `/api/v1/transformations/${T}/capacity-plan`);
  await get("prioritization", `/api/v1/transformations/${T}/prioritization`);
  await get("portfolios", `/api/v1/organizations/${ORG}/portfolios`);
  await get("gate-G4-live", `/api/v1/transformations/${T}/gates/G4`);
});
