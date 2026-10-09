// Short native feedback and assessment forms: the validated form JSON of ADR-0033 §5 (REQ-S11-002; ADR-0014 "validated
// JSON only for versioned forms"), answer validation against a published version, and the derived proficiency result
// (REQ-PB-072: proficiency is recorded by observation, separately from training completion). Pure: no I/O, no clock.
// backend-workflow-engineer, T-DG4-BE-H2 (p4-work-split §F+G FG.2). The database function
// `p4_assessment_form_schema_valid` (0047) is the last line; this module answers first, with the failing pointer.
//
// The schema is the object {"questions": [...]} with 1-20 questions. Each question has exactly the members `key`
// (^[a-z][a-z0-9_]{0,39}$, unique), `type` (single_choice | scale | yes_no | text), `label_en` and `label_ar` (1-500
// characters, shared free-text rules), `required` (boolean), plus `options` (only and always for single_choice: 2-10
// objects with exactly value (^[a-z0-9_]{1,40}$, unique), label_en, label_ar (1-200 characters)), `min`/`max` (only and
// always for scale: integers 0 <= min < max <= 10), `proficiency` (boolean, optional) and `pass_min` (only and always
// for a scale proficiency question, an integer within its bounds). A proficiency_assessment form has exactly one
// required yes_no or scale question with "proficiency": true; a feedback form has none. No other member is accepted.
import { z } from "zod";
import { hasInvalidCharacter, hasText } from "../schemas/common.ts";

export const ASSESSMENT_FORM_KINDS = ["feedback", "proficiency_assessment"] as const;
export type AssessmentFormKind = (typeof ASSESSMENT_FORM_KINDS)[number];
export const ASSESSMENT_QUESTION_TYPES = ["single_choice", "scale", "yes_no", "text"] as const;
export type AssessmentQuestionType = (typeof ASSESSMENT_QUESTION_TYPES)[number];
export type ProficiencyResult = "proficient" | "not_yet_proficient";

export const ASSESSMENT_QUESTION_KEY = /^[a-z][a-z0-9_]{0,39}$/;
export const ASSESSMENT_OPTION_VALUE = /^[a-z0-9_]{1,40}$/;
export const ASSESSMENT_MAX_QUESTIONS = 20;
/** A `text` answer: 1-2000 characters of visible text (the shared free-text rules, S-1). */
export const ASSESSMENT_TEXT_ANSWER_MAX = 2000;

const QUESTION_MEMBERS = new Set([
  "key",
  "type",
  "label_en",
  "label_ar",
  "required",
  "options",
  "min",
  "max",
  "proficiency",
  "pass_min",
]);
const OPTION_MEMBERS = ["value", "label_en", "label_ar"] as const;

/** The typed shape of a valid form schema (the OpenAPI `AssessmentFormSchema` mirror). */
export const assessmentQuestionOption = z.strictObject({
  value: z.string().regex(ASSESSMENT_OPTION_VALUE),
  label_en: z.string().min(1).max(200),
  label_ar: z.string().min(1).max(200),
});
export const assessmentQuestion = z.strictObject({
  key: z.string().regex(ASSESSMENT_QUESTION_KEY),
  type: z.enum(ASSESSMENT_QUESTION_TYPES),
  label_en: z.string().min(1).max(500),
  label_ar: z.string().min(1).max(500),
  required: z.boolean(),
  options: z.array(assessmentQuestionOption).min(2).max(10).optional(),
  min: z.number().int().min(0).max(10).optional(),
  max: z.number().int().min(0).max(10).optional(),
  proficiency: z.boolean().optional(),
  pass_min: z.number().int().min(0).max(10).optional(),
});
export const assessmentFormSchemaShape = z.strictObject({
  questions: z.array(assessmentQuestion).min(1).max(ASSESSMENT_MAX_QUESTIONS),
});
export type AssessmentQuestion = z.infer<typeof assessmentQuestion>;
export type AssessmentFormSchemaJson = z.infer<typeof assessmentFormSchemaShape>;

