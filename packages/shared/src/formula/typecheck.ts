// Type checker of the T09 formula language (ADR-0024 §6 "Typed variables", "Type rules"). Owner: kpi-benefits-engineer.
//
// Runs before any evaluation. Each violation is reported once, with its ADR code, an English message naming the
// operands, and the offset of the expression where it occurs. A failed sub-expression does not cascade: its parent is
// skipped, but independent sub-expressions are still checked, so one call lists every independent problem.
//
// Rules (ADR-0024 §6):
//  + −   same kind, same currency, same period; fraction ± fraction_delta → fraction (and fraction_delta + fraction);
//        fraction − fraction → fraction_delta. Otherwise formula.kind_mismatch. Two quantities with different unit
//        labels are also formula.kind_mismatch (minutes + hours is never silently added).
//  ×     a dimensionless operand (fraction, fraction_delta, percent_change, number) takes the other operand's kind
//        (both dimensionless: number × X → X; the same kind stays; otherwise number); count × currency → currency;
//        count × count and count × quantity → quantity; currency × currency → formula.currency_product; anything else
//        formula.kind_mismatch.
//  ÷     X ÷ number → X; currency ÷ currency (same currency) → number; currency ÷ count → currency (per unit);
//        otherwise formula.kind_mismatch.
//  Periods: in every + − × ÷ the operands whose period is not "none" must share one period, else
//        formula.period_mismatch ('Period mismatch: arpu is per month but eligible_customers is per year; convert with
//        to_period(arpu, year)': the finer period is named first and converted to the coarser one). + and − (and
//        min/max) also refuse a period against no period. The result carries the shared period ("per period" basis
//        label); currency ÷ currency with the same period gives a number with no period.
//  to_period(x, p) needs x to have a period; the result has period p.
//  Currency: at most one currency per formula (formula.currency_mismatch). No FX in P3.
import { checkDecimal, MEASURE_COLUMN } from "../value.ts";
import { RESERVED_WORDS } from "./parse.ts";
import {
  DIMENSIONLESS_KINDS,
  FORMULA_LIMITS,
  isFormulaKind,
  isFormulaPeriod,
  type CallNode,
  type ExprNode,
  type FormulaAst,
  type FormulaKind,
  type FormulaPeriod,
  type FormulaProblem,
  type FormulaType,
  type FormulaVariable,
  type PeriodName,
} from "./types.ts";

/** Internal type: the public FormulaType plus the labels that messages name. */
interface Typed extends FormulaType {
  /** Label of the leaf that gave the expression its period (a variable name or a to_period(...) call). */
  readonly periodFrom: string | null;
  /** Label of the leaf that gave the expression its currency. */
  readonly currencyFrom: string | null;
}

const NAME_PATTERN = /^[a-z][a-z0-9_]{0,47}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const PERIOD_RANK: Readonly<Record<FormulaPeriod, number>> = { none: 0, month: 1, quarter: 2, year: 3 };

export type VariableCheck =
  | { readonly ok: true; readonly variables: ReadonlyMap<string, FormulaVariable> }
  | { readonly ok: false; readonly errors: readonly FormulaProblem[] };

function invalidVariable(index: number, name: string, detail: string, reason: string): FormulaProblem {
  return {
    code: "formula.invalid_variable",
    message: `Invalid variable ${name === "" ? `#${index + 1}` : name}: ${detail}`,
    params: { index: String(index), name, reason, detail },
  };
}

const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Checks the variable declarations (contract `FormulaVariable`): name pattern and not a function/period name, unique,
 * known kind and period, currency (ISO 4217, upper case) exactly for kind `currency`, value a numeric(24,6) decimal
 * string or null, at most 30 variables. Returns a Map, so a name such as "constructor" never reaches Object.prototype.
 */
