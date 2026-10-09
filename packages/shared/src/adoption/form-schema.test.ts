// Unit tests of the validated form JSON (ADR-0033 §5; T-DG4-BE-H2), mirroring the database probes FM01-FM04 of
// T-DG4-ARCH-06 (a valid proficiency and feedback form; no proficiency question on a proficiency form; an unknown
// member; duplicate keys), plus answer validation and the derived proficiency result. Pure; all data is synthetic.
import { describe, expect, it } from "vitest";
import {
  assessmentFormSchemaShape,
  deriveProficiencyResult,
  validateAnswers,
  validateFormSchema,
  type AssessmentFormSchemaJson,
} from "./form-schema.ts";

const yesNo = { key: "can_do", type: "yes_no", label_en: "Can do it?", label_ar: "هل يستطيع؟", required: true };
const PROFICIENCY_YES_NO = { questions: [{ ...yesNo, proficiency: true }] };
const PROFICIENCY_SCALE = {
  questions: [
    {
      key: "level",
      type: "scale",
      label_en: "Level",
      label_ar: "المستوى",
      required: true,
      min: 1,
      max: 5,
      proficiency: true,
      pass_min: 4,
    },
    { key: "notes", type: "text", label_en: "Notes", label_ar: "ملاحظات", required: false },
  ],
};
const FEEDBACK = {
  questions: [
    {
      key: "clarity",
      type: "single_choice",
      label_en: "How clear was the launch?",
      label_ar: "ما مدى وضوح الإطلاق؟",
      required: true,
      options: [
        { value: "clear", label_en: "Clear", label_ar: "واضح" },
        { value: "unclear", label_en: "Unclear", label_ar: "غير واضح" },
      ],
    },
    { key: "score", type: "scale", label_en: "Score", label_ar: "الدرجة", required: false, min: 0, max: 10 },
    { key: "recommend", type: "yes_no", label_en: "Recommend?", label_ar: "توصي؟", required: false },
    { key: "comment", type: "text", label_en: "Comment", label_ar: "تعليق", required: false },
  ],
};

describe("validateFormSchema (ADR-0033 §5; probes FM01-FM04)", () => {
  it("FM01: valid proficiency (yes/no and scale) and feedback forms are accepted and match the typed shape", () => {
    expect(validateFormSchema("proficiency_assessment", PROFICIENCY_YES_NO)).toEqual([]);
    expect(validateFormSchema("proficiency_assessment", PROFICIENCY_SCALE)).toEqual([]);
    expect(validateFormSchema("feedback", FEEDBACK)).toEqual([]);
    for (const s of [PROFICIENCY_YES_NO, PROFICIENCY_SCALE, FEEDBACK])
      expect(assessmentFormSchemaShape.safeParse(s).success).toBe(true);
  });

  it("FM02: a proficiency form without a proficiency question, or a feedback form with one, is refused", () => {
    expect(validateFormSchema("proficiency_assessment", { questions: [yesNo] })).toEqual([
      { pointer: "/questions", reason: "a proficiency assessment has exactly one proficiency question" },
    ]);
    expect(validateFormSchema("feedback", PROFICIENCY_YES_NO)).toEqual([
      { pointer: "/questions", reason: "a feedback form has no proficiency question" },
    ]);
    const two = {
      questions: [
        { ...yesNo, proficiency: true },
        { ...yesNo, key: "again", proficiency: true },
      ],
    };
    expect(validateFormSchema("proficiency_assessment", two).map((i) => i.pointer)).toEqual(["/questions"]);
  });

  it("FM03: an unknown member is refused at its own pointer (question, option and top level)", () => {
    expect(validateFormSchema("feedback", { questions: [{ ...yesNo, colour: "red" }] })).toEqual([
      { pointer: "/questions/0/colour", reason: 'unknown member "colour"' },
    ]);
    const opt = structuredClone(FEEDBACK);
    (opt.questions[0]!.options![1] as Record<string, unknown>)["hint"] = "x";
    expect(validateFormSchema("feedback", opt)).toEqual([
      { pointer: "/questions/0/options/1/hint", reason: 'unknown member "hint"' },
    ]);
    expect(validateFormSchema("feedback", { questions: [yesNo], title: "x" })[0]!.pointer).toBe("/title");
  });

  it("FM04: duplicate question keys and duplicate option values are refused at the second one", () => {
    expect(validateFormSchema("feedback", { questions: [yesNo, { ...yesNo }] })).toEqual([
      { pointer: "/questions/1/key", reason: 'duplicate question key "can_do"' },
    ]);
    const dup = structuredClone(FEEDBACK);
    dup.questions[0]!.options![1]!.value = "clear";
    expect(validateFormSchema("feedback", dup)).toEqual([
      { pointer: "/questions/0/options/1/value", reason: 'duplicate option value "clear"' },
    ]);
  });

  it("the shape rules: question count, key, type, labels, options/min/max/pass_min only where they belong", () => {
    const f = (q: Record<string, unknown>) => validateFormSchema("feedback", { questions: [q] }).map((i) => i.pointer);
    expect(validateFormSchema("feedback", { questions: [] }).map((i) => i.pointer)).toEqual(["/questions"]);
    expect(
      validateFormSchema("feedback", { questions: Array.from({ length: 21 }, (_, i) => ({ ...yesNo, key: `q${i}` })) })
        .length,
    ).toBe(1);
    expect(validateFormSchema("feedback", [])).toEqual([
      { pointer: "", reason: "the form must be an object with questions" },
    ]);
    expect(f({ ...yesNo, key: "Bad-Key" })).toEqual(["/questions/0/key"]);
    expect(f({ ...yesNo, type: "slider" })).toEqual(["/questions/0/type"]);
    expect(f({ ...yesNo, label_en: "   " })).toEqual(["/questions/0/label_en"]);
    expect(f({ ...yesNo, label_ar: "x".repeat(501) })).toEqual(["/questions/0/label_ar"]);
    expect(f({ ...yesNo, required: "yes" })).toEqual(["/questions/0/required"]);
    expect(f({ ...yesNo, options: [] })).toEqual(["/questions/0/options"]);
    expect(f({ ...yesNo, min: 0 })).toEqual(["/questions/0/min"]);
    expect(f({ ...yesNo, pass_min: 1 })).toEqual(["/questions/0/pass_min"]);
    expect(f({ ...yesNo, type: "single_choice" })).toEqual(["/questions/0/options"]);
    expect(f({ ...yesNo, type: "scale", min: 5, max: 5 })).toEqual(["/questions/0/max"]);
    expect(f({ ...yesNo, type: "scale", min: 0, max: 11 })).toEqual(["/questions/0/max"]);
    expect(f({ ...yesNo, type: "scale", min: 1.5, max: 5 })).toEqual(["/questions/0/min"]);
    const scaleProf = { ...PROFICIENCY_SCALE.questions[0]! };
    expect(
      validateFormSchema("proficiency_assessment", { questions: [{ ...scaleProf, pass_min: 6 }] }).map(
        (i) => i.pointer,
      ),
    ).toEqual(["/questions/0/pass_min"]);
    const { pass_min: _omit, ...noPass } = scaleProf;
    expect(validateFormSchema("proficiency_assessment", { questions: [noPass] }).map((i) => i.pointer)).toEqual([
      "/questions/0/pass_min",
    ]);
    expect(
      validateFormSchema("proficiency_assessment", {
        questions: [{ ...yesNo, proficiency: true, required: false }],
      }).map((i) => i.pointer),
    ).toEqual(["/questions/0/required"]);
    expect(
      validateFormSchema("proficiency_assessment", {
        questions: [{ key: "t", type: "text", label_en: "T", label_ar: "ت", required: true, proficiency: true }],
      }).map((i) => i.pointer),
    ).toEqual(["/questions/0/proficiency"]);
  });
});

