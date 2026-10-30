// The assistant's guardrails (ADR-0059 §5 "Output handling", §6, §8; REQ-S17-007, REQ-S17-008; T-DG6-BE-U).
//
//   classifyPrompt(prompt)   §8: the deterministic refused-intent rule, in English and Arabic. It runs BEFORE retrieval
//                            and before any model call; a refused prompt gets a `refusal` reply with its code, no
//                            retrieval and no provider call. The prompt is normalized (lower case; Arabic diacritics and
//                            tatweel removed; أ/إ/آ -> ا; ى -> ي), leading politeness and request phrases are removed,
//                            and the prompt is refused when it then STARTS with a verb of an intent and CONTAINS one of
//                            that intent's objects. The intents are evaluated in the table order; the first match
//                            decides. A question about a process ("how do I approve gate G4?") does not start with the
//                            verb and is answered. This rule is defence in depth, not the guarantee: the guarantee is
//                            §7 (no tool interface, no writing module, the assistant writes only its own tables).
//   citationsFor(...)        §5: the model's cited refs intersected with the refs actually given (refs not given are
//                            dropped); when the model cites none, every item given is cited. At least one, at most 20.
//   answerText(...)          §5: plain text, at most 8,000 characters (truncateText); characters PostgreSQL cannot
//                            store (U+0000, lone surrogates) are removed.
//   filterSuggestions(...)   §5, §6: at most 5; kept only if the kind is one of the four, its fields pass §6 (the 0111
//                            `p6_assistant_draft_fields_valid` rule, plus the shared free-text rules) and the
//                            conversation has a transformation focus. Every other one is dropped and counted.
// Nothing here writes, approves or calls anything; it is pure.
import { hasInvalidCharacter, hasText, truncateText } from "@mth/shared/schemas";
import type { RefusalCode, SuggestionDraft } from "./answer.ts";
import type { Citation, QuotedItem, RawSuggestion } from "./provider.ts";

// ------------------------------------------------------------------------------------------------ §8 refused intents

/** Lower case; Arabic diacritics (U+064B-U+0652, U+0670) and tatweel removed; أ/إ/آ -> ا; ى -> ي. */
export function normalizePrompt(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي");
}

/** Words: letters, digits and `%` (an object of the value-change intent), after normalization. */
function tokensOf(normalized: string): string[] {
  return normalized.match(/[\p{L}\p{N}]+|%/gu) ?? [];
}

const tokens = (phrase: string): string[] => tokensOf(normalizePrompt(phrase));

/** §8: leading politeness and request phrases, removed (repeatedly) before the verb test. */
const POLITENESS = [
  "please",
  "kindly",
  "can you",
  "could you",
  "would you",
  "i want you to",
  "go ahead and",
  "من فضلك",
  "لو سمحت",
  "هل يمكنك",
  "أريدك أن",
].map(tokens);

interface Intent {
  readonly code: RefusalCode;
  readonly verbs: readonly string[][];
  /** English objects: whole words (or a word sequence). */
  readonly objectsEn: readonly string[][];
  /** Arabic objects: a word that is the object, possibly with a one-letter conjunction or preposition and/or the article. */
  readonly objectsAr: readonly string[];
}

