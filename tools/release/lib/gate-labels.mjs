// Gate-system separation rules L1–L5 (ADR-0073 §6; REQ-DLV-041 "no DG record is confused with G1-G6", REQ-S20-028
// "keep these records distinct from product gates G1–G6"). Node 24 built-ins only; no I/O in this module.
//
// L1, L2 and L5 are field checks. L3 and L4 are text heuristics over texts the delivery controls (gate records, the
// envelope README, the final report). Review records are free-form narratives and are deliberately not text-scanned
// (ADR-0073 §6, Residual 3).

/** The rehearsal record's fixed `notes` prefix (p7-work-split §M.2), exact. */
export const SYNTHETIC_NOTES_PREFIX =
  "SYNTHETIC REHEARSAL RECORD: not a gate decision. Written by the DG7 seal rehearsal in a scratch clone; it approves nothing.";

export const RULES = Object.freeze({
  L1: "each gates/DGn.json: file name DG<n>.json (n 0–7), stage_id DG<n>, previous_gate DG<n-1> (null for DG0), decision APPROVED, decided_by release-auditor",
  L2: "gate records and ENVELOPE-MANIFEST.json: no key or whole string value equal to G1–G6, no key naming a product or business gate",
  L3: "gate records' string values, the envelope README and the final report: a sentence naming both a DG and a G gate states their separation",
  L4: "gate records' string values and the final report: a sentence pairing business, Finance, IT, production or sponsor with approval is negated",
  L5: "the payload archive's demo-data/tables/*.ndjson: gate_code values are G1–G6, and no value of a gate_ table is DG0–DG7",
});

export const PRODUCT_GATE_VALUE = /^G[1-6]$/;
export const PRODUCT_GATE_KEY = /(product|business)[ _-]?gate/i;
export const DG_TERM = /\bDG[0-7]\b/;
export const G_TERM = /(?<![A-Za-z0-9-])G[1-6]\b/;
export const SEPARATION_PHRASES = Object.freeze([
  "does not imply",
  "never implies",
  "never imply",
  "not imply",
  "neither implies",
  "distinct from",
  "separate from",
  "not a product gate",
  "not an engineering gate",
]);
export const APPROVAL_CLAIM = /\b(business|finance|it|production|sponsor)\b[^.\n]{0,30}\bapprov(al|als|ed|es|e)\b/i;
export const NEGATIONS = Object.freeze(["no", "not", "never", "neither", "nor", "without"]);
const NEGATION_WORD = new RegExp(`\\b(${NEGATIONS.join("|")})\\b`, "i");
const DG_VALUE = /^DG[0-7]$/;

/** Splits a text into sentences on ". ", "; " and line breaks (ADR-0073 §6 L3). */
export function sentences(text) {
  return String(text)
    .split(/\. |; |\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** L3 on one text: [{ sentence }] for each sentence that names a DG and a G gate without a separation phrase. */
export function l3Hits(text) {
  const out = [];
  for (const s of sentences(text)) {
    if (!DG_TERM.test(s) || !G_TERM.test(s)) continue;
    const lower = s.toLowerCase();
    if (SEPARATION_PHRASES.some((p) => lower.includes(p))) continue;
    out.push({ sentence: s });
  }
  return out;
}

/** L4 on one text: [{ sentence }] for each sentence that pairs an approver with approval and has no negation word. */
export function l4Hits(text) {
  const out = [];
  for (const s of sentences(text)) {
    if (APPROVAL_CLAIM.test(s) && !NEGATION_WORD.test(s)) out.push({ sentence: s });
  }
  return out;
}

/** Every string value of a JSON value, with its JSON path. */
function* stringValues(value, path = "$") {
  if (typeof value === "string") yield { path, value };
  else if (Array.isArray(value)) for (let k = 0; k < value.length; k++) yield* stringValues(value[k], `${path}[${k}]`);
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) yield* stringValues(v, `${path}.${k}`);
}

/** Every key of a JSON value, with its JSON path. */
function* keysOf(value, path = "$") {
  if (Array.isArray(value)) for (let k = 0; k < value.length; k++) yield* keysOf(value[k], `${path}[${k}]`);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      yield { path: `${path}.${k}`, key: k };
      yield* keysOf(v, `${path}.${k}`);
    }
}

