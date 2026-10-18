// code-security-reviewer, DG5 round 3 (T-DG5-REV-SEC-R3): differential probe of the G4 evaluator repair T-DG5-BE-X1.
// Claim checked: the fail-closed rule for an EMPTY approved portfolio never opens a path in which a G4 criterion is
// complete with LESS evidence than before. For every random fact set, each criterion's missing items under the
// candidate (bbd6294) must be a superset of its missing items under round 2's source (d3528fc), and a criterion
// complete under the candidate must be complete under the old code. In addition: with a loaded, empty portfolio no
// criterion is complete; with a non-empty portfolio the two versions are identical (the repair adds items only when
// the portfolio is empty).
//
// How it runs (disposable clone only): `git show d3528fc:apps/api/src/modules/workflows/g4.ts > zz-g4-old.ts` next to
// g4.ts, this file copied to apps/api/src/modules/workflows/zz-sec-r3-g4-diff.test.ts, then
// `npx vitest run --configLoader runner --project unit-node apps/api/src/modules/workflows/zz-sec-r3-g4-diff.test.ts`.
// Both scratch files are deleted afterwards. All data is synthetic.
import { describe, expect, it } from "vitest";
import { G4_EVALUATORS as NEW } from "./g4.ts";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore scratch copy present only in the disposable clone
import { G4_EVALUATORS as OLD } from "./zz-g4-old.ts";

let seed = 0x5eed1234;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
};
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
const maybe = <T>(p: number, v: () => T): T | undefined => (rnd() < p ? v() : undefined);

const VALIDATION = ["validated", "stale", "rejected", "unvalidated"] as const;
const FORMULA = ["validated", "unvalidated", "rejected", "no_formula", "no_version"] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function facts(): any {
  const n = pick([0, 0, 0, 1, 2, 3]);
  const initiatives = Array.from({ length: n }, (_, k) => ({
    id: `i${k}`,
    code: `INI-0${k + 1}`,
    name: `Synthetic ${k}`,
    version: 1,
    status: pick(["selected", "funded", "launched"]),
    cardMissing: rnd() < 0.2 ? ["objective"] : [],
    activeGapLinks: pick([0, 1, 2]),
    kpiContributions: pick([0, 1]),
    waveId: rnd() < 0.2 ? null : "w1",
    plannedStart: rnd() < 0.1 ? null : "2026-07-01",
    plannedEnd: rnd() < 0.1 ? null : "2026-12-31",
    approvedMilestones: pick([0, 1, 2]),
    executiveOwnerUserId: rnd() < 0.15 ? null : "u1",
    workstreamLeadUserId: rnd() < 0.15 ? null : "u2",
    fundingState: pick(["funded", "funded", "not_funded", "rejected"]),
    fundingDecisionId: null,
    committedDemandIds: rnd() < 0.2 ? [] : ["d1"],
  }));
  const ws = rnd() < 0.1 ? null : { id: "ws1", versionNo: 1 };
  const kase = (id: string, level: "transformation" | "initiative", initiativeId: string | null) => ({
    id,
    code: id,
    title: id,
    level,
    initiativeId,
    version: 1,
    missingSections: rnd() < 0.15 ? ["benefits"] : [],
    baselineValidation: pick(VALIDATION),
    pointer: `/business-cases/${id}`,
  });
  const initiativeCases = initiatives.filter(() => rnd() < 0.85).map((i) => kase(`bc-${i.id}`, "initiative", i.id));
  const transformationCase = rnd() < 0.15 ? null : kase("bc-top", "transformation", null);
  const caseIds = [...(transformationCase ? [transformationCase.id] : []), ...initiativeCases.map((c) => c.id)];
  const benefitLines = caseIds.flatMap((c) =>
    rnd() < 0.7
      ? [
          {
            lineId: `l-${c}`,
            businessCaseId: c,
            initiativeId: null,
            title: "line",
            benefitClass: "revenue",
            valueBasis: "revenue_uplift",
            benefitFormulaId: "f",
            formulaCode: "BF-01",
            currentVersionNo: 1,
            currentVersionId: "v",
            formulaValidation: pick(FORMULA),
            pointer: `/lines/${c}`,
          },
        ]
      : [],
  );
  return {
    portfolio: {
      transformationId: "t",
      initiatives: maybe(0.95, () => initiatives),
      ranking: maybe(0.95, () =>
        rnd() < 0.15
          ? null
          : {
              snapshotId: "s",
              weightSetId: rnd() < 0.1 ? "other" : "ws1",
              entries: initiatives.map((i) => ({
                initiativeId: i.id,
                completeness: rnd() < 0.85 ? "complete" : "incomplete",
              })),
            },
      ),
      activeWeightSet: maybe(0.95, () => ws),
      scheduleConflicts: maybe(0.95, () => (rnd() < 0.1 ? [{ dependencyId: "x", code: "DEP-01" }] : [])),
      scheduleUnknowns: maybe(0.95, () => (rnd() < 0.1 ? [{ dependencyId: "y", code: "DEP-02" }] : [])),
      capacityConflicts: maybe(0.95, () =>
        rnd() < 0.1
          ? [{ resourceRoleId: "r", roleLabel: "R", periodMonth: "2026-07-01", committedFte: "2", availableFte: null }]
          : [],
      ),
    },
    kpi: {
      transformationId: "t",
      transformationCase: maybe(0.95, () => transformationCase),
      initiativeCases: maybe(0.95, () => initiativeCases),
      benefitLines: maybe(0.95, () => benefitLines),
    },
  };
}

const key = (w: { code: string; message: string; pointer?: string }) => `${w.code}|${w.message}|${w.pointer ?? ""}`;
const oldBy = new Map(OLD as ReadonlyArray<readonly [string, (f: unknown) => { missing: { code: string; message: string; pointer?: string }[] }]>);

describe("G4 evaluator repair: never less evidence (differential, synthetic)", () => {
  it("has the same eight criteria as before", () => {
    expect(NEW.map(([k]) => k)).toEqual([...oldBy.keys()]);
  });

  it("20,000 random fact sets: new missing ⊇ old missing for every criterion; equal when the portfolio is non-empty", () => {
    let emptyCases = 0;
    let differing = 0;
    for (let run = 0; run < 20_000; run++) {
      const f = facts();
      const loadedEmpty = Array.isArray(f.portfolio.initiatives) && f.portfolio.initiatives.length === 0;
      if (loadedEmpty) emptyCases += 1;
      for (const [k, evaluate] of NEW) {
        const now = evaluate(f).missing.map(key);
        const before = oldBy.get(k)!(f).missing.map(key);
        for (const b of before) expect(now, `${k} run ${run}: old item ${b} dropped`).toContain(b);
        if (now.length === 0) expect(before, `${k} run ${run}: complete now but not before`).toEqual([]);
        if (!loadedEmpty) expect(now, `${k} run ${run}: changed on a non-empty or unloaded portfolio`).toEqual(before);
        if (loadedEmpty) expect(now.length, `${k} run ${run}: complete over an empty portfolio`).toBeGreaterThan(0);
        if (now.length !== before.length) differing += 1;
      }
    }
    // The generator really exercised the empty-portfolio path and the repair really changed outcomes there.
    expect(emptyCases).toBeGreaterThan(1000);
    expect(differing).toBeGreaterThan(1000);
  }, 120_000);
});
