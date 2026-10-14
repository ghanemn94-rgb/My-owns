// Generates packages/db/migrations/0092_p5_playbook_blocks.sql (T-DG5-BE-Q; ADR-0049 §1, §4; p5-work-split §I.1).
// Run from the repository root:  node docs/delivery/handbacks/DG5/T-DG5-BE-Q-evidence/generate-0092.mjs
//
// Inputs (all read-only):
//  - docs/source/playbook.md               the 165 anchored blocks; text_en is taken VERBATIM (parse-playbook.mjs);
//  - docx-headings.txt (this folder)        the heading level of each body block, dumped from the paragraph styles of
//                                           docs/source/Business_Transformation_Playbook.docx by docx-headings.py
//                                           (bold kicker sz 16 = level 1, bold title sz 46/68 = level 2, bold sub-
//                                           heading sz 28 = level 3; every other paragraph or table is body);
//  - translations-ar-{1,2,3}.mjs            PROVISIONAL Arabic (ar_provisional = true);
//  - docs/delivery/requirements.csv         the register: a block links to every requirement whose source_ref cites it.
// Derivations:
//  - section_block_ref: for a heading of level L the nearest earlier heading of a lower level; for a body block the
//    nearest earlier heading; null when there is none.
//  - phase_code: Diagnose B0025-B0043, Define B0044-B0051, Design B0052-B0065, Mobilize B0066-B0088, Transform
//    B0089-B0116, Realize B0117-B0131 (each boundary is a "PHASE n" kicker, or "LAUNCH PLAN" after Realize; asserted).
//  - template links: each "Template N — …" heading and the table block right after it -> TNN (asserted: 16 x 2).
//  - procedure links: PROCEDURE_BLOCKS below (an engineering default; ADR-0042 §5 names the procedures, the playbook
//    does not name them, so each one links to the block whose practice it executes).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parsePlaybook } from "./parse-playbook.mjs";
import { AR_1 } from "./translations-ar-1.mjs";
import { AR_2 } from "./translations-ar-2.mjs";
import { AR_3 } from "./translations-ar-3.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const AR = { ...AR_1, ...AR_2, ...AR_3 };
const blocks = parsePlaybook("docs/source/playbook.md");
if (blocks.length !== 165) throw new Error(`expected 165 blocks, got ${blocks.length}`);

// ---------------------------------------------------------------- headings (from the docx styles)
const levels = new Map();
for (const line of readFileSync(join(here, "docx-headings.txt"), "utf8").split("\n")) {
  const m = /^(B0\d{3}) (table|body|h1|h2|h3)\b/.exec(line);
  if (m) levels.set(m[1], m[2]);
}
if (levels.size !== 165) throw new Error(`docx-headings.txt lists ${levels.size} blocks`);
const level = (ref) => ({ h1: 1, h2: 2, h3: 3 })[levels.get(ref)] ?? null;
for (const b of blocks) if ((levels.get(b.ref) === "table") !== (b.kind === "table")) throw new Error(`kind ${b.ref}`);

// ---------------------------------------------------------------- phases
const PHASES = [
  ["diagnose", 25, 43],
  ["define", 44, 51],
  ["design", 52, 65],
  ["mobilize", 66, 88],
  ["transform", 89, 116],
  ["realize", 117, 131],
];
const n = (ref) => Number(ref.slice(1));
const textOf = (num) => blocks[num - 1].text;
PHASES.forEach(([, from, to], i) => {
  if (textOf(from) !== `PHASE ${i + 1}`) throw new Error(`phase boundary B${from}`);
  const next = textOf(to + 1);
  if (!(next === `PHASE ${i + 2}` || (i === 5 && next === "LAUNCH PLAN"))) throw new Error(`phase end B${to}`);
});
const phaseOf = (ref) => PHASES.find(([, f, t]) => n(ref) >= f && n(ref) <= t)?.[0] ?? null;