export function checkVariables(variables: unknown): VariableCheck {
  if (!Array.isArray(variables)) {
    return { ok: false, errors: [invalidVariable(0, "", "variables must be a list", "not_a_list")] };
  }
  if (variables.length > FORMULA_LIMITS.maxVariables) {
    return {
      ok: false,
      errors: [
        {
          code: "formula.invalid_variable",
          message: `Invalid variables: at most ${FORMULA_LIMITS.maxVariables} variables (got ${variables.length})`,
          params: {
            reason: "too_many_variables",
            limit: String(FORMULA_LIMITS.maxVariables),
            count: String(variables.length),
          },
        },
      ],
    };
  }
  const errors: FormulaProblem[] = [];
  const map = new Map<string, FormulaVariable>();
  variables.forEach((raw: unknown, i) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      errors.push(invalidVariable(i, "", "a variable must be an object", "not_an_object"));
      return;
    }
    const v = raw as Record<string, unknown>;
    const name = own(v, "name") && typeof v["name"] === "string" ? v["name"] : "";
    if (!NAME_PATTERN.test(name)) {
      errors.push(invalidVariable(i, "", "a name matches ^[a-z][a-z0-9_]{0,47}$", "name"));
      return;
    }
    if (RESERVED_WORDS.includes(name)) {
      errors.push(invalidVariable(i, name, "function and period names cannot be variable names", "reserved"));
      return;
    }
    if (map.has(name)) {
      errors.push(invalidVariable(i, name, "the name is declared twice", "duplicate"));
      return;
    }
    const kind = own(v, "kind") ? v["kind"] : undefined;
    const period = own(v, "period") ? v["period"] : undefined;
    const currency = own(v, "currency") ? v["currency"] : undefined;
    const unit = own(v, "unit") ? v["unit"] : undefined;
    const value = own(v, "value") ? v["value"] : undefined;
    if (!isFormulaKind(kind)) return void errors.push(invalidVariable(i, name, "unknown kind", "kind"));
    if (!isFormulaPeriod(period)) return void errors.push(invalidVariable(i, name, "unknown period", "period"));
    if (kind === "currency") {
      if (typeof currency !== "string" || !CURRENCY_PATTERN.test(currency)) {
        return void errors.push(
          invalidVariable(i, name, "a currency variable needs an ISO 4217 currency code", "currency"),
        );
      }
    } else if (currency !== undefined && currency !== null) {
      return void errors.push(invalidVariable(i, name, `a ${kind} variable has no currency`, "currency"));
    }
    if (unit !== undefined && unit !== null && typeof unit !== "string") {
      return void errors.push(invalidVariable(i, name, "a unit is text", "unit"));
    }
    if (value !== undefined && value !== null && !checkDecimal(value, MEASURE_COLUMN).ok) {
      return void errors.push(invalidVariable(i, name, "a value is a decimal string that fits numeric(24,6)", "value"));
    }
    map.set(name, {
      name,
      kind,
      period,
      unit: typeof unit === "string" ? unit : null,
      currency: kind === "currency" ? (currency as string) : null,
      value: typeof value === "string" ? value : null,
    });
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, variables: map };
}

export type TypeCheckResult =
  | {
      readonly ok: true;
      readonly resultType: FormulaType;
      /** The source period of every to_period call (the evaluator's conversion factor needs it). */
      readonly conversions: ReadonlyMap<CallNode, PeriodName>;
    }
  | { readonly ok: false; readonly errors: readonly FormulaProblem[] };

