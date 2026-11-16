// Term lists and text helpers of the claims scan (ADR-0063 §3; REQ-S16-033). The lists live ONLY here, so no document
// has to spell out a claim in order to describe the rule. Rule K1 (PMI) is NOT here: it is imported unchanged from
// packages/shared/src/text-scan/claims.ts by claims-scan.mjs (DG5-approved, single source).
//
// Matching is case-insensitive (Arabic has no case). Arabic words are normalized (diacritics and tatweel removed) and
// matched with or without a leading conjunction or article (و، ف، ب، ال، لل ...). Dependency-free; no network.

/** K2: English verb, adjective and noun forms of comply, conform, certify, accredit and attest. Never "certificate". */
export const CONFORMITY_WORDS = Object.freeze([
  "comply",
  "complies",
  "complied",
  "complying",
  "compliant",
  "compliance",
  "conform",
  "conforms",
  "conformed",
  "conforming",
  "conformant",
  "conformance",
  "conformity",
  "certify",
  "certifies",
  "certified",
  "certifying",
  "certification",
  "certifications",
  "accredit",
  "accredits",
  "accredited",
  "accrediting",
  "accreditation",
  "attest",
  "attests",
  "attested",
  "attesting",
  "attestation",
]);

/**
 * K2 (Arabic): conformity forms of the roots ط-ب-ق and م-ث-ل, and the noun شهادة. The forms of و-ف-ق (متوافق ...) and
 * ع-م-د (معتمد ...) are scored like their English counterparts "aligned/compatible" and "approved": in this product's
 * Arabic they mean "compatible with" (S3) and "approved by" (Finance, an approver), which are no conformity claims. They
 * are therefore ASSERTION_WORDS (K3, next to a named framework) and, for ع-م-د, CERTIFIED_ADJECTIVES_AR (K4). The
 * everyday senses "according to" (وفقًا) and "application" (تطبيق) are not listed at all.
 */
export const CONFORMITY_WORDS_AR = Object.freeze([
  "مطابق",
  "مطابقة",
  "يطابق",
  "تطابق",
  "امتثال",
  "ممتثل",
  "ممتثلة",
  "يمتثل",
  "تمتثل",
  "شهادة",
]);

/**
 * K2 governed objects that name the transformation's own process, not a standard: playbook B0110's adoption measure
 * "Compliance with new process" and its Arabic label. A K2 hit whose object (the words after the governing word)
 * starts with one of these is not a claim. Matched on normalized words.
 */
export const NON_CLAIM_OBJECTS = Object.freeze([["new", "process"], ["العملية", "الجديدة"]]);

/** K2 governing words: an object follows within 4 words. */
export const GOVERNING_AFTER = Object.freeze(["with", "to", "by", "under", "against", "for"]);
/** K2 governing words: placed directly before the conformity word. */
export const GOVERNING_BEFORE = Object.freeze(["fully", "100%", "officially"]);
/** K2 Arabic governing particles (لـ is matched as an attached prefix of the next word). */
export const GOVERNING_AFTER_AR = Object.freeze(["مع", "من", "ل"]);

/** K3: words that assert a relation to a named framework. */
export const ASSERTION_WORDS = Object.freeze([
  "meets",
  "meet",
  "satisfies",
  "satisfy",
  "satisfied",
  "aligned",
  "aligns",
  "approved",
  "approves",
  "endorsed",
  "adheres",
  "adherent",
  "متوافق",
  "متوافقة",
  "يتوافق",
  "تتوافق",
  "توافق",
  "معتمد",
  "معتمدة",
  "يلبي",
  "تلبي",
  "يستوفي",
  "تستوفي",
  "يتماشى",
  "تتماشى",
  "متماشي",
  "متماشية",
]);

