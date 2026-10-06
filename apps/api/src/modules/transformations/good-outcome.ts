// The good outcome test (B0051, REQ-PB-036): "Specific, measurable, strategically relevant, owned by a business leader,
// and achievable through a defined causal chain - not just 'launch', 'implement' or 'deliver'."
//
// A COMPUTED read field of every Outcome response (never stored, never writable). It is evaluated server-side for each
// outcome against the good_outcome_criterion catalogue of the transformation's pinned methodology version (seeded in
// migration 0011, 5 criteria). Mapping of each catalogue criterion to the recorded inputs that evidence it:
//
//   code                      evaluation         pass                              fail                              unknown
//   specific                  user_attested      specificConfirmed = true and the  statement leads with an activity  specificConfirmed not recorded
//                                                statement is not an activity      verb (launch/implement/deliver),
//                                                                                  or specificConfirmed = false
//   measurable                system_kpi_linked  >= 1 active Outcome & KPI Tree    no active outcome_kpi row         -
//                                                (outcome_kpi) row
//   strategically_relevant    user_attested      strategicallyRelevantConfirmed    strategicallyRelevantConfirmed    not recorded
//                                                = true                            = false
//   owned_by_business_leader  system_owner_set   owner set and an active user      no owner, or owner not active     -
//   causal_chain              user_attested      causalChain recorded              -                                 causalChain not recorded
//
// Fail-closed rules: a criterion code without an evaluator is `unknown` (never a pass); `goodOutcomePass` is true only
// when the catalogue is non-empty and every criterion is `pass` (no `fail`, no `unknown`). The activity-wording check
// is the source's own example list ("launch", "implement", "deliver", with their inflections); the Arabic equivalents
// are a PROVISIONAL rendering that needs business-owner review.
import type { DbOrTx } from "@mth/db";
import { hasText, type GoodOutcomeResult } from "@mth/shared/schemas";

/** One catalogue criterion, as seeded (code, ordinal, evaluation kind). */
export interface GoodOutcomeCriterionDef {
  readonly code: string;
  readonly ordinal: number;
  readonly evaluation: string;
}

/** The recorded inputs of one outcome the test reads. */
export interface GoodOutcomeInputs {
  readonly statement: string;
  readonly specificConfirmed: boolean | null;
  readonly strategicallyRelevantConfirmed: boolean | null;
  readonly causalChain: string | null;
  readonly ownerUserId: string | null;
  /** Whether the owner is an active user of the organization (null when there is no owner). */
  readonly ownerActive: boolean | null;
  /** Active Outcome & KPI Tree (outcome_kpi) rows of this outcome. */
  readonly linkedKpis: number;
}

export interface GoodOutcomeEvaluation {
  readonly goodOutcomeTest: GoodOutcomeResult[];
  readonly goodOutcomePass: boolean;
}

