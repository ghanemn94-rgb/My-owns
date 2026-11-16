// T-I11 and T-I13 (fixture half) of ADR-0071 §5 and §9 for tools/release/release-notes.mjs (p7-work-split §I.4, §M.1).
//   T-I11  the "Unfinished items and release blockers" section lists exactly the register rows that are not
//          IMPLEMENTED (set equality), on the fixture and on the tree's register; a non-IMPLEMENTED row with empty notes
//          exits 1; an IMPLEMENTED row without evidence exits 1; --check drift exits 1; no clock is read (two runs give
//          identical bytes); the dependency list absent gives the Unknown line, never "none".
//   T-I13  (fixture half) the six D-243 Q19 rows carry `completes-after-gate:` and appear in the later-clauses section.
//   DO-D10 the checked-in disclosure input (ADR-0064 A5.6, D-278) is printed in English and in the Arabic summary, with
//          its link; the D-278 points are present; a missing or invalid input exits 2 (BLOCKED) and writes nothing.
// Everything is written under $TMPDIR; nothing is written to the repository.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { parseRegister } from "../../../apps/api/scripts/register-snapshot.mjs";
import {
  buildReleaseNotes,
  countProvisional,
  DEFAULT_DISCLOSURES,
  DisclosureError,
  DISCLOSURES_FORMAT,
  laterClauseOf,
  main,
  MARKER,
  parseDisclosures,
  Q19_ROWS,
  TEXT,
} from "../release-notes.mjs";
import { HERE, REPO, runNode, tmp } from "./helpers.mjs";