describe("validateAnswers and deriveProficiencyResult (ADR-0033 §5)", () => {
  const feedback = FEEDBACK as AssessmentFormSchemaJson;
  const scale = PROFICIENCY_SCALE as AssessmentFormSchemaJson;
  const yn = PROFICIENCY_YES_NO as AssessmentFormSchemaJson;

  it("accepts answers of each type; optional questions may be omitted", () => {
    expect(validateAnswers(feedback, { clarity: "clear", score: 7, recommend: true, comment: "نعم، واضح" })).toEqual(
      [],
    );
    expect(validateAnswers(feedback, { clarity: "unclear" })).toEqual([]);
  });

  it("refuses a missing required answer, a wrong type, an unknown option or key, out-of-bounds and blank text", () => {
    const codes = (a: Record<string, unknown>) => validateAnswers(feedback, a).map((i) => `${i.key}:${i.code}`);
    expect(codes({})).toEqual(["clarity:assessment_record.answer_required"]);
    expect(codes({ clarity: "maybe" })).toEqual(["clarity:assessment_record.answer_invalid"]);
    expect(codes({ clarity: "clear", score: 11 })).toEqual(["score:assessment_record.answer_invalid"]);
    expect(codes({ clarity: "clear", score: 2.5 })).toEqual(["score:assessment_record.answer_invalid"]);
    expect(codes({ clarity: "clear", recommend: "yes" })).toEqual(["recommend:assessment_record.answer_invalid"]);
    expect(codes({ clarity: "clear", comment: "  " })).toEqual(["comment:assessment_record.answer_invalid"]);
    expect(codes({ clarity: "clear", comment: "x".repeat(2001) })).toEqual([
      "comment:assessment_record.answer_invalid",
    ]);
    expect(codes({ clarity: "clear", extra: 1 })).toEqual(["extra:assessment_record.answer_invalid"]);
  });

  it("derives the result from the proficiency answer: yes/no and scale >= pass_min; null for feedback", () => {
    expect(deriveProficiencyResult(yn, { can_do: true })).toBe("proficient");
    expect(deriveProficiencyResult(yn, { can_do: false })).toBe("not_yet_proficient");
    expect(deriveProficiencyResult(scale, { level: 4 })).toBe("proficient");
    expect(deriveProficiencyResult(scale, { level: 5 })).toBe("proficient");
    expect(deriveProficiencyResult(scale, { level: 3 })).toBe("not_yet_proficient");
    expect(deriveProficiencyResult(feedback, { clarity: "clear" })).toBeNull();
  });
});
