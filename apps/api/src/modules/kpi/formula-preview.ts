// Formula preview before publication (REQ-S08-005, M0168 "Preview examples, units and edge cases before
// publication"; ADR-0047 §4; p5-work-split §G.3, T-DG5-KBE-F):
//   POST /formula-previews    the engine's verdict, the result unit, evaluated examples and the zero / missing / negative
//                             edge cases of {exampleCode} (a seeded B0087 example, benefit_formula_example, 0023) or
//                             {expression, variables} (the DG3 FormulaCheckRequest shape). Session and CSRF only;
//                             writes NOTHING (the checkBenefitFormula precedent).
//
// - The formula engine is reused unchanged (shared rule 9; p5-plan §3 row 20): this file only calls validateFormula and
//   evaluateFormula from `@mth/shared/calc`; nothing here parses, type-checks or computes a value itself.
// - An expression the engine refuses is 422 with the engine's first error code and text (ADR-0024 §6), unchanged; an
//   example input naming no variable of the formula is 422 formula.undefined_variable (the calculations precedent).
// - A result the engine leaves Unknown (missing input, division by zero, out of range) is `not_computable` with
//   `result: null` and its `reasonCode`: never 0. The UI labels it "Not computable" (formulaPreview.notComputable).
// - Edge cases, per variable the formula references (in order of first appearance), from the base values (the seeded
//   example values, or the declared variable values): `zero` sets it to "0"; `missing` to null; `negative`, only for
//   kinds that admit a sign (currency, number, fraction_delta, percent_change), negates the base value, or uses "-1"
//   when the base value is missing or zero. A fraction (a share), a count or a quantity is never negative.
import { evaluateFormula, validateFormula, type FormulaKind, type FormulaVariable } from "@mth/shared/calc";
import {
  canonicalDecimal,
  formulaPreviewRequest,
  type FormulaPreviewEdgeCase,
  type FormulaPreviewOutcome,
  type FormulaPreviewResult,
} from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
import { principalOf } from "../access/index.ts";
import { parseBody, problems, type ModuleDeps } from "../platform/index.ts";
import { formulaRule, JSON_BODY, loadExamples } from "./benefit-formulas.ts";

export const FORMULA_PREVIEWS = "/api/v1/formula-previews";
/** The label of the one example a seeded B0087 example contributes (ADR-0047 §4). */
export const SOURCE_EXAMPLE_LABEL = "Source example";
/** Kinds whose values admit a sign (the `negative` edge case). */
export const SIGNED_KINDS: readonly FormulaKind[] = ["currency", "number", "fraction_delta", "percent_change"];

type Inputs = Readonly<Record<string, string | null>>;

/** One evaluation as a preview outcome: ok with its result, or not_computable with the engine's reason (never 0). */
function evaluate(expression: string, variables: readonly FormulaVariable[], inputs: Inputs) {
  const e = evaluateFormula(expression, variables, inputs);
  const result = e.result === null ? null : canonicalDecimal(e.result);
  return {
    used: Object.fromEntries(
      Object.entries(e.inputs).map(([k, v]) => [k, v === null ? null : canonicalDecimal(v)] as const),
    ),
    status: result === null ? ("not_computable" as const) : ("ok" as const),
    result,
    reasonCode: result === null ? (e.errorCode ?? "formula.missing_input") : null,
  };
}

/** "-x" of a decimal string without a JavaScript number; "-1" for a missing or zero base value. */
function negated(value: string | null | undefined): string {
  if (value === null || value === undefined) return "-1";
  const c = canonicalDecimal(value);
  if (c === "0") return "-1";
  return c.startsWith("-") ? c.slice(1) : `-${c}`;
}