/** K3: named frameworks, standards, regulations and brand rules (source, as case-insensitive RegExp sources). */
export const FRAMEWORKS = Object.freeze([
  ["iso-27000", String.raw`\bISO(?:\s*/\s*IEC)?[\s-]*27\d{3}\b`],
  ["iso-22301", String.raw`\bISO(?:\s*/\s*IEC)?[\s-]*22301\b`],
  ["iso-9001", String.raw`\bISO[\s-]*9001\b`],
  ["soc", String.raw`\bSOC\s*[123]\b`],
  ["pci-dss", String.raw`\bPCI[\s-]*DSS\b`],
  ["hipaa", String.raw`\bHIPAA\b`],
  ["gdpr", String.raw`\bGDPR\b`],
  ["pdpl", String.raw`\bPDPL\b`],
  ["pdpl-ar", String.raw`نظام\s+حماية\s+البيانات\s+الشخصية`],
  ["nca", String.raw`\bNCA\b`],
  ["nca-ecc", String.raw`\bECC[\s-]*\d`],
  ["nca-ar", String.raw`الهيئة\s+الوطنية\s+للأمن\s+السيبراني`],
  ["sama-csf", String.raw`\bSAMA\b`],
  ["cst", String.raw`\bCST\b`],
  ["citc", String.raw`\bCITC\b`],
  ["nist", String.raw`\bNIST\b`],
  ["cis-benchmarks", String.raw`\bCIS\s+Benchmarks?\b`],
  ["fedramp", String.raw`\bFedRAMP\b`],
  ["csa-star", String.raw`\bCSA\s+STAR\b`],
  ["cyber-essentials", String.raw`\bCyber\s+Essentials\b`],
  ["owasp-asvs", String.raw`\bOWASP\s+ASVS\b`],
  ["wcag", String.raw`\bWCAG\b`],
  ["mobily-brand", String.raw`\bMobily\s+brand\s+guidelines?\b`],
  ["mobily-brand-ar", String.raw`(?:الهوية\s+البصرية|دليل\s+(?:الهوية|العلامة)(?:\s+التجارية)?)\s+ل?موبايلي`],
]);

/** K4: certification adjectives (English: directly before a product noun). */
export const CERTIFIED_ADJECTIVES = Object.freeze([
  "certified",
  "accredited",
  "compliant",
  "conformant",
  "endorsed",
  "attested",
]);
/** K4: Arabic certification adjectives (directly after a product noun). */
export const CERTIFIED_ADJECTIVES_AR = Object.freeze(["معتمد", "معتمدة", "مُعتمد", "مُعتمدة", "مرخص", "مرخصة"]);
/** K4: product nouns. */
export const PRODUCT_NOUNS = Object.freeze(["product", "platform", "solution", "software", "system", "application", "tool"]);
export const PRODUCT_NOUNS_AR = Object.freeze(["منتج", "منصة", "حل", "برنامج", "برمجية", "نظام", "تطبيق", "أداة"]);

/**
 * Negation tokens (ADR-0063 §3.2): those of PMI_NEGATION_PATTERN plus does not, do not, cannot, makes no, is not,
 * are not, لم, لن. Multi-word forms reduce to their last word ("not", "no"); contractions are listed whole.
 */
export const NEGATIONS = Object.freeze([
  "not",
  "never",
  "no",
  "nor",
  "without",
  "isn't",
  "aren't",
  "doesn't",
  "don't",
  "cannot",
  "can't",
  "won't",
  "ليس",
  "ليست",
  "لا",
  "غير",
  "دون",
  "لم",
  "لن",
]);
/** Words between a negation and the first word of the hit (ADR-0063 §3.2). */
export const NEGATION_WINDOW = 6;

const AR_DIACRITICS = /[ً-ٰٟـ]/g;
const AR_PREFIXES = ["وبال", "وال", "فال", "بال", "كال", "لل", "ال", "و", "ف", "ب"];

/** Lower-case, strip surrounding punctuation and Arabic diacritics/tatweel; keeps inner apostrophes, %, - and /. */
export function normalizeWord(word) {
  return word
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(AR_DIACRITICS, "")
    .replace(/^[^\p{L}\p{N}%]+|[^\p{L}\p{N}%]+$/gu, "");
}

/** The word itself and its forms without one Arabic leading conjunction or article. */
export function arabicVariants(word) {
  const out = [word];
  for (const p of AR_PREFIXES) if (word.startsWith(p) && word.length - p.length >= 2) out.push(word.slice(p.length));
  return out;
}

/** True when the normalized word is in `list` (with the Arabic prefix variants). */
export function inList(word, list) {
  return arabicVariants(word).some((w) => list.includes(w));
}

/** Splits text into words with their offsets. */
export function words(text) {
  const out = [];
  for (const m of text.matchAll(/\S+/g)) {
    const norm = normalizeWord(m[0]);
    if (norm !== "") out.push({ raw: m[0], norm, index: m.index });
  }
  return out;
}