/** ADR-0059 §8, in its table order (the first match decides). */
export const REFUSED_INTENTS: readonly Intent[] = [
  {
    code: "assistant.refused.approval",
    verbs: [
      ...["approve", "reject", "submit", "sign off", "endorse", "authorize", "authorise"],
      ...["اعتمد", "وافق", "ارفض", "قدم", "ارسل"],
    ].map(tokens),
    objectsEn: [
      ...["gate", "g1", "g2", "g3", "g4", "g5", "g6", "approval", "business approval", "decision"],
      ...["business case", "funding"],
    ].map(tokens),
    objectsAr: ["بوابة", "البوابة", "اعتماد", "الاعتماد", "قرار", "موافقة", "تمويل"].map(normalizePrompt),
  },
  {
    code: "assistant.refused.benefit_validation",
    verbs: ["validate", "certify", "verify", "attest", "sign off", "تحقق", "صادق", "اعتمد"].map(tokens),
    objectsEn: ["benefit", "benefits", "saving", "savings"].map(tokens),
    objectsAr: ["منفعة", "المنفعة", "المنافع", "وفورات"].map(normalizePrompt),
  },
  {
    code: "assistant.refused.value_change",
    verbs: [
      ...["change", "set", "update", "edit", "modify", "increase", "decrease", "raise", "lower", "adjust"],
      ...["overwrite", "replace", "غير", "عدل", "حدث", "اضبط", "ارفع", "اخفض"],
    ].map(tokens),
    objectsEn: [
      ...["value", "amount", "figure", "number", "target", "actual", "baseline", "forecast", "budget", "cost"],
      ...["npv", "irr", "kpi", "sar", "%"],
    ].map(tokens),
    objectsAr: ["قيمة", "القيمة", "مبلغ", "المستهدف", "الفعلي", "خط الاساس", "الميزانية", "التكلفة"].map(
      normalizePrompt,
    ),
  },
  {
    code: "assistant.refused.evidence",
    verbs: [
      ...["create", "add", "upload", "attach", "generate", "invent", "fabricate", "make up"],
      ...["انشئ", "اضف", "ارفع", "اختلق", "لفق"],
    ].map(tokens),
    objectsEn: ["evidence", "proof", "attachment"].map(tokens),
    objectsAr: ["دليل", "الادلة", "اثبات", "مرفق"].map(normalizePrompt),
  },
];

const startsWith = (words: readonly string[], phrase: readonly string[]) =>
  phrase.length > 0 && phrase.length <= words.length && phrase.every((p, i) => words.at(i) === p);

const containsSequence = (words: readonly string[], phrase: readonly string[]) => {
  for (let i = 0; i + phrase.length <= words.length; i += 1)
    if (phrase.every((p, j) => words.at(i + j) === p)) return true;
  return false;
};

/** One-letter Arabic conjunctions and prepositions that attach to the next word (و, ف, ب, ل, ك). */
const AR_PREFIX = /^[وفبلك]/;

/** The Arabic definite article (ال). */
const AR_ARTICLE = "ال";

/** The forms of one Arabic word: as written, without one attached letter, and without the article after that. */
function arabicForms(word: string): string[] {
  const forms = [word];
  if (AR_PREFIX.test(word)) forms.push(word.slice(1));
  for (const f of [...forms]) if (f.startsWith(AR_ARTICLE) && f.length > 3) forms.push(f.slice(2));
  return forms;
}

function containsArabicObject(words: readonly string[], normalized: string, object: string): boolean {
  if (object.includes(" ")) return normalized.includes(object);
  return words.some((w) => arabicForms(w).includes(object));
}

/** The words of the prompt after normalization and the removal of leading politeness phrases. */
export function promptWords(prompt: string): string[] {
  const words = tokensOf(normalizePrompt(prompt));
  for (let changed = true; changed; ) {
    changed = false;
    for (const phrase of POLITENESS)
      if (startsWith(words, phrase)) {
        words.splice(0, phrase.length);
        changed = true;
      }
  }
  return words;
}