const TOOL = join(HERE, "..", "release-notes.mjs");
const FIX = join(HERE, "fixtures", "seal", "release-notes");
const CSV = join(FIX, "register-SYNTHETIC.csv");
const DEPS = join(FIX, "external-dependencies-SYNTHETIC.json");
const I18N = join(FIX, "i18n");
const cleanup = [];
after(() => cleanup.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** Runs main() with its printed lines captured. */
function run(argv) {
  const lines = [];
  const code = main(argv, { print: (l) => lines.push(l) });
  return { code, lines };
}

/** The ids listed under "Unfinished items and release blockers" (### <id>: headings of that section). */
function unfinishedIds(text) {
  const start = text.indexOf(`## ${TEXT.unfinished[0]}\n`);
  const end = text.indexOf("\n## ", start + 3);
  return [...text.slice(start, end).matchAll(/^### (REQ-[A-Z0-9]+-\d{3}): /gm)].map((m) => m[1]);
}
const notImplemented = (bytes) =>
  parseRegister(bytes)
    .rows.filter((r) => r[16] !== "IMPLEMENTED")
    .map((r) => r[0]);

function fixtureArgs(dir, extra = []) {
  return ["--repo", dir, "--csv", CSV, "--deps", DEPS, "--provisional", I18N, "--out", join(dir, "release-notes.md"), ...extra];
}

test("T-I11 fixture: the unfinished section is exactly the non-IMPLEMENTED rows; notes are quoted verbatim", () => {
  const dir = tmp("rn-a");
  cleanup.push(dir);
  const r = run(fixtureArgs(dir, ["--write"]));
  assert.equal(r.code, 0, r.lines.join("\n"));
  assert.deepEqual(r.lines, [`release-notes: 3 unfinished item(s), 6 later clause(s); wrote release-notes.md`]); // shown relative to --repo
  const text = readFileSync(join(dir, "release-notes.md"), "utf8");
  assert.deepEqual(unfinishedIds(text).sort(), notImplemented(readFileSync(CSV)).sort());
  assert.deepEqual(unfinishedIds(text).sort(), ["REQ-PB-001", "REQ-S02-001", "REQ-S03-001"]);
  // multi-line notes keep every line (blockquoted), quotes and commas included
  assert.match(text, /^> SYNTHETIC missing dependency: the corporate IdP\.\n> Second line with "quotes", and a comma\.$/m);
  for (const h of Object.values(TEXT).filter(Array.isArray).slice(0, 6)) assert.ok(text.includes(`## ${h[0]}\n`), h[0]);
  assert.ok(text.includes(TEXT.notApproval[0]));
  assert.ok(text.includes('<div dir="rtl" lang="ar">') && text.includes(TEXT.provisionalMarker[0]) && text.includes(TEXT.provisionalMarker[1]));
  assert.match(text, /^\| `synthetic-idp` \| SYNTHETIC corporate identity provider \| Mobily IT \(SYNTHETIC\) \| not_verified \|$/m);
});

test("T-I11 tree: on the repository's register the unfinished set equals the rows that are not IMPLEMENTED", () => {
  const bytes = readFileSync(join(REPO, "docs", "delivery", "requirements.csv"));
  const built = buildReleaseNotes({ csvBytes: bytes, csvPath: "docs/delivery/requirements.csv", deps: null, provisional: [], identity: { api: null, contract: null } });
  const want = notImplemented(bytes);
  assert.deepEqual([...unfinishedIds(built.text)].sort(), [...want].sort());
  assert.equal(built.unfinished.length, want.length);
  // The refusal rule applies to the tree too: every non-IMPLEMENTED row with empty notes is named (reported, not fixed).
  const emptyNotes = parseRegister(bytes).rows.filter((r) => r[16] !== "IMPLEMENTED" && r[18].trim() === "");
  assert.equal(built.problems.length, emptyNotes.length + parseRegister(bytes).rows.filter((r) => r[16] === "IMPLEMENTED" && r[17].trim() === "").length);
});

test("T-I11 refusals: a non-IMPLEMENTED row with empty notes, and an IMPLEMENTED row without evidence, exit 1", () => {
  const dir = tmp("rn-b");
  cleanup.push(dir);
  const csv = readFileSync(CSV, "utf8")
    .replace("SYNTHETIC blocked on Mobily IT test credentials", "")
    .replace("apps/SYNTHETIC.ts", "");
  const bad = join(dir, "register.csv");
  writeFileSync(bad, csv);
  const r = run(["--repo", dir, "--csv", bad, "--provisional", I18N, "--out", join(dir, "notes.md")]);
  assert.equal(r.code, 1);
  assert.deepEqual(r.lines, [
    "release-notes: REQ-S01-001 is IMPLEMENTED without evidence",
    "release-notes: REQ-S03-001 is BLOCKED but names no missing dependency in notes",
  ]);
  assert.throws(() => readFileSync(join(dir, "notes.md")), /ENOENT/, "nothing is written on a refusal");
});

test("T-I11 --check: up to date exits 0; one changed byte of the output exits 1 with the §I.3 line", () => {
  const dir = tmp("rn-c");
  cleanup.push(dir);
  assert.equal(run(fixtureArgs(dir)).code, 0);
  const ok = run(fixtureArgs(dir, ["--check"]));
  assert.equal(ok.code, 0, ok.lines.join("\n"));
  const out = join(dir, "release-notes.md");
  writeFileSync(out, `${readFileSync(out, "utf8")} `);
  const drift = run(fixtureArgs(dir, ["--check"]));
  assert.equal(drift.code, 1);
  assert.deepEqual(drift.lines, ["release-notes: release-notes.md is out of date (run with --write)"]);
});

test("T-I11 no clock: two runs (and a run under another TZ and SOURCE_DATE_EPOCH) give identical bytes", () => {
  const a = tmp("rn-d");
  const b = tmp("rn-e");
  cleanup.push(a, b);
  assert.equal(runNode([TOOL, ...fixtureArgs(a)]).code, 0);
  const r = runNode([TOOL, ...fixtureArgs(b)], { env: { ...process.env, TZ: "Pacific/Kiritimati", SOURCE_DATE_EPOCH: "1", LC_ALL: "C.UTF-8" } });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.ok(readFileSync(join(a, "release-notes.md")).equals(readFileSync(join(b, "release-notes.md"))));
});

test("T-I11 dependencies: absent → the Unknown line (EN and AR), never an empty list; invalid → exit 1", () => {
  const dir = tmp("rn-f");
  cleanup.push(dir);
  const r = run(["--repo", dir, "--csv", CSV, "--deps", join(dir, "missing.json"), "--provisional", I18N, "--out", join(dir, "n.md")]);
  assert.equal(r.code, 0, r.lines.join("\n"));
  const text = readFileSync(join(dir, "n.md"), "utf8");
  assert.ok(text.includes(`## ${TEXT.deps[0]}\n\n${TEXT.unknown[0]}\n`));
  assert.ok(text.includes(TEXT.unknown[1]));
  assert.ok(!text.includes("names no external configuration dependency"));
  const bad = join(dir, "bad.json");
  writeFileSync(bad, JSON.stringify([{ key: "x", title: "SYNTHETIC", owner: "o", status: "approved" }]));
  const b = run(["--repo", dir, "--csv", CSV, "--deps", bad, "--provisional", I18N, "--out", join(dir, "n2.md")]);
  assert.equal(b.code, 1);
  assert.match(b.lines[0], /^release-notes: .*invalid dependency entry$/);
});

test("T-I11 usage: a missing register exits 2 (BLOCKED)", () => {
  const dir = tmp("rn-g");
  cleanup.push(dir);
  const r = run(["--repo", dir, "--csv", join(dir, "none.csv"), "--out", join(dir, "n.md")]);
  assert.equal(r.code, 2);
  assert.deepEqual(r.lines, [`release-notes: BLOCKED: ${join(dir, "none.csv")} not found`] /* the argument as given */);
});

test("T-I13 fixture half: the six Q19 rows carry the marker and are listed with their clause", () => {
  const dir = tmp("rn-h");
  cleanup.push(dir);
  const { rows } = parseRegister(readFileSync(CSV));
  for (const id of Q19_ROWS) assert.ok(rows.find((r) => r[0] === id)?.[18].includes(MARKER), id);
  assert.equal(run(fixtureArgs(dir)).code, 0);
  const text = readFileSync(join(dir, "release-notes.md"), "utf8");
  for (const id of Q19_ROWS) assert.ok(text.includes(`- ${id} (IMPLEMENTED): the ${id} clause "verified at the seal", SYNTHETIC\n`), id);
  assert.equal(laterClauseOf("x\ncompletes-after-gate: a clause\nmore"), "a clause");
});

test("provisional counts: record keys and array items are counted, comments are not", () => {
  assert.equal(countProvisional(readFileSync(join(I18N, "provisional-ar-SYNTHETIC.ts"), "utf8")), 3);
  // the repository's files are readable and non-empty (the list is generated from them, p7-plan §1.4)
  const dir = tmp("rn-i");
  cleanup.push(dir);
  mkdirSync(join(dir, "docs"), { recursive: true });
  copyFileSync(CSV, join(dir, "docs", "r.csv"));
  const r = run(["--csv", join(dir, "docs", "r.csv"), "--provisional", "apps/web/src/i18n", "--out", join(dir, "n.md")]);
  assert.equal(r.code, 0, r.lines.join("\n"));
  const text = readFileSync(join(dir, "n.md"), "utf8");
  for (const f of ["apps/web/src/i18n/provisional-ar-p6.ts", "apps/web/src/i18n/provisional-ar-p7.ts", "apps/web/src/pages/my-work/provisional-ar.ts"])
    assert.match(text, new RegExp(`^\\| \`${f.replace(/[.]/g, "\\.")}\` \\| [1-9]\\d* \\|$`, "m"), f);
});

/** The text of one "## " section (up to the next "## " heading or the Arabic block). */
function section(text, heading) {
  const start = text.indexOf(`## ${heading}\n`);
  assert.ok(start >= 0, heading);
  const ends = [text.indexOf("\n## ", start + 3), text.indexOf('\n<div dir="rtl"', start)].filter((k) => k > 0);
  return text.slice(start, Math.min(...ends));
}

test("DO-D10 disclosures: the checked-in input carries the D-278 transfer-drill rule in English and Arabic", () => {
  const list = parseDisclosures(readFileSync(DEFAULT_DISCLOSURES, "utf8"), "release-notes-disclosures.json");
  const d = list.find((x) => x.id === "d278-transfer-drill");
  assert.ok(d, "the D-278 entry is present");
  const en = d.en.join("\n");
  // The five points of the assignment (A5.6 AN and A5.7 residual 3), in brief.
  assert.match(en, /Scheduled jobs keep running during the transfer drill/);
  assert.match(en, /never pauses, disables or reschedules/);
  assert.match(en, /explains only the scheduled executions that ADR-0064 A5\.2 allows/);
  assert.match(en, /The drill report lists each one \(`schedule-explained-d9\.json`\)/);
  assert.match(en, /writes business rows inside the window .* still makes D9 fail\. That is not a data defect\./);
  assert.match(en, /re-run the drill, never to pause or reschedule a job/);
  assert.match(en, /Not covered: the engine ticks `automation\.tick_hourly` and `automation\.tick_daily`/);
  const ar = d.ar.join("\n");
  for (const t of ["تبقى المهام المجدولة تعمل", "schedule-explained-d9.json", "ليس عيباً في البيانات", "إعادة تشغيل التجربة", "automation.tick_hourly"])
    assert.ok(ar.includes(t), t);
  assert.equal(d.link.href, "known-limitations.md#adr-residuals");
  // The link target exists: the anchor of known-limitations.md section 6, which carries the full D-278 row.
  const kl = readFileSync(join(REPO, "docs", "handover", "known-limitations.md"), "utf8");
  assert.match(kl, /^## .*\{#adr-residuals\}$/m);
  assert.match(kl, /^\| ADR-0064 Amendment 5 \(D-278\) \| /m);
});

test("DO-D10 disclosures: printed in English before the provisional section, and in the Arabic summary", () => {
  const dir = tmp("rn-j");
  cleanup.push(dir);
  const r = run(fixtureArgs(dir));
  assert.equal(r.code, 0, r.lines.join("\n"));
  const text = readFileSync(join(dir, "release-notes.md"), "utf8");
  const [d] = parseDisclosures(readFileSync(DEFAULT_DISCLOSURES, "utf8"), "x");
  const en = section(text, TEXT.disclosures[0]);
  assert.ok(text.indexOf(`## ${TEXT.deps[0]}\n`) < text.indexOf(`## ${TEXT.disclosures[0]}\n`));
  assert.ok(text.indexOf(`## ${TEXT.disclosures[0]}\n`) < text.indexOf(`## ${TEXT.provisional[0]}\n`));
  assert.ok(en.includes(`### ${d.heading[0]}\n`));
  for (const t of d.en) assert.ok(en.includes(`\n- ${t}\n`), t);
  assert.ok(en.includes(`- ${TEXT.details[0]}: [${d.link.text[0]}](${d.link.href}) (source: ${d.source}).\n`));
  const rtl = text.slice(text.indexOf('<div dir="rtl" lang="ar">'));
  // The Arabic heading is followed by the H.3 provisional lines (check-handover §2.3), and each title is a bold line.
  assert.ok(rtl.includes(`### ${TEXT.disclosures[1]}\n\n${TEXT.provisionalMarker[0]}\n\n${TEXT.provisionalMarker[1]}\n`));
  assert.ok(rtl.includes(`\n**${d.heading[1]}**\n`));
  for (const t of d.ar) assert.ok(rtl.includes(`\n- ${t}\n`), t);
  assert.ok(rtl.includes(`- ${TEXT.details[1]}: [${d.link.text[1]}](${d.link.href})`));
  assert.ok(!en.includes(d.ar[0]) && !rtl.includes(d.en[0]), "each language in its own section");
});

test("DO-D10 disclosures: the committed release notes carry the section (regenerated with --write)", () => {
  const notes = readFileSync(join(REPO, "docs", "handover", "release-notes.md"), "utf8");
  for (const d of parseDisclosures(readFileSync(DEFAULT_DISCLOSURES, "utf8"), "x")) {
    for (const t of [...d.en, ...d.ar]) assert.ok(notes.includes(`- ${t}\n`), t);
  }
});

test("DO-D10 disclosures: an empty list prints the None line in both languages, never an empty heading", () => {
  const dir = tmp("rn-k");
  cleanup.push(dir);
  const f = join(dir, "d.json");
  writeFileSync(f, JSON.stringify({ format: DISCLOSURES_FORMAT, disclosures: [] }));
  const r = run(fixtureArgs(dir, ["--disclosures", f]));
  assert.equal(r.code, 0, r.lines.join("\n"));
  const text = readFileSync(join(dir, "release-notes.md"), "utf8");
  assert.ok(text.includes(`## ${TEXT.disclosures[0]}\n\n${TEXT.disclosuresNone[0]}\n`));
  assert.ok(text.includes(`### ${TEXT.disclosures[1]}\n\n${TEXT.provisionalMarker[0]}\n\n${TEXT.provisionalMarker[1]}\n\n${TEXT.disclosuresNone[1]}\n`));
});

test("DO-D10 disclosures: a missing or invalid input is BLOCKED (exit 2) and nothing is written", () => {
  const dir = tmp("rn-l");
  cleanup.push(dir);
  const good = JSON.parse(readFileSync(DEFAULT_DISCLOSURES, "utf8"));
  const entry = good.disclosures[0];
  const variants = {
    "not valid JSON": "{",
    "format is not": { ...good, format: "other/1" },
    "unknown key extra": { ...good, extra: 1 },
    "id must be lower-case kebab": { ...good, disclosures: [{ ...entry, id: "D278" }] },
    "duplicate id": { ...good, disclosures: [entry, entry] },
    "heading must be [English, Arabic]": { ...good, disclosures: [{ ...entry, heading: [entry.heading[0]] }] },
    "en must be a non-empty list": { ...good, disclosures: [{ ...entry, en: [] }] },
    "ar must be a non-empty list": { ...good, disclosures: [{ ...entry, ar: ["line one\nline two"] }] },
    "link.href must be a relative .md path": { ...good, disclosures: [{ ...entry, link: { ...entry.link, href: "https://example.invalid/x.md" } }] },
    "link.href must be a relative .md path ": { ...good, disclosures: [{ ...entry, link: { ...entry.link, href: "../delivery/decisions.md" } }] },
    "unknown key note": { ...good, disclosures: [{ ...entry, note: "x" }] },
  };
  for (const [why, body] of Object.entries(variants)) {
    const f = join(dir, "bad.json");
    writeFileSync(f, typeof body === "string" ? body : JSON.stringify(body));
    const out = join(dir, "n.md");
    const r = run(["--repo", dir, "--csv", CSV, "--deps", DEPS, "--provisional", I18N, "--out", out, "--disclosures", f]);
    assert.equal(r.code, 2, why);
    assert.equal(r.lines.length, 1, why);
    assert.ok(r.lines[0].startsWith("release-notes: BLOCKED: ") && r.lines[0].includes(why.trim()), `${why}: ${r.lines[0]}`);
    assert.throws(() => readFileSync(out), /ENOENT/, `${why}: nothing is written`);
  }
  const missing = run(["--repo", dir, "--csv", CSV, "--out", join(dir, "m.md"), "--disclosures", join(dir, "none.json")]);
  assert.equal(missing.code, 2);
  assert.deepEqual(missing.lines, [`release-notes: BLOCKED: ${join(dir, "none.json")} not found`]);
  assert.throws(() => parseDisclosures("[]", "x"), DisclosureError);
});