// ---------------------------------------------------------------- sections
const section = new Map();
const open = [];
for (const b of blocks) {
  const L = level(b.ref);
  if (L === null) {
    section.set(b.ref, open.length ? open[open.length - 1].ref : null);
    continue;
  }
  while (open.length && open[open.length - 1].level >= L) open.pop();
  section.set(b.ref, open.length ? open[open.length - 1].ref : null);
  open.push({ ref: b.ref, level: L });
}

// ---------------------------------------------------------------- links
const links = new Map(blocks.map((b) => [b.ref, []]));
let templates = 0;
blocks.forEach((b, i) => {
  const m = /^Template (\d+) — /.exec(b.text);
  if (!m || level(b.ref) === null) return;
  const code = `T${m[1].padStart(2, "0")}`;
  const table = blocks[i + 1];
  if (table.kind !== "table") throw new Error(`${b.ref}: no table after the template heading`);
  links.get(b.ref).push(["template", code]);
  links.get(table.ref).push(["template", code]);
  templates += 1;
});
if (templates !== 16) throw new Error(`expected 16 template headings, got ${templates}`);

// The ten seeded procedures (ADR-0042 §5, 0069) -> the blocks whose practice each executes.
const PROCEDURE_BLOCKS = {
  new_transformation_intake: ["B0035"], // Transformation Charter: sponsor, lead, case for change
  baseline_validation: ["B0084"], // "Finance should validate the baseline and benefit logic early"
  kpi_submission: ["B0050"], // Template 2: KPI baseline, target, owner
  tom_approval: ["B0062", "B0063"], // the TOM canvas and its use
  initiative_prioritization: ["B0076", "B0077"], // Template 6 scorecard and its weights
  gate_review: ["B0023"], // the stage gates G1-G6: decision question and evidence required
  scope_target_change: ["B0099"], // Template 11: "Business scope change"
  benefit_validation: ["B0121"], // the benefits lifecycle: measure, correct
  executive_escalation: ["B0102", "B0131"], // governance rule and escalation principle
  bau_handover: ["B0119"], // "transfer ownership to BAU"
};
for (const [code, refs] of Object.entries(PROCEDURE_BLOCKS))
  for (const r of refs) links.get(r).push(["procedure", code]);

function parseCsv(s) {
  const rows = [];
  let row = [];
  let f = "";
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          f += '"';
          i++;
        } else q = false;
      } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      row.push(f);
      f = "";
    } else if (c === "\n") {
      row.push(f);
      rows.push(row);
      row = [];
      f = "";
    } else if (c !== "\r") f += c;
  }
  if (f || row.length) rows.push([...row, f]);
  return rows;
}
const csv = parseCsv(readFileSync("docs/delivery/requirements.csv", "utf8"));
const head = csv[0];
const reqCol = head.indexOf("req_id");
const srcCol = head.indexOf("source_ref");
const reqByBlock = new Map();
for (const r of csv.slice(1)) {
  const id = r[reqCol];
  if (!/^REQ-[A-Z0-9]+-[0-9]{3}$/.test(id ?? "")) continue;
  for (const ref of (r[srcCol] ?? "").split(/[;,\s]+/)) {
    if (!/^B0\d{3}$/.test(ref) || n(ref) < 1 || n(ref) > 165) continue;
    const set = reqByBlock.get(ref) ?? new Set();
    set.add(id);
    reqByBlock.set(ref, set);
  }
}
for (const [ref, ids] of reqByBlock) for (const id of [...ids].sort()) links.get(ref).push(["requirement", id]);