/** §8: the refusal code of a prompt, or null when it may be answered. */
export function classifyPrompt(prompt: string): RefusalCode | null {
  const words = promptWords(prompt);
  const normalized = words.join(" ");
  for (const intent of REFUSED_INTENTS) {
    if (!intent.verbs.some((v) => startsWith(words, v))) continue;
    if (
      intent.objectsEn.some((o) => containsSequence(words, o)) ||
      intent.objectsAr.some((o) => containsArabicObject(words, normalized, o))
    )
      return intent.code;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------ §5 output handling

/** ADR-0059 §5: an answer is at most 8,000 characters. */
export const MAX_ANSWER_CHARS = 8000;
/** 0111 `p6_assistant_citations_valid`: at most 20 citations. */
export const MAX_CITATIONS = 20;
/** ADR-0059 §5: at most 5 suggestions per answer. */
export const MAX_SUGGESTIONS = 5;

/** Removes what PostgreSQL text cannot hold (U+0000) and lone surrogates (the shared invalid-character rule). */
export function storableText(text: string): string {
  return text.replace(/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

/** The answer as stored: plain text, storable, at most `max` characters; null when nothing visible is left. */
export function answerText(raw: string, max: number = MAX_ANSWER_CHARS): string | null {
  const text = truncateText(storableText(raw), max);
  return hasText(text) ? text : null;
}

/**
 * §5 citations: the model's refs that were actually given, in the order given (duplicates and refs not given are
 * dropped); when none is left, every item given. At most 20 (retrieval gives at most 20 items).
 */
export function citationsFor(data: readonly QuotedItem[], citedRefs: readonly number[]): Citation[] {
  const cited = new Set(citedRefs);
  const kept = data.filter((d) => cited.has(d.ref));
  return (kept.length > 0 ? kept : data).slice(0, MAX_CITATIONS).map((d) => d.citation);
}

/** §6 draft fields of each target (0111 `p6_assistant_draft_fields_valid`), with their maximum lengths. */
export const DRAFT_FIELD_LIMITS: Readonly<Record<"charter" | "T16", Readonly<Record<string, number>>>> = {
  charter: {
    case_for_change: 4000,
    in_scope: 4000,
    out_of_scope: 4000,
    governance_forum: 500,
    decision_rights: 4000,
    success_definition: 4000,
    thesis_change: 4000,
    thesis_outcomes: 4000,
    thesis_benefits: 4000,
    thesis_because: 4000,
  },
  T16: { decision: 500, why_now: 4000, recommendation: 4000, impact_if_delayed: 4000 },
};

const ADVICE_KINDS = new Set(["missing_evidence", "recovery_action"]);

/** A free-text value as the shared rules accept it: visible, storable, within `max` characters. */
const acceptableText = (value: unknown, max: number): value is string =>
  typeof value === "string" &&
  value.length >= 1 &&
  value.length <= max &&
  !hasInvalidCharacter(value) &&
  hasText(value);

/** One raw suggestion checked against §6, or null (dropped). */
export function acceptSuggestion(raw: RawSuggestion, citations: readonly Citation[]): SuggestionDraft | null {
  if (raw.kind === "charter_draft" || raw.kind === "decision_brief_draft") {
    const target = raw.kind === "charter_draft" ? "charter" : "T16";
    const limits = new Map(Object.entries(target === "charter" ? DRAFT_FIELD_LIMITS.charter : DRAFT_FIELD_LIMITS.T16));
    const fields = raw.fields;
    if (fields === undefined || fields === null || typeof fields !== "object" || Array.isArray(fields)) return null;
    const entries = Object.entries(fields);
    if (entries.length === 0) return null;
    const kept: [string, string][] = [];
    for (const [key, value] of entries) {
      const max = limits.get(key);
      if (max === undefined || !acceptableText(value, max)) return null;
      kept.push([key, value]);
    }
    return { kind: raw.kind, targetRecordType: target, fields: Object.fromEntries(kept), textContent: null, citations };
  }
  if (ADVICE_KINDS.has(raw.kind)) {
    if (!acceptableText(raw.text, 4000)) return null;
    return {
      kind: raw.kind as "missing_evidence" | "recovery_action",
      targetRecordType: null,
      fields: null,
      textContent: raw.text,
      citations,
    };
  }
  return null;
}

/**
 * §5: at most 5 suggestions, each passing §6, and only on a conversation with a transformation focus (a suggestion
 * belongs to the focus transformation, 0111). Returns the kept ones and the number dropped (for the log line).
 */
export function filterSuggestions(
  raw: readonly RawSuggestion[],
  citations: readonly Citation[],
  hasFocus: boolean,
): { kept: SuggestionDraft[]; dropped: number } {
  if (!hasFocus) return { kept: [], dropped: raw.length };
  const kept: SuggestionDraft[] = [];
  for (const r of raw) {
    if (kept.length >= MAX_SUGGESTIONS) break;
    const s = acceptSuggestion(r, citations);
    if (s !== null) kept.push(s);
  }
  return { kept, dropped: raw.length - kept.length };
}
