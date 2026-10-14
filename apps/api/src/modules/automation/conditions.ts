// Pure evaluation of a rule version's conditions against an event payload (ADR-0043 §2, §10; REQ-S12-001,
// REQ-S12-002; p5-work-split §D.2; T-DG5-BE-H2). Used by the dry run; the worker's engine carries the twin
// (apps/worker/src/automation/engine.ts `evaluateConditions`, ADR-0002 rule 5: the worker imports no API code), and a
// parity test runs both over the same cases.
//
// Rules:
//  - every condition must hold (AND); an empty list holds;
//  - numeric operators (gt, gte, lt, lte) compare decimal strings with decimal.js (@mth/shared/calc's
//    `FORMULA_DECIMAL`, reused unchanged), never floats. A payload value that is missing, null, a non-integer JSON number or not a decimal
//    string makes the condition NOT met and records the finding `automation.condition_unknown_value` (never "0");
//  - eq, neq and in on a missing or null value are NOT met with the same finding: Unknown never matches;
//  - present / absent test whether the member is there and not null; they never produce a finding.
import { FORMULA_DECIMAL as D } from "@mth/shared/calc";
import { AUTOMATION_DECIMAL_PATTERN, type AutomationCondition } from "@mth/shared/schemas";

/** A payload decimal: a plain decimal string (no exponent, no float), at most 40 characters. */
const PAYLOAD_DECIMAL = /^-?[0-9]{1,24}(\.[0-9]{1,12})?$/;

export const CONDITION_UNKNOWN_VALUE = "automation.condition_unknown_value";

export interface ConditionFinding {
  readonly code: typeof CONDITION_UNKNOWN_VALUE;
  /** JSON pointer of the condition (`/conditions/<index>`). */
  readonly pointer: string;
  readonly field: string;
}

export interface ConditionEvaluation {
  readonly met: boolean;
  readonly findings: readonly ConditionFinding[];
}

/** The payload member as a canonical scalar string for comparison, or null when it has no usable value. */
function scalarOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isSafeInteger(value) ? String(value) : null;
  return null;
}

/** The payload member as a decimal string, or null (missing, null, float, or not a decimal string). */
function decimalOf(value: unknown): string | null {
  const s = scalarOf(value);
  return s !== null && PAYLOAD_DECIMAL.test(s) ? s : null;
}

const member = (payload: Readonly<Record<string, unknown>>, field: string): unknown =>
  Object.prototype.hasOwnProperty.call(payload, field) ? new Map(Object.entries(payload)).get(field) : undefined;

/** Evaluates one condition: true, false, or "unknown" (no usable value). */
function evaluateOne(c: AutomationCondition, payload: Readonly<Record<string, unknown>>): boolean | "unknown" {
  const raw = member(payload, c.field);
  const present = raw !== undefined && raw !== null;
  switch (c.op) {
    case "present":
      return present;
    case "absent":
      return !present;
    case "eq":
    case "neq": {
      if (!present) return "unknown";
      let equal: boolean;
      if (typeof c.value === "boolean") equal = raw === c.value;
      else {
        const s = scalarOf(raw);
        if (s === null) return "unknown";
        equal = s === c.value;
      }
      return c.op === "eq" ? equal : !equal;
    }
    case "in": {
      if (!present) return "unknown";
      const s = scalarOf(raw);
      if (s === null) return "unknown";
      return Array.isArray(c.value) && c.value.includes(s);
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const left = decimalOf(raw);
      if (left === null || typeof c.value !== "string" || !AUTOMATION_DECIMAL_PATTERN.test(c.value)) return "unknown";
      const cmp = new D(left).comparedTo(new D(c.value));
      if (c.op === "gt") return cmp > 0;
      if (c.op === "gte") return cmp >= 0;
      if (c.op === "lt") return cmp < 0;
      return cmp <= 0;
    }
    default:
      return "unknown";
  }
}

/** All conditions must hold; an unknown value is "not met" with a finding (ADR-0043 §2). */
export function evaluateConditions(
  conditions: readonly AutomationCondition[],
  payload: Readonly<Record<string, unknown>>,
): ConditionEvaluation {
  let met = true;
  const findings: ConditionFinding[] = [];
  conditions.forEach((c, i) => {
    const r = evaluateOne(c, payload);
    if (r === "unknown") {
      met = false;
      findings.push({ code: CONDITION_UNKNOWN_VALUE, pointer: `/conditions/${i}`, field: c.field });
    } else if (!r) met = false;
  });
  return { met, findings };
}
