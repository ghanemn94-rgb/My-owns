// T-I11 and T-I13 (fixture half) of ADR-0071 §5 and §9 for tools/release/release-notes.mjs (p7-work-split §I.4, §M.1).
//   T-I11  the "Unfinished items and release blockers" section lists exactly the register rows that are not
//          IMPLEMENTED (set equality), on the fixture and on the tree's register; a non-IMPLEMENTED row with empty notes
//          exits 1; an IMPLEMENTED row without evidence exits 1; --check drift exits 1; no clock is read (two runs give
//          identical bytes); the dependency list absent gives the Unknown line, never "none".
//   T-I13  (fixture half) the six D-243 Q19 rows carry `completes-after-gate:` and appear in the later-clauses section.
// Everything is written under $TMPDIR; nothing is written to the repository.
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, test } from "node:test";
import { parseRegister } from "../../../apps/api/scripts/register-snapshot.mjs";
import { buildReleaseNotes, countProvisional, laterClauseOf, main, MARKER, Q19_ROWS, TEXT } from "../release-notes.mjs";
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
