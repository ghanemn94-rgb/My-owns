// T-M1–T-M8 and T-M13 (ADR-0073 §8.3 cases R0, R8, R9, R11, R13; p7-work-split §M.3) for tools/release/seal.mjs.
// Every case runs in a SPARSE SCRATCH CLONE under $TMPDIR (ADR-0073 §8.1) with a SYNTHETIC DG7 gate record that exists
// only in that clone (§8.2). The repository is only read; T-M2 asserts its `git status --porcelain` is unchanged.
//   T-M1  the sparse clone has the same `candidate.mjs --stage DG7` id as the repository at that commit
//   T-M2  R0: a rehearsal seal and verify exit 0, the verify line is REHEARSAL-PASS, V16 records DG7 SKIPPED; the
//         repository's status is unchanged by the whole file
//   T-M3  the envelope .tar bytes are identical across two seals of the same inputs; ENVELOPE-MANIFEST.json key order
//         and sorted arrays (§3.4)
//   T-M4  R8, R9, S1 missing record, S1 not APPROVED, missing --evidence key, evidence outside test-evidence/DG7/,
//         uncommitted envelope file: each exits with its §M.2 line and code
//   T-M5  R11 and the re-seal rule
//   T-M6  S5/V14 mode markers
//   T-M7  S7: one changed byte of the demo-data input is refused
//   T-M8  S10: a planted secret in an envelope-listed file and a planted claim in the payload docs/ each fail the seal
//   T-M13 R13: after a rehearsal seal, `candidate.mjs --stage DG7` in the clone prints the unchanged id
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { gunzipSync } from "node:zlib";
import { seal } from "../seal.mjs";
import { verifySeal } from "../verify-seal.mjs";
import { MANIFEST_KEYS } from "../lib/envelope.mjs";
import { compareBytes } from "../lib/tar.mjs";
import {
  commitAll,
  demoInput,
  EVIDENCE,
  git,
  neutralizeKnownLabelHits,
  overlayWorkingFiles,
  removeClone,
  REPO,
  scratch,
  scratchAllowlist,
  sealOptions,
  SEAL_DEMO,
  sparseClone,
  writeSynthetic,
} from "./fixtures/seal/rehearsal.mjs";

const NODE = process.execPath;
const candidateCli = (cwd, args = []) => JSON.parse(execFileSync(NODE, ["tools/gates/candidate.mjs", "--stage", "DG7", ...args], { cwd }).toString()).candidate_id;
// The runner writes this agent run's own evidence under docs/delivery/runs/ while the tests run; that directory is the
// harness's, not the rehearsal's, so it is left out of the comparison (everything else must be byte-identical).
const repoStatus = () =>
  execFileSync("git", ["-C", REPO, "status", "--porcelain", "--untracked-files=all"])
    .toString()
    .split("\n")
    .filter((l) => !l.slice(3).startsWith("docs/delivery/runs/"))
    .join("\n");

let clone;
let head;
let idBefore;
let syn;
let demo;
let allow;
let r0;
let v0;
let r0EnvelopeBytes;
let statusBefore;
const outside = []; // scratch output directories outside the clone