/** L2 over one JSON document. */
function l2(doc, where, hits) {
  for (const { path, key } of keysOf(doc)) {
    if (PRODUCT_GATE_VALUE.test(key)) hits.push({ rule: "L2", where, detail: `key ${path} is a product gate code` });
    else if (PRODUCT_GATE_KEY.test(key)) hits.push({ rule: "L2", where, detail: `key ${path} names a product or business gate` });
  }
  for (const { path, value } of stringValues(doc))
    if (PRODUCT_GATE_VALUE.test(value)) hits.push({ rule: "L2", where, detail: `value ${path} is the product gate code ${value}` });
}

/**
 * The text a gate record's string value contributes to L3/L4. The exact synthetic marker sentence of the rehearsal
 * record is removed when it is the value's prefix (it is the ADR's own fixed text, and its last clause, "it approves
 * nothing", would otherwise meet the L4 pattern without a listed negation word); anything after it is still checked.
 */
export function gateTextOf(value) {
  return value.startsWith(SYNTHETIC_NOTES_PREFIX) ? value.slice(SYNTHETIC_NOTES_PREFIX.length) : value;
}

/**
 * Applies L1–L5.
 * @param {{ gates?: { path: string, record: any }[], manifest?: any, texts?: { label: string, text: string, rules?: string[] }[],
 *           demoTables?: { table: string, rows: any[] }[] }} input
 *   `texts` entries default to rules ["L3", "L4"]; the envelope README is passed with ["L3"] (ADR-0073 §6 scope).
 * @returns {{ ok: boolean, hits: { rule: string, where: string, detail: string }[] }}
 */
export function checkGateLabels({ gates = [], manifest = null, texts = [], demoTables = [] } = {}) {
  const hits = [];
  for (const { path, record } of gates) {
    const m = /(?:^|\/)DG([0-7])\.json$/.exec(path);
    if (!m) {
      hits.push({ rule: "L1", where: path, detail: "file name is not DG<n>.json for n 0–7" });
    } else {
      const n = Number(m[1]);
      const r = record ?? {};
      if (r.stage_id !== `DG${n}`) hits.push({ rule: "L1", where: path, detail: `stage_id is ${JSON.stringify(r.stage_id)}, not DG${n}` });
      const prev = n === 0 ? null : `DG${n - 1}`;
      if (r.previous_gate !== prev)
        hits.push({ rule: "L1", where: path, detail: `previous_gate is ${JSON.stringify(r.previous_gate)}, not ${JSON.stringify(prev)}` });
      if (r.decision !== "APPROVED") hits.push({ rule: "L1", where: path, detail: `decision is ${JSON.stringify(r.decision)}, not APPROVED` });
      if (r.decided_by !== "release-auditor")
        hits.push({ rule: "L1", where: path, detail: `decided_by is ${JSON.stringify(r.decided_by)}, not release-auditor` });
    }
    l2(record, path, hits);
    for (const { path: jp, value } of stringValues(record)) {
      const text = gateTextOf(value);
      for (const h of l3Hits(text)) hits.push({ rule: "L3", where: `${path} ${jp}`, detail: h.sentence });
      for (const h of l4Hits(text)) hits.push({ rule: "L4", where: `${path} ${jp}`, detail: h.sentence });
    }
  }
  if (manifest !== null && manifest !== undefined) l2(manifest, "ENVELOPE-MANIFEST.json", hits);
  for (const { label, text, rules = ["L3", "L4"] } of texts) {
    if (rules.includes("L3")) for (const h of l3Hits(text)) hits.push({ rule: "L3", where: label, detail: h.sentence });
    if (rules.includes("L4")) for (const h of l4Hits(text)) hits.push({ rule: "L4", where: label, detail: h.sentence });
  }
  for (const { table, rows } of demoTables) {
    rows.forEach((row, k) => {
      if (!row || typeof row !== "object") return;
      if ("gate_code" in row && !(typeof row.gate_code === "string" && PRODUCT_GATE_VALUE.test(row.gate_code)))
        hits.push({ rule: "L5", where: `${table} row ${k + 1}`, detail: `gate_code ${JSON.stringify(row.gate_code)} is not G1–G6` });
      if (table.startsWith("gate_"))
        for (const { path, value } of stringValues(row))
          if (DG_VALUE.test(value)) hits.push({ rule: "L5", where: `${table} row ${k + 1}`, detail: `${path} is the engineering gate code ${value}` });
    });
  }
  return { ok: hits.length === 0, hits };
}

/** Parses NDJSON table text into rows (blank lines skipped). Throws on a line that is not JSON. */
export function parseNdjson(text) {
  return String(text)
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
}
