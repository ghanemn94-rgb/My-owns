#!/usr/bin/env node
// deploy/scripts/drill/config-trace.mjs: step D3 of the transfer drill (ADR-0069 §4; p7-work-split §B.2; T-DG7-DO-D).
// REQ-S19-009 "a clean deployment configured only from the template and guides starts successfully".
//
//   node deploy/scripts/drill/config-trace.mjs --template <.env.example> --guide <deployment.md> --map <guide-keys.json>
//        --values <values.json> --out-env <file> --out-trace <config-trace.json>
//
// <values.json> is what the drill needs to set on the target: { "<KEY>": { "value": "<text>" } } for a plain value, or
// { "<KEY>": { "file": "<path>" } } for a secret, which is written as <KEY>_FILE=<path> (the template's NAME_FILE rule)
// and whose value never appears in the trace. Each key must be a key of the template, must be in the map, and the
// map's section anchor must exist in the guide. Otherwise the key is an UNDOCUMENTED STEP and the trace fails.
//
// The env file starts from the template (every key, empty) and fills only the given keys. The trace lists every filled
// key with the guide section that tells IT to set it: { schemaVersion, template, guide, entries: [{ key, form, section,
// value? }], problems: [] }.
//
// Exit codes (p7-work-split §2 rule 4): 0 PASS, 1 FAIL (an undocumented step), 2 BLOCKED (usage or unreadable input).
// Writes only the two output files. Node 24 built-ins only. Every value it handles in the drill is synthetic.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const UNDOCUMENTED = (key) =>
  `transfer-drill: undocumented step: the target needs ${key}, which no section of docs/handover/deployment.md names`;

/** The keys of an env template: `KEY=` lines, commented `# KEY=` lines included. */
export function templateKeys(text) {
  const out = new Set();
  for (const m of text.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]*)=/gm)) out.add(m[1]);
  return out;
}

/** The section anchors of a Markdown guide: explicit `{#id}` and `<a id="id">`, and slugs of the headings. */
export function guideAnchors(markdown) {
  const out = new Set();
  for (const line of markdown.split("\n")) {
    const m = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    for (const a of m[1].matchAll(/\{#([A-Za-z0-9_-]+)\}/g)) out.add(a[1]);
    out.add(
      m[1]
        .replace(/\{#[^}]*\}|<[^>]*>/g, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s_-]/gu, "")
        .trim()
        .replace(/\s/g, "-"),
    );
  }
  for (const a of markdown.matchAll(/<a\s+(?:id|name)="([A-Za-z0-9_-]+)"/g)) out.add(a[1]);
  return out;
}

/** `docs/handover/deployment.md#x`, `deployment.md#x` or `x` -> `x`. */
export const anchorOf = (ref) => String(ref ?? "").replace(/^.*#/, "");

/**
 * The trace of a set of values against the template, the map and the guide. Pure: returns { entries, problems, env }.
 * `problems` holds the exact lines to print; an empty list is a pass.
 */
export function trace({ template, guide, map, values }) {
  const keys = templateKeys(template);
  const anchors = guideAnchors(guide);
  const mapped = map?.keys ?? {};
  const entries = [];
  const problems = [];
  const filled = new Map();
  for (const [key, spec] of Object.entries(values)) {
    const anchor = Object.hasOwn(mapped, key) ? anchorOf(mapped[key]) : "";
    if (!keys.has(key)) {
      problems.push(`transfer-drill: step D3 failed: ${key} is not a key of .env.example (not from the template)`);
      continue;
    }
    if (!anchor || !anchors.has(anchor)) {
      problems.push(UNDOCUMENTED(key));
      continue;
    }
    const isFile = typeof spec?.file === "string";
    if (!isFile && typeof spec?.value !== "string") {
      problems.push(`transfer-drill: step D3 failed: ${key} has neither a value nor a secret file`);
      continue;
    }
    entries.push({
      key,
      form: isFile ? "file" : "value",
      section: `docs/handover/deployment.md#${anchor}`,
      ...(isFile ? { setAs: `${key}_FILE` } : { value: spec.value }),
    });
    filled.set(key, isFile ? [`${key}_FILE`, spec.file] : [key, spec.value]);
  }
  // The env file: the template's non-comment keys in order, each empty unless filled (a file-form key is replaced by
  // its _FILE line, because setting both is refused at startup).
  const env = [];
  for (const line of template.split("\n")) {
    const m = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (!m) continue;
    const f = filled.get(m[1]);
    env.push(f ? `${f[0]}=${f[1]}` : `${m[1]}=`);
  }
  return { entries, problems, env: env.join("\n") + "\n" };
}

function main() {
  let v;
  try {
    ({ values: v } = parseArgs({
      args: process.argv.slice(2),
      options: Object.fromEntries(
        ["template", "guide", "map", "values", "out-env", "out-trace"].map((k) => [k, { type: "string" }]),
      ),
      strict: true,
    }));
  } catch {
    v = {};
  }
  const need = ["template", "guide", "map", "values", "out-env", "out-trace"];
  if (need.some((k) => !v[k])) {
    console.error(
      "BLOCKED: usage: config-trace.mjs --template <file> --guide <file> --map <file> --values <file> --out-env <file> --out-trace <file>",
    );
    process.exit(2);
  }
  let input;
  try {
    input = {
      template: readFileSync(v.template, "utf8"),
      guide: readFileSync(v.guide, "utf8"),
      map: JSON.parse(readFileSync(v.map, "utf8")),
      values: JSON.parse(readFileSync(v.values, "utf8")),
    };
  } catch (e) {
    console.error(`BLOCKED: config-trace: unreadable input: ${e.message}`);
    process.exit(2);
  }
  const r = trace(input);
  const doc = {
    schemaVersion: "mth-config-trace/1",
    template: ".env.example",
    guide: "docs/handover/deployment.md",
    note: "Every value is synthetic and generated for the drill; secrets are written to files and never shown here.",
    entries: r.entries,
    problems: r.problems,
    result: r.problems.length === 0 ? "PASS" : "FAIL",
  };
  writeFileSync(v["out-trace"], JSON.stringify(doc, null, 2) + "\n");
  writeFileSync(v["out-env"], r.env, { mode: 0o600 });
  for (const p of r.problems) console.error(p);
  console.log(`config-trace: ${r.entries.length} keys filled from the template, ${r.problems.length} problems`);
  process.exit(r.problems.length === 0 ? 0 : 1);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) main();