/** One reason a form schema is not valid: the JSON pointer (relative to the schema object) and an English reason. */
export interface FormSchemaIssue {
  readonly pointer: string;
  readonly reason: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const label = (v: unknown, max: number): boolean =>
  typeof v === "string" && v.length >= 1 && v.length <= max && !hasInvalidCharacter(v) && hasText(v);
/** JSON pointer escaping of one reference token (RFC 6901). */
const token = (s: string): string => s.replace(/~/g, "~0").replace(/\//g, "~1");

/**
 * Validates a form schema for a form of `kind` (ADR-0033 §5). Returns every issue in document order, each at its
 * failing pointer relative to the schema object (e.g. `/questions/2/options`); an empty list means valid. The checks
 * are the database function's, plus the shared free-text rules on labels (S-1).
 */
export function validateFormSchema(kind: AssessmentFormKind, schema: unknown): FormSchemaIssue[] {
  const issues: FormSchemaIssue[] = [];
  if (!isObject(schema)) return [{ pointer: "", reason: "the form must be an object with questions" }];
  for (const k of Object.keys(schema))
    if (k !== "questions") issues.push({ pointer: `/${token(k)}`, reason: `unknown member "${k}"` });
  const questions = schema["questions"];
  if (!Array.isArray(questions))
    return [...issues, { pointer: "/questions", reason: "questions must be a list of 1 to 20 questions" }];
  if (questions.length < 1 || questions.length > ASSESSMENT_MAX_QUESTIONS)
    issues.push({ pointer: "/questions", reason: "a form has 1 to 20 questions" });
  const keys = new Set<string>();
  let proficiencyCount = 0;
  questions.forEach((q, i) => {
    const at = `/questions/${i}`;
    if (!isObject(q)) {
      issues.push({ pointer: at, reason: "a question must be an object" });
      return;
    }
    for (const k of Object.keys(q))
      if (!QUESTION_MEMBERS.has(k)) issues.push({ pointer: `${at}/${token(k)}`, reason: `unknown member "${k}"` });
    if (typeof q["key"] !== "string" || !ASSESSMENT_QUESTION_KEY.test(q["key"]))
      issues.push({
        pointer: `${at}/key`,
        reason: "a question key starts with a lowercase letter and has at most 40 lowercase letters, digits or _",
      });
    else if (keys.has(q["key"])) issues.push({ pointer: `${at}/key`, reason: `duplicate question key "${q["key"]}"` });
    else keys.add(q["key"]);
    const type = q["type"];
    const typeValid = typeof type === "string" && (ASSESSMENT_QUESTION_TYPES as readonly string[]).includes(type);
    if (!typeValid)
      issues.push({ pointer: `${at}/type`, reason: "the question type must be single_choice, scale, yes_no or text" });
    for (const m of ["label_en", "label_ar"] as const)
      if (!label(q[m], 500))
        issues.push({ pointer: `${at}/${m}`, reason: `${m} must be 1 to 500 characters of visible text` });
    if (typeof q["required"] !== "boolean")
      issues.push({ pointer: `${at}/required`, reason: "required must be true or false" });

    // options: only and always for single_choice.
    if (type === "single_choice") {
      const options = q["options"];
      if (!Array.isArray(options) || options.length < 2 || options.length > 10)
        issues.push({ pointer: `${at}/options`, reason: "a single-choice question has 2 to 10 options" });
      else {
        const values = new Set<string>();
        options.forEach((o, j) => {
          const oat = `${at}/options/${j}`;
          if (!isObject(o)) {
            issues.push({ pointer: oat, reason: "an option must be an object" });
            return;
          }
          for (const k of Object.keys(o))
            if (!(OPTION_MEMBERS as readonly string[]).includes(k))
              issues.push({ pointer: `${oat}/${token(k)}`, reason: `unknown member "${k}"` });
          if (typeof o["value"] !== "string" || !ASSESSMENT_OPTION_VALUE.test(o["value"]))
            issues.push({
              pointer: `${oat}/value`,
              reason: "an option value has 1 to 40 lowercase letters, digits or _",
            });
          else if (values.has(o["value"]))
            issues.push({ pointer: `${oat}/value`, reason: `duplicate option value "${o["value"]}"` });
          else values.add(o["value"]);
          for (const m of ["label_en", "label_ar"] as const)
            if (!label(o[m], 200))
              issues.push({ pointer: `${oat}/${m}`, reason: `${m} must be 1 to 200 characters of visible text` });
        });
      }
    } else if ("options" in q)
      issues.push({ pointer: `${at}/options`, reason: "only a single-choice question has options" });

    // min/max: only and always for scale.
    if (type === "scale") {
      const okMin = isInt(q["min"]) && q["min"] >= 0 && q["min"] <= 10;
      const okMax = isInt(q["max"]) && q["max"] >= 0 && q["max"] <= 10;
      if (!okMin) issues.push({ pointer: `${at}/min`, reason: "a scale minimum is an integer from 0 to 10" });
      if (!okMax) issues.push({ pointer: `${at}/max`, reason: "a scale maximum is an integer from 0 to 10" });
      if (okMin && okMax && (q["min"] as number) >= (q["max"] as number))
        issues.push({ pointer: `${at}/max`, reason: "a scale maximum is greater than its minimum" });
    } else
      for (const m of ["min", "max"] as const)
        if (m in q) issues.push({ pointer: `${at}/${m}`, reason: `only a scale question has ${m}` });

    // proficiency and pass_min.
    const proficient = q["proficiency"] === true;
    if ("proficiency" in q && typeof q["proficiency"] !== "boolean")
      issues.push({ pointer: `${at}/proficiency`, reason: "proficiency must be true or false" });
    if (proficient) {
      proficiencyCount += 1;
      if (typeValid && type !== "yes_no" && type !== "scale")
        issues.push({ pointer: `${at}/proficiency`, reason: "the proficiency question is a yes/no or scale question" });
      if (q["required"] !== true)
        issues.push({ pointer: `${at}/required`, reason: "the proficiency question is required" });
    }
    if (type === "scale" && proficient) {
      if (!isInt(q["pass_min"]))
        issues.push({ pointer: `${at}/pass_min`, reason: "a scale proficiency question names its pass_min" });
      else if (isInt(q["min"]) && isInt(q["max"]) && (q["pass_min"] < q["min"] || q["pass_min"] > q["max"]))
        issues.push({ pointer: `${at}/pass_min`, reason: "pass_min is within the scale bounds" });
    } else if ("pass_min" in q)
      issues.push({ pointer: `${at}/pass_min`, reason: "only a scale proficiency question has pass_min" });
  });
  if (kind === "proficiency_assessment" && proficiencyCount !== 1)
    issues.push({
      pointer: "/questions",
      reason: "a proficiency assessment has exactly one proficiency question",
    });
  if (kind === "feedback" && proficiencyCount > 0)
    issues.push({ pointer: "/questions", reason: "a feedback form has no proficiency question" });
  return issues;
}

/** One refused answer: `answer_required` (a required question without an answer) or `answer_invalid`. */
export interface AnswerIssue {
  readonly key: string;
  readonly code: "assessment_record.answer_invalid" | "assessment_record.answer_required";
}

/**
 * Checks `answers` against a valid form schema (ADR-0033 §5): every key is a question key, every required question is
 * answered, a single_choice answer is one of its option values, a scale answer an integer within its bounds, a yes_no
 * answer a boolean and a text answer 1-2000 characters of visible text (shared free-text rules). Returns the issues in
 * question order, then unknown keys; empty when valid.
 */
export function validateAnswers(schema: AssessmentFormSchemaJson, answers: Record<string, unknown>): AnswerIssue[] {
  const issues: AnswerIssue[] = [];
  const known = new Set(schema.questions.map((q) => q.key));
  for (const q of schema.questions) {
    if (!Object.hasOwn(answers, q.key)) {
      if (q.required) issues.push({ key: q.key, code: "assessment_record.answer_required" });
      continue;
    }
    if (!answerFits(q, answers[q.key])) issues.push({ key: q.key, code: "assessment_record.answer_invalid" });
  }
  for (const k of Object.keys(answers))
    if (!known.has(k)) issues.push({ key: k, code: "assessment_record.answer_invalid" });
  return issues;
}

function answerFits(q: AssessmentQuestion, v: unknown): boolean {
  switch (q.type) {
    case "single_choice":
      return typeof v === "string" && (q.options ?? []).some((o) => o.value === v);
    case "scale":
      return isInt(v) && v >= (q.min ?? 0) && v <= (q.max ?? 10);
    case "yes_no":
      return typeof v === "boolean";
    case "text":
      return typeof v === "string" && v.length <= ASSESSMENT_TEXT_ANSWER_MAX && !hasInvalidCharacter(v) && hasText(v);
  }
}

/** The proficiency question of a form schema, or null (a feedback form). */
export function proficiencyQuestion(schema: AssessmentFormSchemaJson): AssessmentQuestion | null {
  return schema.questions.find((q) => q.proficiency === true) ?? null;
}

/**
 * The proficiency result derived from valid answers (ADR-0033 §5; the client never sends it): a yes_no proficiency
 * answer true -> proficient, false -> not_yet_proficient; a scale answer >= pass_min -> proficient, else
 * not_yet_proficient. Null for a schema without a proficiency question.
 */
export function deriveProficiencyResult(
  schema: AssessmentFormSchemaJson,
  answers: Record<string, unknown>,
): ProficiencyResult | null {
  const q = proficiencyQuestion(schema);
  if (q === null) return null;
  const v = answers[q.key];
  if (q.type === "yes_no") return v === true ? "proficient" : "not_yet_proficient";
  return isInt(v) && v >= (q.pass_min ?? Number.POSITIVE_INFINITY) ? "proficient" : "not_yet_proficient";
}