before(async () => {
  statusBefore = repoStatus();
  clone = sparseClone("seal-test");
  head = clone.head;
  idBefore = candidateCli(clone.dir); // T-M1, before any rehearsal commit
  overlayWorkingFiles(clone.dir);
  neutralizeKnownLabelHits(clone.dir);
  syn = writeSynthetic(clone.dir);
  demo = demoInput(clone.dir);
  allow = scratchAllowlist(clone.parent);
  r0 = await seal({ ...sealOptions(clone.dir, syn, demo), secretAllowlist: allow });
  if (r0.ok) {
    r0EnvelopeBytes = readFileSync(r0.envelopePath);
    // the filled SYNTHETIC final report (ADR-0073 §7) in the clone's seal directory (META-excluded)
    const sealDir = "docs/delivery/test-evidence/DG7/seal";
    const gateLines = ["DG0", "DG1", "DG2", "DG3", "DG4", "DG5", "DG6", "DG7"]
      .map((s) => {
        const g = JSON.parse(readFileSync(join(clone.dir, "docs", "delivery", "gates", `${s}.json`), "utf8"));
        return `- ${s}: ${g.decision}, candidate ${g.candidate_id}, record \`docs/delivery/gates/${s}.json\``;
      })
      .join("\n");
    const fill = {
      PAYLOAD_HASH: r0.report.payloadHash,
      SOURCE_COMMIT: r0.report.sourceCommit,
      PAYLOAD_ARCHIVE_NAME: r0.report.payloadArchive.name,
      PAYLOAD_ARCHIVE_SHA256: r0.report.payloadArchive.archiveSha256,
      ENVELOPE_ARCHIVE_NAME: r0.report.envelopeArchive.name,
      ENVELOPE_ARCHIVE_SHA256: r0.report.envelopeArchive.archiveSha256,
      SEAL_REPORT: `${sealDir}/seal-report-1.json`,
      VERIFY_REPORT: `${sealDir}/verify-report-1.json`,
      A18: EVIDENCE.A18,
      A19: EVIDENCE.A19,
      INDEX: EVIDENCE["test-level-index"],
      GATE_LINES: gateLines,
    };
    let text = readFileSync(join(REPO, "tools", "release", "tests", "fixtures", "seal", "final-report.filled.md"), "utf8");
    for (const [k, v] of Object.entries(fill)) text = text.split(`@@${k}@@`).join(v);
    writeFileSync(join(clone.dir, sealDir, "final-report.md"), text);
    v0 = await verifySeal({
      envelope: r0.envelopePath,
      expectSha256: r0.report.envelopeArchive.archiveSha256,
      repo: clone.dir,
      finalReport: join(clone.dir, sealDir, "final-report.md"),
      rehearsal: true,
      secretAllowlist: allow,
    });
  }
});
after(() => {
  removeClone(clone);
  outside.forEach((d) => rmSync(d, { recursive: true, force: true }));
});

/** A fresh --out directory outside the clone (so the re-seal rule of seal-report-1 does not apply). */
const freshOut = () => {
  const d = scratch("seal-out");
  outside.push(d);
  return join(d, "out");
};
const restore = (...paths) => git(clone.dir, ["checkout", "-q", "HEAD", "--", ...paths]);
const quick = (extra = {}) => seal({ ...sealOptions(clone.dir, syn, demo), secretAllowlist: allow, out: freshOut(), ...extra });

test("T-M1 the sparse scratch clone has the repository's DG7 candidate id at that commit", () => {
  assert.match(head, /^[0-9a-f]{40}$/);
  assert.equal(idBefore, candidateCli(REPO, ["--ref", head]));
  assert.equal(git(clone.dir, ["config", "--bool", "core.sparseCheckout"]), "true");
  for (const d of ["test-evidence/DG0", "handbacks", "runs"]) assert.ok(!existsSync(join(clone.dir, "docs", "delivery", d)), `${d} is omitted`);
});