/**
 * Sentence splitter (ADR-0063 §3.2): `.`, `!`, `?`, `؟`, `؛` followed by a space or the end, and a newline. Callers
 * split table cells and JSON string values before. A dot inside a token (`v1.0`, `ADR-0063.md`) does not split.
 * Returns [{ text, offset }].
 */
export function sentences(text) {
  const out = [];
  let start = 0;
  const push = (end) => {
    const s = text.slice(start, end);
    if (s.trim() !== "") out.push({ text: s.trim(), offset: start + (s.length - s.trimStart().length) });
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n" || c === "؟" || c === "؛" || ((c === "." || c === "!" || c === "?") && /\s|$/.test(text[i + 1] ?? ""))) {
      push(i + (c === "\n" ? 0 : 1));
      start = i + 1;
    }
  }
  push(text.length);
  return out;
}

/**
 * String literals of a TypeScript/JavaScript source (ADR-0063 §3.1 group U): `'…'`, `"…"` and the text parts of
 * template literals. Comments are skipped; a regular-expression literal is skipped by a heuristic (a `/` where an
 * operand is expected). Returns [{ value, line }] with the 1-based line of the literal's start.
 */
export function stringLiteralsTs(src) {
  const out = [];
  let i = 0;
  let line = 1;
  let prevSignificant = "";
  const n = src.length;
  const readQuoted = (q) => {
    const startLine = line;
    let v = "";
    i++;
    while (i < n && src[i] !== q) {
      if (src[i] === "\\" && i + 1 < n) {
        const e = src[i + 1];
        v += e === "n" ? "\n" : e === "t" ? "\t" : e;
        if (e === "\n") line++;
        i += 2;
        continue;
      }
      if (src[i] === "\n") {
        if (q !== "`") break; // unterminated string: stop at the line end
        line++;
      }
      if (q === "`" && src[i] === "$" && src[i + 1] === "{") {
        // template substitution: skip balanced braces (nested literals inside are ignored)
        let depth = 1;
        i += 2;
        v += " ";
        while (i < n && depth > 0) {
          if (src[i] === "{") depth++;
          else if (src[i] === "}") depth--;
          else if (src[i] === "\n") line++;
          i++;
        }
        continue;
      }
      v += src[i];
      i++;
    }
    i++;
    out.push({ value: v, line: startLine });
  };
  while (i < n) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      i += 2;
      continue;
    }
    if (c === "/" && (prevSignificant === "" || "(,=:[!&|?{};+-*%<>~^".includes(prevSignificant))) {
      // regular-expression literal
      i++;
      let inClass = false;
      while (i < n && src[i] !== "\n") {
        if (src[i] === "\\") i += 2;
        else if (src[i] === "[") (inClass = true), i++;
        else if (src[i] === "]") (inClass = false), i++;
        else if (src[i] === "/" && !inClass) break;
        else i++;
      }
      i++;
      prevSignificant = "x";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      readQuoted(c);
      prevSignificant = "x";
      continue;
    }
    if (!/\s/.test(c)) prevSignificant = /[\w$)\]]/.test(c) ? "x" : c;
    i++;
  }
  return out;
}

/**
 * String literals of SQL (`'…'` with `''` escapes, E'…' included); `--` and block comments are skipped, and so are the
 * format strings and arguments of `RAISE` statements (error messages of PL/pgSQL guards, not seeded texts; the API maps
 * them to its own problem texts, which are scanned). Returns [{ value, line }].
 */
export function stringLiteralsSql(src) {
  const out = [];
  let i = 0;
  let line = 1;
  const n = src.length;
  let inRaise = false;
  while (i < n) {
    const c = src[i];
    if (/[A-Za-z_]/.test(c) && !/[A-Za-z0-9_]/.test(src[i - 1] ?? "")) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i, i + 64));
      if (m[0].toUpperCase() === "RAISE") inRaise = true;
      i += m[0].length;
      continue;
    }
    if (c === ";") inRaise = false;
    if (c === "\n") {
      line++;
      i++;
    } else if (c === "-" && src[i + 1] === "-") {
      while (i < n && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      i += 2;
    } else if (c === "'") {
      const startLine = line;
      let v = "";
      i++;
      while (i < n) {
        if (src[i] === "'" && src[i + 1] === "'") {
          v += "'";
          i += 2;
        } else if (src[i] === "'") break;
        else {
          if (src[i] === "\n") line++;
          v += src[i++];
        }
      }
      i++;
      if (!inRaise) out.push({ value: v, line: startLine });
    } else i++;
  }
  return out;
}