// English: the source's examples and their inflections; "implementation of" / "delivery of" read the same way.
// Arabic (PROVISIONAL): إطلاق / اطلاق (launch), تنفيذ (implement), تسليم (deliver).
const ACTIVITY_LEAD =
  /^(?:to\s+)?(launch(?:es|ed|ing)?|implement(?:s|ed|ing|ation\s+of)?|deliver(?:s|ed|ing|y\s+of)?)(?=$|[\s,.;:!?'"()-])/iu;
const ACTIVITY_LEAD_AR = /^(?:ال)?(إطلاق|اطلاق|تنفيذ|تسليم)(?=$|[\s،,.;:!؟?()-])/u;

/** The activity verb a statement leads with (B0051's "not just launch, implement or deliver"), or null. */
export function activityLead(statement: string): string | null {
  const s = statement.trim();
  const en = ACTIVITY_LEAD.exec(s);
  if (en) return en[1]!.toLowerCase();
  const ar = ACTIVITY_LEAD_AR.exec(s);
  return ar ? ar[1]! : null;
}

type Verdict = Pick<GoodOutcomeResult, "result" | "reason">;
const pass = (reason: string): Verdict => ({ result: "pass", reason });
const fail = (reason: string): Verdict => ({ result: "fail", reason });
const unknown = (reason: string): Verdict => ({ result: "unknown", reason });

const attested = (value: boolean | null, what: string, field: string): Verdict =>
  value === true
    ? pass(`Confirmed as ${what}.`)
    : value === false
      ? fail(`Not confirmed as ${what}.`)
      : unknown(`Not yet assessed: ${field} is not recorded.`);

const CRITERION_EVALUATORS: ReadonlyMap<string, (i: GoodOutcomeInputs) => Verdict> = new Map([
  [
    "specific",
    (i: GoodOutcomeInputs): Verdict => {
      const verb = activityLead(i.statement);
      if (verb !== null)
        return fail(
          `The statement is not specific: it describes an activity ("${verb}"), not the result it should produce (B0051: not just "launch", "implement" or "deliver").`,
        );
      return attested(i.specificConfirmed, "specific", "specificConfirmed");
    },
  ],
  [
    "measurable",
    (i: GoodOutcomeInputs): Verdict =>
      i.linkedKpis > 0
        ? pass(`${i.linkedKpis} KPI(s) linked in the Outcome & KPI Tree.`)
        : fail("No KPI linked: the outcome has no active Outcome & KPI Tree row."),
  ],
  [
    "strategically_relevant",
    (i: GoodOutcomeInputs): Verdict =>
      attested(i.strategicallyRelevantConfirmed, "strategically relevant", "strategicallyRelevantConfirmed"),
  ],
  [
    "owned_by_business_leader",
    (i: GoodOutcomeInputs): Verdict =>
      i.ownerUserId === null
        ? fail("No owner set: the outcome is not owned by a business leader.")
        : i.ownerActive === true
          ? pass("An owner is set.")
          : fail("The owner is not an active user of the organization."),
  ],
  [
    "causal_chain",
    (i: GoodOutcomeInputs): Verdict =>
      hasText(i.causalChain)
        ? pass("A causal chain is recorded.")
        : unknown("Not yet assessed: no causal chain is recorded."),
  ],
]);

/** Evaluates the good outcome test of one outcome against the catalogue (pure). */
export function evaluateGoodOutcome(
  criteria: readonly GoodOutcomeCriterionDef[],
  inputs: GoodOutcomeInputs,
): GoodOutcomeEvaluation {
  const goodOutcomeTest = [...criteria]
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((c): GoodOutcomeResult => {
      const evaluator = CRITERION_EVALUATORS.get(c.code);
      const verdict = evaluator
        ? evaluator(inputs)
        : unknown("This criterion cannot be evaluated in this release (no evaluator for its code).");
      return { criterionCode: c.code, ordinal: c.ordinal, result: verdict.result, reason: verdict.reason };
    });
  return {
    goodOutcomeTest,
    goodOutcomePass: goodOutcomeTest.length > 0 && goodOutcomeTest.every((r) => r.result === "pass"),
  };
}

/** The outcome columns the test reads. */
export interface GoodOutcomeSubject {
  readonly id: string;
  readonly transformation_id: string;
  readonly organization_id: string;
  readonly statement: string;
  readonly specific_confirmed: boolean | null;
  readonly strategically_relevant_confirmed: boolean | null;
  readonly causal_chain: string | null;
  readonly owner_user_id: string | null;
}

/** The catalogue of the transformation's pinned methodology version (empty when none is pinned: fail closed). */
async function criteriaOf(db: DbOrTx, transformationId: string): Promise<GoodOutcomeCriterionDef[]> {
  return db
    .selectFrom("good_outcome_criterion as c")
    .innerJoin("transformation_config_pin as p", "p.methodology_version_id", "c.methodology_version_id")
    .select(["c.code", "c.ordinal", "c.evaluation"])
    .where("p.transformation_id", "=", transformationId)
    .where("p.kind", "=", "methodology")
    .orderBy("c.ordinal")
    .execute();
}

/** Evaluates the test for outcome rows (any number, possibly of several transformations), keyed by outcome id. */
export async function loadGoodOutcomeEvaluations(
  db: DbOrTx,
  rows: readonly GoodOutcomeSubject[],
): Promise<Map<string, GoodOutcomeEvaluation>> {
  const out = new Map<string, GoodOutcomeEvaluation>();
  if (rows.length === 0) return out;
  const ids = rows.map((r) => r.id);
  const ownerIds = [...new Set(rows.map((r) => r.owner_user_id).filter((u): u is string => u !== null))];
  const [kpiCounts, owners] = await Promise.all([
    db
      .selectFrom("outcome_kpi")
      .select(["outcome_id", (eb) => eb.fn.countAll<string>().as("n")])
      .where("outcome_id", "in", ids)
      .where("status", "=", "active")
      .groupBy("outcome_id")
      .execute(),
    ownerIds.length === 0
      ? Promise.resolve([] as { id: string; organization_id: string; status: string }[])
      : db.selectFrom("app_user").select(["id", "organization_id", "status"]).where("id", "in", ownerIds).execute(),
  ]);
  const kpis = new Map(kpiCounts.map((k) => [k.outcome_id, Number(k.n)]));
  const ownerOf = new Map(owners.map((u) => [u.id, u]));
  const catalogues = new Map<string, GoodOutcomeCriterionDef[]>();
  for (const t of new Set(rows.map((r) => r.transformation_id))) catalogues.set(t, await criteriaOf(db, t));
  for (const r of rows) {
    const owner = r.owner_user_id === null ? undefined : ownerOf.get(r.owner_user_id);
    out.set(
      r.id,
      evaluateGoodOutcome(catalogues.get(r.transformation_id) ?? [], {
        statement: r.statement,
        specificConfirmed: r.specific_confirmed,
        strategicallyRelevantConfirmed: r.strategically_relevant_confirmed,
        causalChain: r.causal_chain,
        ownerUserId: r.owner_user_id,
        ownerActive:
          r.owner_user_id === null
            ? null
            : owner !== undefined && owner.status === "active" && owner.organization_id === r.organization_id,
        linkedKpis: kpis.get(r.id) ?? 0,
      }),
    );
  }
  return out;
}

/** Good-outcome facts of every non-archived outcome of a transformation (for G2 readiness, REQ-PB-036). */
export async function loadGoodOutcomeFacts(
  db: DbOrTx,
  transformationId: string,
): Promise<
  Array<{ id: string; statement: string; isTopOutcome: boolean; goodOutcomePass: boolean; test: GoodOutcomeResult[] }>
> {
  const rows = await db
    .selectFrom("outcome")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .where("status", "<>", "archived")
    .orderBy("id")
    .execute();
  const evaluations = await loadGoodOutcomeEvaluations(db, rows);
  return rows.map((r) => {
    const e = evaluations.get(r.id)!;
    return {
      id: r.id,
      statement: r.statement,
      isTopOutcome: r.is_top_outcome,
      goodOutcomePass: e.goodOutcomePass,
      test: e.goodOutcomeTest,
    };
  });
}
