// qa-verifier acceptance support for P4 (DG4: A04, A05, A10). Setup only.
//
// The acceptance suites build their synthetic worlds with the backend's own integration fixtures (users and grants,
// reporting periods, KPI definitions and versions, benefits moved to Measure). Records whose routes belong to other
// modules (initiatives, outcomes) are written directly with their audit event, as those fixtures do. Every assertion
// in tests/qa/integration/a04|a05|a10-*.test.ts comes from the acceptance texts (master prompt §20 A04/A05/A10), the
// requirement rows in docs/delivery/requirements.csv and docs/api/openapi.yaml. No assertion reuses a backend test's
// expectation, and every request made through `call` is validated against the contract.
// All data is SYNTHETIC. A Finance or Sponsor approval in a fixture is a synthetic in-product approval of test data;
// nothing here grants a real business, Finance or IT approval or touches the engineering gates DG0-DG7.
import { expect } from "vitest";
import type { World } from "../../../apps/api/test/support/harness.ts";
import type { BenefitWorld } from "../../../apps/api/test/integration/benefits/fixtures.ts";
import type { KpiWorld } from "../../../apps/api/test/integration/kpi/fixtures.ts";
import { call, type Res, type Session, type TestApi } from "./api.ts";

export { seedWorld, type World } from "../../../apps/api/test/support/harness.ts";
export { seedKpiWorld, type KpiWorld } from "../../../apps/api/test/integration/kpi/fixtures.ts";
export {
  actualAction,
  approvedTrajectory,
  DIRECT_FLOW,
  mapPartyTo,
  monthlyPeriod,
  ownedKpi,
  REVIEW_FLOW,
  runRecalculation,
  submitActual,
} from "../../../apps/api/test/integration/kpi-p4/kbe-c-fixtures.ts";
export {
  ensureDefaultCalendar,
  insertInitiative as insertExecInitiative,
  newDependency,
  seedExecutionWorld,
  setDuration,
} from "../../../apps/api/test/integration/portfolio/execution-fixtures.ts";
export { createKpi } from "../../../apps/api/test/integration/kpi-p4/kbe-b-fixtures.ts";
export {
  benefitAt,
  cxBody,
  financialBody,
  insertInitiative,
  seedBenefitWorld,
  type BenefitWorld,
} from "../../../apps/api/test/integration/benefits/fixtures.ts";
export {
  decideBaseline,
  envelopeOf,
  evidenceItem,
  measuredBenefit,
  revenueFormula,
} from "../../../apps/api/test/integration/benefits/value-fixtures.ts";
export {
  activeOutcome,
  dashboardWorld,
  launchedInitiative,
  openPeriod,
  outcomeKpi,
  riyadhToday,
  workstreamOf,
} from "../../../apps/api/test/integration/contract/p4-exercises-kbe-g.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Body = any;

export const ifMatch = (version: number): Record<string, string> => ({ "if-match": `"${version}"` });

/**
 * Canonical decimal string (no trailing fractional zeros, no "-0"), so "100000.0000" and "100000" compare equal as
 * decimal strings. Pure string manipulation: never a float.
 */
export function canon(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m) throw new Error(`not a decimal string: ${value}`);
  const int = m[2]!.replace(/^0+(?=\d)/, "");
  const frac = (m[3] ?? "").replace(/0+$/, "");
  const body = frac ? `${int}.${frac}` : int;
  return body === "0" ? "0" : `${m[1]}${body}`;
}

/** The six Finance validation items, all accepted (REQ-S08-015). */
export const SIX_ACCEPTED = Object.freeze({
  baseline: { decision: "accepted" },
  attribution: { decision: "accepted" },
  calculation: { decision: "accepted" },
  evidence: { decision: "accepted" },
  measurementPeriod: { decision: "accepted" },
  assumptions: { decision: "accepted" },
});

/** Problem-details assertion: status and machine code. */
export function expectCode(res: Res<Body>, status: number, code: string): void {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  expect(String(res.headers["content-type"])).toContain("application/problem+json");
  expect(res.body.code, JSON.stringify(res.body)).toBe(code);
}

/** GET as `session`, expecting 200. */
export async function get200(api: TestApi, session: Session, url: string): Promise<Body> {
  const r = await call<Body>(api.app, "GET", url, { session });
  expect(r.status, `${url}: ${JSON.stringify(r.body)}`).toBe(200);
  return r.body;
}

/** Polls `probe` until it returns a truthy value (or throws after `ms`). */
export async function waitFor<T>(probe: () => Promise<T | null | undefined | false>, what: string, ms = 30_000) {
  const until = Date.now() + ms;
  for (;;) {
    const v = await probe();
    if (v) return v;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

/**
 * A benefit-world view of a KPI world (same transformation; its users hold TL, BO, FIN, KDS there), so a benefit can be
 * linked to one of the KPI world's KPIs (measurementKpiDefinitionId).
 */
export function asBenefitWorld(k: KpiWorld, w: World, kpiDefinitionId: string): BenefitWorld {
  return {
    transformationId: k.transformationId,
    organizationId: w.orgA.id,
    base: k.base,
    users: {
      tl: k.users.tl,
      bo: k.users.bo,
      bo2: k.users.bo,
      fin: k.users.fin,
      auditor: k.users.auditor,
      admin: w.admin,
      outsider: k.users.outsider,
    },
    s: {
      tl: k.s.tl,
      bo: k.s.bo,
      bo2: k.s.bo,
      fin: k.s.fin,
      auditor: k.s.auditor,
      admin: k.s.nobody,
      outsider: k.s.outsider,
    },
    kpiDefinitionId,
    benefitFormulaId: "",
  };
}