/** Type-checks a parsed formula against checked variable declarations. */
export function typecheckFormula(ast: FormulaAst, variables: ReadonlyMap<string, FormulaVariable>): TypeCheckResult {
  const chars = Array.from(ast.source);
  const errors: FormulaProblem[] = [];
  const undefinedSeen = new Set<string>();
  const conversions = new Map<CallNode, PeriodName>();
  const label = (n: ExprNode): string => (n.type === "variable" ? n.name : chars.slice(n.start, n.end).join(""));
  const report = (p: FormulaProblem): null => {
    errors.push(p);
    return null;
  };

  const problem = (code: FormulaProblem["code"], node: ExprNode, message: string, params: Record<string, string>) =>
    report({ code, message, offset: node.start, params: { offset: String(node.start), ...params } });

  const kindMismatch = (node: ExprNode, op: string, l: ExprNode, lt: Typed, r: ExprNode, rt: Typed) =>
    problem(
      "formula.kind_mismatch",
      node,
      `Kind mismatch: ${label(l)} (${lt.kind}) ${op} ${label(r)} (${rt.kind}) is not allowed`,
      { op, left: label(l), leftKind: lt.kind, right: label(r), rightKind: rt.kind },
    );

  const currencyMismatch = (node: ExprNode, la: string, lc: string, ra: string, rc: string) =>
    problem(
      "formula.currency_mismatch",
      node,
      `Currency mismatch: ${la} is in ${lc} but ${ra} is in ${rc}; there is no FX conversion`,
      {
        left: la,
        leftCurrency: lc,
        right: ra,
        rightCurrency: rc,
      },
    );

  /** Period alignment of two operands. `strict`: a period against no period is also a mismatch (+, −, min, max). */
  const checkPeriods = (node: ExprNode, l: ExprNode, lt: Typed, r: ExprNode, rt: Typed, strict: boolean): boolean => {
    if (lt.period === rt.period) return true;
    if (lt.period !== "none" && rt.period !== "none") {
      // Name the finer period first and suggest converting it to the coarser one (month → year).
      const lName = lt.periodFrom ?? label(l);
      const rName = rt.periodFrom ?? label(r);
      const lFiner = PERIOD_RANK[lt.period] < PERIOD_RANK[rt.period];
      const [fine, fineP, coarse, coarseP] = lFiner
        ? [lName, lt.period, rName, rt.period]
        : [rName, rt.period, lName, lt.period];
      problem(
        "formula.period_mismatch",
        node,
        `Period mismatch: ${fine} is per ${fineP} but ${coarse} is per ${coarseP}; convert with to_period(${fine}, ${coarseP})`,
        { left: fine, leftPeriod: fineP, right: coarse, rightPeriod: coarseP },
      );
      return false;
    }
    if (!strict) return true;
    const [withP, withT, without] =
      lt.period !== "none" ? [lt.periodFrom ?? label(l), lt, label(r)] : [rt.periodFrom ?? label(r), rt, label(l)];
    problem(
      "formula.period_mismatch",
      node,
      `Period mismatch: ${withP} is per ${withT.period} but ${without} has no period`,
      {
        left: withP,
        leftPeriod: withT.period,
        right: without,
        rightPeriod: "none",
      },
    );
    return false;
  };

  const periodOf = (lt: Typed, rt: Typed): Pick<Typed, "period" | "periodFrom"> =>
    lt.period !== "none"
      ? { period: lt.period, periodFrom: lt.periodFrom }
      : { period: rt.period, periodFrom: rt.periodFrom };

  /** Same kind/currency/period (and quantity unit), as + − min max need. False when a problem was reported. */
  const sameShape = (
    node: ExprNode,
    op: string,
    l: ExprNode,
    lt: Typed,
    r: ExprNode,
    rt: Typed,
    kind: FormulaKind | null,
  ): boolean => {
    const unitClash =
      lt.kind === "quantity" && rt.kind === "quantity" && lt.unit !== null && rt.unit !== null && lt.unit !== rt.unit;
    if (kind === null || unitClash) {
      kindMismatch(node, op, l, lt, r, rt);
      return false;
    }
    if (lt.currency !== null && rt.currency !== null && lt.currency !== rt.currency) {
      currencyMismatch(node, lt.currencyFrom ?? label(l), lt.currency, rt.currencyFrom ?? label(r), rt.currency);
      return false;
    }
    return checkPeriods(node, l, lt, r, rt, true);
  };

  const walk = (node: ExprNode): Typed | null => {
    switch (node.type) {
      case "number":
        return { kind: "number", currency: null, period: "none", unit: null, periodFrom: null, currencyFrom: null };
      case "variable": {
        const v = variables.get(node.name);
        if (!v) {
          if (undefinedSeen.has(node.name)) return null;
          undefinedSeen.add(node.name);
          return problem("formula.undefined_variable", node, `Undefined variable: ${node.name}`, { name: node.name });
        }
        return {
          kind: v.kind,
          currency: v.currency ?? null,
          period: v.period,
          unit: v.unit ?? null,
          periodFrom: v.period === "none" ? null : v.name,
          currencyFrom: v.currency ? v.name : null,
        };
      }
      case "unary":
        return walk(node.operand);
      case "binary": {
        const lt = walk(node.left);
        const rt = walk(node.right);
        if (!lt || !rt) return null;
        const { left: l, right: r, op } = node;
        if (op === "+" || op === "-") {
          let kind: FormulaKind | null = null;
          if (lt.kind === rt.kind) kind = op === "-" && lt.kind === "fraction" ? "fraction_delta" : lt.kind;
          else if (lt.kind === "fraction" && rt.kind === "fraction_delta") kind = "fraction";
          else if (op === "+" && lt.kind === "fraction_delta" && rt.kind === "fraction") kind = "fraction";
          if (!sameShape(node, op, l, lt, r, rt, kind)) return null;
          return { ...lt, kind: kind!, unit: lt.unit ?? rt.unit };
        }
        if (op === "*") {
          if (lt.kind === "currency" && rt.kind === "currency") {
            return problem(
              "formula.currency_product",
              node,
              `Currency product: ${label(l)} and ${label(r)} are both currency amounts and cannot be multiplied`,
              { left: label(l), right: label(r) },
            );
          }
          const ld = DIMENSIONLESS_KINDS.includes(lt.kind);
          const rd = DIMENSIONLESS_KINDS.includes(rt.kind);
          let shape: Pick<Typed, "kind" | "unit" | "currency" | "currencyFrom"> | null = null;
          if (ld && rd) {
            const kind: FormulaKind =
              lt.kind === "number"
                ? rt.kind
                : rt.kind === "number"
                  ? lt.kind
                  : lt.kind === rt.kind
                    ? lt.kind
                    : "number";
            shape = { kind, unit: null, currency: null, currencyFrom: null };
          } else if (ld) shape = rt;
          else if (rd) shape = lt;
          else if (lt.kind === "count" && rt.kind === "currency") shape = rt;
          else if (lt.kind === "currency" && rt.kind === "count") shape = lt;
          else if (lt.kind === "count" && rt.kind === "count")
            shape = { kind: "quantity", unit: null, currency: null, currencyFrom: null };
          else if (lt.kind === "count" && rt.kind === "quantity") shape = rt;
          else if (lt.kind === "quantity" && rt.kind === "count") shape = lt;
          if (!shape) return kindMismatch(node, "*", l, lt, r, rt);
          if (!checkPeriods(node, l, lt, r, rt, false)) return null;
          return {
            kind: shape.kind,
            unit: shape.unit,
            currency: shape.currency,
            currencyFrom: shape.currencyFrom,
            ...periodOf(lt, rt),
          };
        }
        // division
        if (rt.kind === "number") {
          if (!checkPeriods(node, l, lt, r, rt, false)) return null;
          return { ...lt, ...periodOf(lt, rt) };
        }
        if (lt.kind === "currency" && rt.kind === "currency") {
          if (lt.currency !== rt.currency) {
            return currencyMismatch(
              node,
              lt.currencyFrom ?? label(l),
              lt.currency ?? "",
              rt.currencyFrom ?? label(r),
              rt.currency ?? "",
            );
          }
          if (!checkPeriods(node, l, lt, r, rt, false)) return null;
          const p = lt.period === rt.period ? { period: "none" as const, periodFrom: null } : periodOf(lt, rt);
          return { kind: "number", unit: null, currency: null, currencyFrom: null, ...p };
        }
        if (lt.kind === "currency" && rt.kind === "count") {
          if (!checkPeriods(node, l, lt, r, rt, false)) return null;
          return { ...lt, ...periodOf(lt, rt) };
        }
        return kindMismatch(node, "/", l, lt, r, rt);
      }
      case "call": {
        if (node.fn === "to_period") {
          const x = node.args[0] as ExprNode;
          const target = node.args[1];
          const xt = walk(x);
          if (!xt || !target || target.type !== "period") return null;
          if (xt.period === "none") {
            return problem(
              "formula.period_mismatch",
              node,
              `Period mismatch: to_period needs a value with a period, but ${label(x)} has no period`,
              {
                left: label(x),
                leftPeriod: "none",
                right: target.period,
                rightPeriod: target.period,
              },
            );
          }
          conversions.set(node, xt.period);
          return { ...xt, period: target.period, periodFrom: label(node) };
        }
        const args = node.args as readonly ExprNode[];
        const types = args.map(walk);
        if (types.some((t) => t === null)) return null;
        const first = types[0]!;
        if (node.fn === "abs") return first;
        for (let i = 1; i < args.length; i++) {
          const t = types[i]!;
          if (!sameShape(node, node.fn, args[0]!, first, args[i]!, t, first.kind === t.kind ? first.kind : null))
            return null;
        }
        return first;
      }
    }
  };

  const result = walk(ast.root);

  // At most one currency per formula, even across operations that are individually well typed.
  if (errors.length === 0) {
    let seen: { name: string; currency: string } | null = null;
    for (const name of ast.variables) {
      const v = variables.get(name);
      if (!v || v.kind !== "currency" || !v.currency) continue;
      if (seen === null) seen = { name, currency: v.currency };
      else if (seen.currency !== v.currency) {
        currencyMismatch(ast.root, seen.name, seen.currency, name, v.currency);
        break;
      }
    }
  }

  if (errors.length > 0 || result === null) return { ok: false, errors };
  return {
    ok: true,
    resultType: { kind: result.kind, currency: result.currency, period: result.period, unit: result.unit },
    conversions,
  };
}
