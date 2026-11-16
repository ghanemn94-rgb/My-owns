// P7 contract exercises of BE-H (p7-work-split §I.1, §I.4; §2 rule 1 with p6-work-split §2 rule 16; T-DG7-BE-H):
// listRequirements, getRequirement and getReleaseAbout with their success and the declared refusals they reach, through
// the contract-validating client `mirrored` (each success body also checked against its zod mirror). The 401 sweep and
// the 429 sweep of contract.test.ts cover the three operations like every other read (G1, G8).
// The shared server reads the default snapshot path (dist/release/register-snapshot.json of the API package, ADR-0071
// §2.4), which `pnpm -r build` writes before the integration job (deploy/ci/ci.yml). When a local run has not built the
// package, this exercise runs the build's own generator into that path first (the same command as the `build` script),
// so the shared server serves the tree's register. The declared 503 (G4) is not provoked here, so the shared snapshot is
// never broken: integration/release/register.test.ts T-I6 answers it from the real server with a broken snapshot and
// validates the body against the contract's Problem.
// Read-only; nothing here approves anything (no G1-G6, Finance or IT approval) or touches DG0-DG7.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import type { z } from "zod";
import { releaseAboutView } from "../../../src/modules/release/about.ts";
import { requirementPageView, requirementView } from "../../../src/modules/release/routes.ts";
import { defaultSnapshotPath } from "../../../src/modules/release/snapshot.ts";
import { signIn, type P6ExerciseContext } from "../../support/harness.ts";

export const P7_MIRRORS_BE_H: Readonly<Record<string, z.ZodType>> = {
  listRequirements: requirementPageView,
  getRequirement: requirementView,
  getReleaseAbout: releaseAboutView,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const LIST = "/api/v1/admin/requirements";
const ABOUT = "/api/v1/admin/about";

/** The `build` script's generator step, run only when the package has not been built. */
function ensureBuiltSnapshot(): void {
  const out = defaultSnapshotPath();
  if (existsSync(out)) return;
  const api = new URL("../../../", import.meta.url);
  const r = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("scripts/register-snapshot.mjs", api)),
      "--csv",
      fileURLToPath(new URL("../../docs/delivery/requirements.csv", api)),
      "--deps",
      fileURLToPath(new URL("../../docs/handover/external-dependencies.json", api)),
      "--out",
      out,
    ],
    { encoding: "utf8" },
  );
  expect(r.status, r.stderr).toBe(0);
}

export async function exerciseP7BeHOperations(ctx: P6ExerciseContext): Promise<void> {
  const { api, world: w, mirrored: m } = ctx;
  ensureBuiltSnapshot();
  const tech = await signIn(api.app, w.admin.subject); // ADM_TECH + ADM_ACCESS at org A: operations.read
  const auditor = await signIn(api.app, w.auditor.subject); // AUD: operations.read
  const lead = await signIn(api.app, w.leadA1.subject); // TL: no operations.read
  const status = async (p: Promise<{ status: number; body: Body }>, expected: number, code?: string) => {
    const res = await p;
    expect(res.status, JSON.stringify(res.body).slice(0, 500)).toBe(expected);
    if (code) expect(res.body.code).toBe(code);
    return res;
  };

  // listRequirements: 200 (ADM_TECH, AUD; a filter and a second page), 400 (limit, enum, cursor), 401, 403.
  const page = await status(m("GET", `${LIST}?limit=5`, { session: tech }), 200);
  expect(page.body.items).toHaveLength(5);
  expect(page.body.nextCursor).not.toBeNull();
  await status(m("GET", `${LIST}?limit=5&cursor=${encodeURIComponent(page.body.nextCursor)}`, { session: tech }), 200);
  await status(m("GET", `${LIST}?status=IMPLEMENTED&area=S02`, { session: auditor }), 200);
  await status(m("GET", `${LIST}?limit=0`, { session: tech }), 400, "validation");
  await status(m("GET", `${LIST}?status=DONE`, { session: tech }), 400, "validation");
  await status(
    m("GET", `${LIST}?status=SPECIFIED&cursor=${encodeURIComponent(page.body.nextCursor)}`, { session: tech }),
    400,
    "validation",
  );
  await status(m("GET", LIST), 401, "unauthenticated");
  await status(m("GET", LIST, { session: lead }), 403, "forbidden");

  // getRequirement: 200, 400 (bad id), 404 (unknown id), 401, 403.
  const known = page.body.items[0].reqId as string;
  const one = await status(m("GET", `${LIST}/${known}`, { session: tech }), 200);
  expect(one.body.reqId).toBe(known);
  await status(m("GET", `${LIST}/REQ-S02-3`, { session: tech }), 400, "validation");
  await status(m("GET", `${LIST}/REQ-S02-999`, { session: tech }), 404, "not_found");
  await status(m("GET", `${LIST}/${known}`), 401, "unauthenticated");
  await status(m("GET", `${LIST}/${known}`, { session: lead }), 403, "forbidden");

  // getReleaseAbout: 200, 400 (undeclared query), 401, 403.
  const about = await status(m("GET", ABOUT, { session: auditor }), 200);
  expect(about.body.register.rowCount).toBe(
    about.body.statusCounts.PLANNED +
      about.body.statusCounts.SPECIFIED +
      about.body.statusCounts.IMPLEMENTED +
      about.body.statusCounts.BLOCKED,
  );
  await status(m("GET", `${ABOUT}?x=1`, { session: tech }), 400, "validation");
  await status(m("GET", ABOUT), 401, "unauthenticated");
  await status(m("GET", ABOUT, { session: lead }), 403, "forbidden");
}
