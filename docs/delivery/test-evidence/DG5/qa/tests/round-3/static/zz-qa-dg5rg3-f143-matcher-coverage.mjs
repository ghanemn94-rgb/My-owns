// qa-verifier DG5 clean re-gate round 3 (T-DG5-RG-QA-R3): static coverage probe of the F-DG5-143 repair.
// The repaired auditor test (apps/web/e2e/p3-prioritization-roadmap.spec.ts) asserts, on the prioritization, roadmap and
// dependencies screens, (a) no button whose label is one of six named write labels, and (b) no button whose accessible
// name matches APPROVE_OR_MOVE (whole-word approve|move|اعتماد|نقل). F-DG5-143 replaced the old substring matcher
// /approve|اعتماد|move|نقل/i. This probe answers, from the frozen sources:
//  Q1 is the new matcher weaker than the old one on any label the three screens can render as a BUTTON? For every
//     i18n key passed to t() in the screens' .tsx files (the button-label candidates), in en and ar, it compares the
//     old and the new matcher. A key that the OLD matcher caught and the NEW one does not is a weakening unless it is a
//     read-only label (the F-DG5-143 false positive). Every such key is printed with its text.
//  Q2 which write-verb BUTTON labels (approve, move, decide, revoke, withdraw, propose, archive, save, add, ...) the test's two
//     assertions do not cover at all (neither the six named labels nor the matcher). These are observations about the
//     breadth of the pre-existing test, not part of F-DG5-143.
// Usage: node zz-qa-dg5rg3-f143-matcher-coverage.mjs <clone root>. Exit 0 = report written; exit 1 = Q1 weakening
// found on a button label (a label the old matcher caught and the new one does not).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2];
const OLD = /approve|اعتماد|move|نقل/i;
const NEW = /(?<![\p{L}\p{M}])(?:approve|move|اعتماد|نقل)(?![\p{L}\p{M}])/iu;
const NAMED = [
  "prioritization.weights.propose",
  "prioritization.overrides.propose",
  "prioritization.rankings.create",
  "prioritization.scorecard.save",
  "dependencies.map.add",
  "roadmap.milestones.moveConfirm",
];
const WRITE_VERB = /(approve|move|decide|revoke|withdraw|propose|archive|save|add|create|edit|delete|submit|confirm|record|reject|retire)/i;

function flat(d, p = "") {
  const out = {};
  for (const [k, v] of Object.entries(d)) {
    if (v && typeof v === "object") Object.assign(out, flat(v, p + k + "."));
    else out[p + k] = v;
  }
  return out;
}
const cat = {};
for (const lang of ["en", "ar"]) {
  cat[lang] = {};
  const dir = join(root, "apps/web/src/i18n", lang);
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const ns = f.replace(/\.json$/, "");
    const d = flat(JSON.parse(readFileSync(join(dir, f), "utf8")));
    for (const [k, v] of Object.entries(d)) cat[lang][`${ns}.${k}`] = v;
  }
}
const fill = (s) => String(s).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, v) => (v === "n" ? "2" : "Synthetic"));
const files = [];
for (const sub of ["prioritization", "roadmap", "dependencies"]) {
  const d = join(root, "apps/web/src/pages", sub);
  for (const f of readdirSync(d)) if (f.endsWith(".tsx") && !f.includes(".test.") && !f.includes("fixtures")) files.push(join(d, f));
}
// Context of each literal t("key"): the innermost JSX element still open at that position (a light tag scanner:
// <Tag ...> pushes, </Tag> pops, <Tag .../> is ignored), or the JSX prop it is passed to (label=, aria-label=, title=).
// A key counts as a BUTTON label when that element is <button>/<Button*> or a component whose name says it renders a
// button (Sort*, *Action*, *Button*), or when it is passed as label=/aria-label= to such a component.
const keys = new Set();
const buttonKeys = new Set();
const BUTTONISH = /^(button|[A-Z]\w*(Button|Sort|Action)\w*|Sort\w*)$/;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\bt\(\s*"([a-zA-Z0-9_.]+)"/g)) {
    keys.add(m[1]);
    const before = src.slice(0, m.index);
    const stack = [];
    for (const tm of before.matchAll(/<(\/?)([A-Za-z][\w.]*)([^<>]*?)(\/?)>/g)) {
      if (tm[1]) { const i = stack.lastIndexOf(tm[2]); if (i >= 0) stack.length = i; }
      else if (!tm[4]) stack.push(tm[2]);
    }
    // an unterminated opening tag right before (t() inside its props)
    const open = /<([A-Za-z][\w.]*)(?![^<>]*>)[^<>]*$/.exec(before);
    const ctx = open ? open[1] : stack[stack.length - 1];
    if (ctx && BUTTONISH.test(ctx)) buttonKeys.add(m[1]);
    else if (stack.some((x) => x === "button")) buttonKeys.add(m[1]);
  }
}
console.log(`keys in a button context: ${[...buttonKeys].sort().join(", ")}`);
let weakening = 0;
const uncovered = [];
console.log(`files scanned: ${files.length}; distinct literal t() keys: ${keys.size}`);
for (const k of [...keys].sort()) {
  for (const lang of ["en", "ar"]) {
    const s = cat[lang][k];
    if (typeof s !== "string") continue;
    const text = fill(s);
    const o = OLD.test(text), n = NEW.test(text);
    if (o && !n) {
      const btn = buttonKeys.has(k);
      // A button label in NAMED is still caught by assertion (a); a dialog's own submit (dependencies.form.save) can
      // only render after its opener, so it is reported but counted as a weakening only if its opener is uncovered.
      const opener = { "dependencies.form.save": "dependencies.map.add" }[k];
      const covered = NAMED.includes(k) || (opener && NAMED.includes(opener));
      if (btn && !covered) weakening++;
      console.log(`Q1 old-only ${btn ? (covered ? `button label, still covered (${NAMED.includes(k) ? "named in assertion (a)" : `dialog submit; its opener ${opener} is named in assertion (a)`})` : "WEAKENING (button label)") : "(not a button label: text, header, body or hint)"} [${lang}] ${k}: ${text.slice(0, 90)}`);
    }
    if (lang === "en" && buttonKeys.has(k) && WRITE_VERB.test(k.split(".").pop()) && !n && !NAMED.includes(k))
      uncovered.push(`${k} = "${text.slice(0, 60)}" / ar "${fill(cat.ar[k] ?? "").slice(0, 60)}"`);
  }
}
console.log(`Q1 weakenings on button labels: ${weakening}`);
console.log(`Q2 write-verb keys covered by neither assertion (observation; ${uncovered.length}):`);
for (const u of uncovered) console.log(`  ${u}`);
process.exit(weakening ? 1 : 0);