// ---------------------------------------------------------------- SQL
const q = (s) => `'${s.replaceAll("'", "''")}'`;
const nul = (s) => (s === null ? "NULL" : q(s));
for (const b of blocks) {
  if (typeof AR[b.ref] !== "string" || AR[b.ref].trim() === "") throw new Error(`no Arabic for ${b.ref}`);
  if (b.kind === "table" && AR[b.ref].split("\n").length !== b.text.split("\n").length)
    throw new Error(`${b.ref}: the Arabic table has a different number of rows`);
}
const blockRows = blocks.map(
  (b) =>
    `  (${q(b.ref)}, ${n(b.ref)}, ${q(b.kind)}, ${level(b.ref) !== null}, ${nul(section.get(b.ref))}, ${nul(phaseOf(b.ref))},\n   ${q(b.text)},\n   ${q(AR[b.ref])}, true)`,
);
const linkRows = [];
for (const b of blocks) {
  const l = links.get(b.ref);
  if (l.length > 99) throw new Error(`${b.ref}: more than 99 links`);
  l.forEach(([kind, key], i) => linkRows.push(`  (${q(b.ref)}, ${q(kind)}, ${q(key)}, ${i + 1})`));
}
const counts = { template: 0, procedure: 0, requirement: 0 };
for (const l of links.values()) for (const [k] of l) counts[k] += 1;

const sql = `-- 0092 P5 slice I: the 165 verbatim playbook blocks and their seeded links (T-DG5-BE-Q; ADR-0049 §1, §4;
-- REQ-S02-004, REQ-S03-010). Authored by backend-workflow-engineer. GENERATED by
-- docs/delivery/handbacks/DG5/T-DG5-BE-Q-evidence/generate-0092.mjs; never edit by hand, and never edit once merged
-- (forward-only). Runs as mth_owner inside one transaction opened by \`mth-db migrate\`.
--
-- playbook_block: text_en is VERBATIM docs/source/playbook.md at each anchor (the anchor comment and the one space
-- before it are not part of the text; a table block is the source's Markdown rows). The test
-- apps/api/test/integration/methodology/playbook-blocks.test.ts compares all 165 texts with the source file.
-- text_ar is a PROVISIONAL translation drafted by an engineering agent (ar_provisional = true); a Mobily Arabic editor
-- must review it. is_heading follows the docx paragraph styles (bold kicker, title and sub-heading);
-- section_block_ref is the heading a block sits under; phase_code follows the six phase sections (Diagnose
-- B0025-B0043, Define B0044-B0051, Design B0052-B0065, Mobilize B0066-B0088, Transform B0089-B0116, Realize
-- B0117-B0131) and is null elsewhere.
--
-- playbook_block_link (${linkRows.length} rows: ${counts.template} template, ${counts.procedure} procedure, ${counts.requirement} requirement):
--  - each "Template N" heading and its table block -> TNN (T01: B0030, B0031; ...; T16: B0129, B0130);
--  - the ten seeded procedures of ADR-0042 §5 -> the blocks whose practice each executes (an engineering default,
--    because the playbook does not name the procedures):
${Object.entries(PROCEDURE_BLOCKS)
  .map(([c, r]) => `--      ${c}: ${r.join(", ")}`)
  .join("\n")}
--  - each block -> every requirement ID of docs/delivery/requirements.csv whose source_ref cites it (the register as
--    of this migration; later register rows are linked through Studio, linksAdded).
-- Versions never change these rows: a methodology version adds or removes links through its 'block.<Bxxxx>' element.
-- Nothing here grants or records a business approval, and nothing reads or writes the engineering gates.

INSERT INTO playbook_block (block_ref, ordinal, block_kind, is_heading, section_block_ref, phase_code, text_en, text_ar,
                            ar_provisional) VALUES
${blockRows.join(",\n")};

INSERT INTO playbook_block_link (block_ref, target_kind, target_key, ordinal) VALUES
${linkRows.join(",\n")};
`;
writeFileSync("packages/db/migrations/0092_p5_playbook_blocks.sql", sql);
console.log(
  `0092 written: ${blocks.length} blocks (${blocks.filter((b) => level(b.ref) !== null).length} headings), ${linkRows.length} links`,
  counts,
);