test("T-M2 R0: rehearsal seal exit 0; verify REHEARSAL-PASS with V16 DG7 SKIPPED (DG0–DG6 PASS or BLOCKED, never FAIL)", () => {
  assert.equal(r0.exit, 0, r0.lines.join("\n"));
  assert.equal(r0.lines.at(-2), `seal: sealed payload ${syn.candidate}; payload archive sha256 ${r0.report.payloadArchive.archiveSha256}; envelope archive sha256 ${r0.report.envelopeArchive.archiveSha256}`);
  assert.equal(r0.lines.at(-1), "seal: run verify-seal next; delivery is not complete until it passes");
  assert.equal(r0.report.payloadHash, syn.candidate);
  assert.notEqual(r0.report.payloadHash.slice(7), r0.report.envelopeArchive.archiveSha256, "payload hash and archive checksum are separate values");
  assert.equal(r0.report.rehearsal, true);
  assert.deepEqual(r0.report.steps.map((s) => s.id), ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8", "S9", "S10", "S11", "S12"]);
  assert.equal(r0.report.statement, "Sealing and its verification are engineering packaging checks. They grant no business, Finance or IT approval. Product gate G6 does not imply engineering gate DG7, and DG7 does not imply any product gate G1–G6.");
  assert.equal(v0.exit, 0, v0.lines.join("\n") + JSON.stringify(v0.checks.filter((c) => !c.ok), null, 1));
  assert.deepEqual(v0.lines, ["verify-seal: REHEARSAL-PASS (not a release verification; DG7 historical validation skipped: synthetic gate record)"]);
  assert.equal(v0.verdict, "REHEARSAL-PASS");
  assert.deepEqual(v0.checks.map((c) => c.id), Array.from({ length: 18 }, (_, k) => `V${k + 1}`));
  const v16 = v0.checks.find((c) => c.id === "V16");
  assert.deepEqual(v16.runs.map((r) => r.stage), ["DG0", "DG1", "DG2", "DG3", "DG4", "DG5", "DG6", "DG7"]);
  assert.equal(v16.runs.at(-1).status, "SKIPPED");
  for (const r of v16.runs.slice(0, 7)) {
    assert.ok(["PASS", "BLOCKED"].includes(r.status), `${r.stage} ${r.status}`);
    if (r.status === "BLOCKED") assert.match(r.reason, /sparse clone/);
    if (r.status === "PASS") assert.equal(r.exit, 0);
  }
  assert.equal(v0.checks.find((c) => c.id === "V18").status, "PASS");
  assert.equal(v0.report.declarationEligible, false, "a rehearsal never allows the declaration");
});

test("T-M3 the envelope .tar bytes are identical across two seals of the same inputs; manifest key order and sorting", async () => {
  const again = await seal({ ...sealOptions(clone.dir, syn, demo), secretAllowlist: allow, resealReason: "T-M3 determinism (SYNTHETIC)" });
  assert.equal(again.exit, 0, again.lines.join("\n"));
  assert.equal(again.report.envelopeArchive.tarSha256, r0.report.envelopeArchive.tarSha256);
  assert.equal(again.report.envelopeArchive.archiveSha256, r0.report.envelopeArchive.archiveSha256);
  assert.ok(gunzipSync(readFileSync(again.envelopePath)).equals(gunzipSync(r0EnvelopeBytes)));
  const m = JSON.parse(readFileSync(join(clone.dir, "docs/delivery/test-evidence/DG7/seal/envelope-manifest-1.json"), "utf8"));
  assert.deepEqual(Object.keys(m), [...MANIFEST_KEYS]);
  assert.deepEqual(Object.keys(m.payload), ["hash", "hashAlgorithm", "sourceCommit", "files", "archive", "demoDataInputSha256"]);
  const sorted = (arr, key) => arr.every((x, k) => k === 0 || key(arr[k - 1], x) <= 0);
  assert.ok(sorted(m.gates, (a, b) => compareBytes(a.stage, b.stage)));
  assert.ok(sorted(m.candidateManifests, (a, b) => compareBytes(a.stage, b.stage)));
  assert.ok(sorted(m.reviews, (a, b) => compareBytes(a.stage, b.stage) || compareBytes(a.role, b.role)));
  assert.ok(sorted(m.agentDefinitions, (a, b) => compareBytes(a.name, b.name)));
  assert.ok(sorted(m.evidence, (a, b) => compareBytes(a.key, b.key)));
  assert.equal(m.gates.length, 8);
  assert.equal(m.agentDefinitions.length, 10);
  assert.equal(m.register.rows, 412);
  const raw = readFileSync(join(clone.dir, "docs/delivery/test-evidence/DG7/seal/envelope-manifest-1.json"), "utf8");
  assert.ok(raw.endsWith("}\n") && !raw.includes("\r"));
  assert.ok(!/"(sealedAt|sealCommit|builtAt|generatedAt)"/.test(raw), "no clock and no seal commit in the manifest");
});

test("T-M4 refusals: R9, R8, S1 missing, S1 not APPROVED, missing --evidence, evidence outside DG7/, uncommitted file", async () => {
  // R9
  const other = `sha256:${"0".repeat(64)}`;
  let r = await quick({ candidate: other });
  assert.equal(r.exit, 1);
  assert.equal(r.lines.at(-1), `seal: --candidate ${other} is not the approved DG7 candidate ${syn.candidate}`);
  // R8: a payload file changed in the working tree after approval
  writeFileSync(join(clone.dir, "docs/handover/upgrades.md"), `${readFileSync(join(clone.dir, "docs/handover/upgrades.md"), "utf8")}SYNTHETIC drift\n`);
  r = await quick();
  restore("docs/handover/upgrades.md");
  assert.equal(r.exit, 1);
  assert.equal(
    r.lines.at(-1),
    "seal: the working tree payload differs from the approved candidate (1 changed, 0 added, 0 removed); a payload change requires a new candidate and new reviews (master prompt l.621)",
  );
  // S1: missing record
  const dg7 = join(clone.dir, "docs/delivery/gates/DG7.json");
  const dg7Text = readFileSync(dg7, "utf8");
  unlinkSync(dg7);
  r = await quick();
  writeFileSync(dg7, dg7Text);
  assert.equal(r.exit, 2);
  assert.equal(r.lines.at(-1), "seal: BLOCKED: docs/delivery/gates/DG7.json does not exist; DG7 is not approved");
  // S1: not APPROVED
  writeFileSync(dg7, dg7Text.replace('"decision": "APPROVED"', '"decision": "FIXING"'));
  r = await quick();
  restore("docs/delivery/gates/DG7.json");
  assert.equal(r.exit, 2);
  assert.equal(r.lines.at(-1), "seal: BLOCKED: DG7 decision is FIXING, not APPROVED");
  // missing --evidence key
  const { A26: _drop, ...noA26 } = EVIDENCE;
  r = await quick({ evidence: noA26 });
  assert.equal(r.exit, 2);
  assert.equal(r.lines.at(-1), "seal: BLOCKED: missing --evidence A26");
  // evidence outside docs/delivery/test-evidence/DG7/
  r = await quick({ evidence: { ...EVIDENCE, A26: "docs/delivery/findings.json" } });
  assert.equal(r.exit, 2);
  assert.equal(r.lines.at(-1), "seal: BLOCKED: --evidence A26 must be a file under docs/delivery/test-evidence/DG7/");
  // an envelope-only file that is not committed
  const f = join(clone.dir, "docs/delivery/findings.json");
  writeFileSync(f, `${readFileSync(f, "utf8")} `);
  r = await quick();
  restore("docs/delivery/findings.json");
  assert.equal(r.exit, 2);
  assert.equal(r.lines.at(-1), "seal: BLOCKED: docs/delivery/findings.json is not committed or differs from HEAD");
  // clean again, apart from R0's own seal outputs (META-excluded, untracked by design)
  assert.equal(git(clone.dir, ["status", "--porcelain", "--", ".", ":!docs/delivery/test-evidence/DG7/seal"]), "", "the clone is clean again");
});

test("T-M5 R11 and the re-seal rule", async () => {
  // R11: --out set to a payload path
  let r = await seal({ ...sealOptions(clone.dir, syn, demo), secretAllowlist: allow, out: "docs/handover/x" });
  assert.equal(r.exit, 2);
  assert.equal(r.lines.at(-1), `seal: refused output path ${join(clone.dir, "docs/handover/x")}: it would change the payload hash`);
  assert.ok(!existsSync(join(clone.dir, "docs/handover/x")));
  // an existing report without --reseal-reason (T-M3 wrote sequence 2)
  const out = join(clone.dir, "docs/delivery/test-evidence/DG7/seal");
  r = await seal({ ...sealOptions(clone.dir, syn, demo), secretAllowlist: allow });
  assert.equal(r.exit, 2);
  assert.equal(r.lines.at(-1), `seal: BLOCKED: ${join(out, "seal-report-2.json")} exists; a re-seal needs --reseal-reason`);
  // with it: sequence n+1, earlier reports unchanged
  const before1 = readFileSync(join(out, "seal-report-1.json"));
  const before2 = readFileSync(join(out, "seal-report-2.json"));
  r = await seal({ ...sealOptions(clone.dir, syn, demo), secretAllowlist: allow, resealReason: "T-M5 envelope-only re-seal (SYNTHETIC)" });
  assert.equal(r.exit, 0, r.lines.join("\n"));
  assert.equal(r.report.sequence, 3);
  assert.equal(r.report.resealReason, "T-M5 envelope-only re-seal (SYNTHETIC)");
  assert.equal(r.report.payloadHash, r0.report.payloadHash);
  assert.ok(readFileSync(join(out, "seal-report-1.json")).equals(before1));
  assert.ok(readFileSync(join(out, "seal-report-2.json")).equals(before2));
  assert.ok(existsSync(join(out, "seal-report-3.json")) && existsSync(join(out, "envelope-manifest-3.json")));
});

test("T-M6 S5/V14: a release seal refuses a synthetic record; a rehearsal refuses a missing DG7 marker and a marker on DG0–DG6", async () => {
  let r = await quick({ rehearsal: false });
  assert.equal(r.exit, 1);
  assert.equal(r.lines.at(-1), "seal: a release seal refuses a synthetic gate record: docs/delivery/gates/DG7.json");
  const dg7 = join(clone.dir, "docs/delivery/gates/DG7.json");
  const rec = JSON.parse(readFileSync(dg7, "utf8"));
  delete rec.synthetic_rehearsal;
  writeFileSync(dg7, `${JSON.stringify(rec, null, 2)}\n`);
  r = await quick();
  restore("docs/delivery/gates/DG7.json");
  assert.equal(r.exit, 1);
  assert.equal(r.lines.at(-1), "seal: a rehearsal requires a synthetic DG7 gate record");
  const dg3 = join(clone.dir, "docs/delivery/gates/DG3.json");
  const g3 = JSON.parse(readFileSync(dg3, "utf8"));
  writeFileSync(dg3, `${JSON.stringify({ ...g3, synthetic_rehearsal: true }, null, 2)}\n`);
  r = await quick();
  restore("docs/delivery/gates/DG3.json");
  assert.equal(r.exit, 1);
  assert.equal(r.lines.at(-1), "seal: a rehearsal seal refuses a synthetic marker on docs/delivery/gates/DG3.json");
  // R5 at the seal: a synthetic DG7 record with stage_id G6 is refused (rule L1)
  writeFileSync(dg7, readFileSync(dg7, "utf8").replace('"stage_id": "DG7"', '"stage_id": "G6"'));
  r = await quick();
  restore("docs/delivery/gates/DG7.json");
  assert.equal(r.exit, 1);
  assert.equal(r.lines.at(-1), 'seal: docs/delivery/gates/DG7.json has stage_id "G6", not DG7 (rule L1)');
});

test("T-M7 S7: a demo-data input with one changed byte is refused", async () => {
  const d = scratch("seal-demo");
  outside.push(d);
  cpSync(SEAL_DEMO, d, { recursive: true });
  const t = join(d, "tables", "organization.ndjson");
  const b = readFileSync(t);
  b[b.length - 2] ^= 0x01;
  writeFileSync(t, b);
  const r = await quick({ demoData: d });
  assert.equal(r.exit, 1);
  assert.match(r.lines.at(-1), new RegExp(`^seal: demo-data input hashes to [0-9a-f]{64}, not the recorded ${demo.sha256}$`));
});

test("T-M13 R13: after a rehearsal seal the clone's DG7 candidate id is unchanged", () => {
  assert.equal(candidateCli(clone.dir), syn.candidate);
  assert.ok(r0.report.steps.find((s) => s.id === "S12").ok);
});

test("T-M8 S10: a planted secret in an envelope-listed file, and a planted claim in the payload docs/, fail the seal", async () => {
  // a key-shaped value assembled from fragments at run time (p7-work-split §2 rule 6)
  const planted = ["AK", "IA", "QZ7X", "N4M2", "P8R6", "T3W5"].join("");
  const a18 = join(clone.dir, EVIDENCE.A18);
  const original = readFileSync(a18, "utf8");
  writeFileSync(a18, `${original}SYNTHETIC planted key ${planted}\n`);
  commitAll(clone.dir, "SYNTHETIC planted secret");
  let r = await quick();
  writeFileSync(a18, original);
  commitAll(clone.dir, "SYNTHETIC planted secret removed");
  assert.equal(r.exit, 1, r.lines.join("\n"));
  assert.equal(r.lines.at(-1), "seal: secret scan found 1 hit(s)");
  assert.ok(r.lines.some((l) => l.includes(EVIDENCE.A18) && l.startsWith("seal: S1 ")));
  assert.ok(!r.lines.join("\n").includes(planted), "the planted value is never printed whole");
  // a planted claim in the payload docs/: a payload change, so a new synthetic candidate
  const claim = ["A", "certified", "platform for transformation."].join(" ");
  const doc = "docs/handover/rehearsal-claim-SYNTHETIC.md";
  writeFileSync(join(clone.dir, doc), `# SYNTHETIC\n\n${claim}\n`);
  commitAll(clone.dir, "SYNTHETIC planted claim");
  const planted2 = writeSynthetic(clone.dir);
  r = await seal({ ...sealOptions(clone.dir, planted2, demo), secretAllowlist: allow, out: freshOut() });
  rmSync(join(clone.dir, doc));
  commitAll(clone.dir, "SYNTHETIC planted claim removed");
  assert.equal(r.exit, 1, r.lines.join("\n"));
  assert.match(r.lines.at(-1), /^seal: claims scan found [1-9]\d* hit\(s\)$/);
  assert.ok(r.lines.some((l) => l.includes("rehearsal-claim-SYNTHETIC.md")));
});

test("T-M2 (end) the repository's git status is unchanged by the whole rehearsal", () => {
  assert.equal(repoStatus(), statusBefore);
});