/** The preview of a validated request body (exported for the unit tests). */
export function previewOf(
  expression: string,
  variables: readonly FormulaVariable[],
  options: { examples: readonly { label: string; inputs: Inputs }[]; edgeCases: boolean; sourceExample: boolean },
): FormulaPreviewResult {
  const v = validateFormula(expression, variables);
  if (!v.ok) {
    const first = v.errors[0]!;
    throw formulaRule(
      first.code,
      first.message,
      first.code === "formula.invalid_variable" ? "/variables" : "/expression",
    );
  }
  options.examples.forEach((ex, i) => {
    for (const name of Object.keys(ex.inputs))
      if (!variables.some((d) => d.name === name))
        throw formulaRule("formula.undefined_variable", `Undefined variable: ${name}`, `/examples/${i}/inputs/${name}`);
  });
  const base = evaluateFormula(expression, variables);
  const declared = new Map(variables.map((d) => [d.name, d]));
  const examples: FormulaPreviewOutcome[] = [];
  if (options.sourceExample) {
    const e = evaluate(expression, variables, {});
    examples.push({
      label: SOURCE_EXAMPLE_LABEL,
      inputs: e.used,
      status: e.status,
      result: e.result,
      reasonCode: e.reasonCode,
    });
  }
  for (const ex of options.examples) {
    const e = evaluate(expression, variables, ex.inputs);
    examples.push({ label: ex.label, inputs: e.used, status: e.status, result: e.result, reasonCode: e.reasonCode });
  }
  const edgeCases: FormulaPreviewEdgeCase[] = [];
  if (options.edgeCases) {
    for (const name of v.variables) {
      const d = declared.get(name)!;
      const cases: [FormulaPreviewEdgeCase["case"], string | null][] = [
        ["zero", "0"],
        ["missing", null],
      ];
      if (SIGNED_KINDS.includes(d.kind)) cases.push(["negative", negated(d.value)]);
      for (const [kind, value] of cases) {
        const e = evaluate(expression, variables, Object.fromEntries([[name, value]]));
        edgeCases.push({ variable: name, case: kind, status: e.status, result: e.result, reasonCode: e.reasonCode });
      }
    }
  }
  const t = v.resultType;
  return {
    valid: true,
    // The evaluation warnings of the base values (a missing value, a division by zero), as checkBenefitFormula does.
    errors: base.errors.map((e) => ({ code: e.code, message: e.message, pointer: "/expression" })),
    unit: { kind: t.kind, currency: t.currency, period: t.period, unitLabel: t.unit },
    examples,
    edgeCases,
    engineVersion: v.engineVersion,
  };
}

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerFormulaPreviewRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.post(
    FORMULA_PREVIEWS,
    // Session and CSRF only (ADR-0047 §6): writes nothing, so every signed-in user may preview, AUD included.
    { config: { access: { permission: "authenticated" }, consumes: JSON_BODY } },
    async (request) => {
      principalOf(request);
      const body = parseBody(formulaPreviewRequest, request.body);
      const examples = (body.examples ?? []).map((e) => ({ label: e.label, inputs: e.inputs }));
      const edgeCases = body.edgeCases ?? true;
      if (body.exampleCode !== undefined) {
        const example = (await loadExamples(db)).find((e) => e.code === body.exampleCode);
        if (!example) throw problems.notFound();
        const variables: FormulaVariable[] = example.variables.map((x) => ({
          name: x.name,
          kind: x.kind,
          period: x.period,
          unit: x.unit,
          currency: x.currency,
          value: x.value,
          source: x.source,
          description: x.description,
        }));
        return previewOf(example.expression, variables, { examples, edgeCases, sourceExample: true });
      }
      const variables: FormulaVariable[] = (body.variables ?? []).map((x) => ({
        name: x.name,
        kind: x.kind,
        period: x.period,
        unit: x.unit ?? null,
        currency: x.currency ?? null,
        value: x.value ?? null,
        source: x.source ?? null,
        description: x.description ?? null,
      }));
      return previewOf(body.expression!, variables, { examples, edgeCases, sourceExample: false });
    },
  );
  return [`POST ${FORMULA_PREVIEWS}`];
}
