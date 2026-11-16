// T-M9–T-M12 (ADR-0073 §5–§8; p7-work-split §M.3) for tools/release/verify-seal.mjs and its libraries.
//   T-M9  L1–L4 over the real docs/delivery/gates/DG0.json–DG6.json (read-only). The hit set is pinned: a hit is
//         reported to the orchestrator in the handback, never fixed in an approved record (D-243 Q13)
//   T-M10 R1–R7 and R10: each tampering case fails exactly the checks the ADR names, with the recorded
//         --expect-sha256 kept (V1 then fails too); a variant that recomputes the checksum still fails the content checks
//   T-M11 V16 spawns validate.mjs --historical per gate and records exit codes; a non-zero exit fails V16; a validator
//         that cannot run is BLOCKED, never PASS
//   T-M12 R12 and V18: every §7.3 rule has a failing fixture; the filled SYNTHETIC report passes; the template's
//         section 8 guide paths exist in the tree
// The envelope is sealed once in a SPARSE SCRATCH CLONE with a SYNTHETIC DG7 record (ADR-0073 §8); tampered envelopes
// are rebuilt in memory with lib/tar.mjs and written under $TMPDIR only.
import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { APPROVED_SPEC, manifestFromRef } from "../../gates/lib/candidate.mjs";
import { seal } from "../seal.mjs";
import { historicalValidation, verifySeal } from "../verify-seal.mjs";
import { manifestPaths, sha256, sha256sums } from "../lib/envelope.mjs";
import { CAP_IDS, checkFinalReport, guidePaths } from "../lib/final-report.mjs";
import { checkGateLabels, parseAcknowledgements, sentenceSha256, SYNTHETIC_NOTES_PREFIX } from "../lib/gate-labels.mjs";
import { gunzipArchive, gzipDeterministic, readTar, writeTar } from "../lib/tar.mjs";
import {
  demoInput,
  EVIDENCE,
  overlayWorkingFiles,
  removeClone,
  REPO,
  scratch,
  sealOptions,
  sparseClone,
  writeSynthetic,
} from "./fixtures/seal/rehearsal.mjs";

/**
 * The raw L1–L4 hits on the real DG0–DG6 records at DO-J's base (T-M9). Approved records are never rewritten; since
 * T-DG7-DO-J2 each is acknowledged by an exact entry of tools/release/gate-labels-acknowledged.json (DO-J O1).
 */
const KNOWN_REAL_HITS = Object.freeze([{ rule: "L3", where: "docs/delivery/gates/DG3.json $.notes", contains: "where a G4 capacity-conflict item" }]);

let clone;
let syn;
let sealed;
let envBytes;
let work;
const SEAL_DIR = "docs/delivery/test-evidence/DG7/seal";

before(async () => {
  clone = sparseClone("verify-test");
  overlayWorkingFiles(clone.dir);
  syn = writeSynthetic(clone.dir);
  const demo = demoInput(clone.dir);
  sealed = await seal({ ...sealOptions(clone.dir, syn, demo) });
  assert.equal(sealed.exit, 0, sealed.lines.join("\n"));
  envBytes = readFileSync(sealed.envelopePath);
  work = scratch("verify-work");
});
after(() => {
  removeClone(clone);
  if (work) rmSync(work, { recursive: true, force: true });
});

// ------------------------------------------------------------------------------------------------- envelope tamper --

/** The envelope's files as an editable map (rest path → Buffer) plus its top directory. */
function unpack(bytes) {
  const entries = [...readTar(gunzipArchive(bytes))];
  const top = entries[0].path.split("/")[0];
  const files = new Map();
  const modes = new Map();
  for (const e of entries)
    if (e.type === "file") {
      files.set(e.path.slice(top.length + 1), Buffer.from(e.data));
      modes.set(e.path.slice(top.length + 1), e.mode);
    }
  return { top, files, modes };
}
/** Re-packs with a recomputed SHA256SUMS (the tamperer covers the envelope's own sums, so V2 holds). */
function repack({ top, files, modes }) {
  files.delete("SHA256SUMS");
  const list = [...files].map(([path, data]) => ({ path, data }));
  files.set("SHA256SUMS", Buffer.from(sha256sums(list), "utf8"));
  return pack({ top, files, modes });
}
const pack = ({ top, files, modes }) =>
  gzipDeterministic(writeTar([...files].map(([path, data]) => ({ path: `${top}/${path}`, data, mode: modes.get(path) ?? 0o644 }))));
let n = 0;
async function verifyTampered(mutate, { recompute = false, rehearsal = true } = {}) {
  const env = unpack(envBytes);
  mutate(env);
  const bytes = repack(env);
  const p = join(work, `tampered-${++n}.tar.gz`);
  writeFileSync(p, bytes);
  const r = await verifySeal({
    envelope: p,
    expectSha256: recompute ? sha256(bytes) : sealed.report.envelopeArchive.archiveSha256,
    rehearsal,
    writeReport: false,
  });
  rmSync(p);
  return r;
}
const failedIds = (r) => r.checks.filter((c) => c.status === "FAIL").map((c) => c.id);
const json = (buf) => JSON.parse(buf.toString("utf8"));
const jsonBuf = (o) => Buffer.from(`${JSON.stringify(o, null, 2)}\n`, "utf8");

/** Rewrites one file inside the payload archive (and, with `cover`, the payload's sums, .sha256 and manifest). */
function editPayload(env, path, edit, { cover = false } = {}) {
  const m = json(env.files.get("ENVELOPE-MANIFEST.json"));
  const name = m.payload.archive.name;
  const inner = unpack(env.files.get(`payload/${name}`));
  inner.files.set(path, edit(inner.files.get(path)));
  let gz;
  if (cover) gz = repack(inner);
  else gz = pack(inner); // a tamperer who does not touch the payload's own SHA256SUMS
  env.files.set(`payload/${name}`, gz);
  if (cover) {
    m.payload.archive.archiveSha256 = sha256(gz);
    m.payload.archive.tarSha256 = sha256(gunzipArchive(gz));
    env.files.set(`payload/${name}.sha256`, Buffer.from(`${sha256(gz)}  ${name}\n`, "utf8"));
    env.files.set("ENVELOPE-MANIFEST.json", jsonBuf(m));
  }
}

// ----------------------------------------------------------------------------------------------------------- tests --

test("T-M9 L1–L4 on the real DG0–DG6 gate records: the hit set is exactly the reported one", () => {
  const gates = [0, 1, 2, 3, 4, 5, 6].map((k) => {
    const path = `docs/delivery/gates/DG${k}.json`;
    return { path, record: JSON.parse(readFileSync(join(REPO, path), "utf8")) };
  });
  const r = checkGateLabels({ gates });
  assert.deepEqual(
    r.hits.map((h) => ({ rule: h.rule, where: h.where })),
    KNOWN_REAL_HITS.map(({ rule, where }) => ({ rule, where })),
    JSON.stringify(r.hits, null, 1),
  );
  KNOWN_REAL_HITS.forEach((k, i) => assert.ok(r.hits[i].detail.includes(k.contains)));
  for (const rule of ["L1", "L2", "L4"]) assert.equal(r.hits.filter((h) => h.rule === rule).length, 0, `${rule} passes on DG0–DG6`);
});

/** The real DG0–DG6 records and the shipped acknowledgement list (T-DG7-DO-J2). */
const realGates = () =>
  [0, 1, 2, 3, 4, 5, 6].map((k) => {
    const path = `docs/delivery/gates/DG${k}.json`;
    return { path, record: JSON.parse(readFileSync(join(REPO, path), "utf8")) };
  });
const shippedAcks = () => parseAcknowledgements(JSON.parse(readFileSync(join(REPO, "tools/release/gate-labels-acknowledged.json"), "utf8")));

test("T-M9 (DO-J2) the shipped acknowledgement list clears exactly the reported hits, and no gate record is edited", () => {
  const r = checkGateLabels({ gates: realGates(), acknowledged: shippedAcks() });
  assert.deepEqual(r.hits, [], JSON.stringify(r.hits, null, 1));
  assert.deepEqual(
    r.acknowledged.map((a) => ({ rule: a.rule, where: a.where })),
    KNOWN_REAL_HITS.map(({ rule, where }) => ({ rule, where })),
  );
  KNOWN_REAL_HITS.forEach((k, i) => assert.ok(r.acknowledged[i].detail.includes(k.contains)));
  assert.equal(shippedAcks().length, KNOWN_REAL_HITS.length, "one entry per reported hit, none spare");
});

test("T-M9 (DO-J2) an acknowledgement matches only the exact sentence: an edited sentence is a hit again and the entry is stale", () => {
  const gates = realGates();
  const dg3 = gates[3];
  dg3.record = { ...dg3.record, notes: dg3.record.notes.replace("where a G4 capacity-conflict item", "where a G4 capacity conflict item") };
  const r = checkGateLabels({ gates, acknowledged: shippedAcks() });
  assert.deepEqual(
    r.hits.map((h) => h.rule),
    ["L3", "L3"],
  );
  assert.match(r.hits[0].detail, /G4 capacity conflict item/);
  assert.match(r.hits[1].detail, /^stale acknowledgement 0: no L3 sentence with sha256 9c3e2203457a/);
  // a record the check does not see makes no entry stale (archive tests check subsets)
  assert.deepEqual(checkGateLabels({ gates: [gates[0]], acknowledged: shippedAcks() }).hits, []);
});

test("T-M9 (DO-J2) acknowledgements cover gate-record L3/L4 only: never DG7, a field rule, the README or the final report", () => {
  const ok = { rule: "L3", path: "docs/delivery/gates/DG3.json", jsonPath: "$.notes", sentenceSha256: "a".repeat(64), reason: "SYNTHETIC: a reason that is long enough to be accepted here." };
  assert.equal(parseAcknowledgements({ entries: [ok] }).length, 1);
  const refused = (e, re) => assert.throws(() => parseAcknowledgements({ entries: [{ ...ok, ...e }] }), re);
  refused({ path: "docs/delivery/gates/DG7.json" }, /not an approved gate record/);
  refused({ path: "docs/delivery/gates/DG*.json" }, /not an approved gate record/);
  refused({ path: "docs/delivery/reviews/DG6/round-7/code-security-reviewer.json" }, /not an approved gate record/);
  for (const rule of ["L1", "L2", "L5"]) refused({ rule }, /cannot be acknowledged/);
  refused({ sentenceSha256: "abc" }, /not 64 hex/);
  refused({ reason: "fine" }, /shorter than 40/);
  refused({ jsonPath: "notes" }, /not a JSON path/);
  refused({ reason: undefined }, /lacks "reason"/);
  assert.throws(() => parseAcknowledgements({ entries: [ok, ok] }), /duplicates/);
  assert.throws(() => parseAcknowledgements({}), /no entries array/);
  // a matching hash in a text (README, final report) or a DG7 record is still a hit (the hash below is exact)
  const sentence = "SYNTHETIC: DG7 follows from G6";
  assert.deepEqual(
    checkGateLabels({ texts: [{ label: "x", text: sentence }] }).hits.map((h) => sentenceSha256(h.detail)),
    [sentenceSha256(sentence)],
  );
  const ack = parseAcknowledgements([{ ...ok, sentenceSha256: sentenceSha256(sentence) }]);
  assert.deepEqual(checkGateLabels({ texts: [{ label: "README.txt", text: sentence, rules: ["L3"] }], acknowledged: ack }).hits.map((h) => h.rule), ["L3"]);
  const dg7 = { stage_id: "DG7", previous_gate: "DG6", decision: "APPROVED", decided_by: "release-auditor", notes: sentence };
  assert.deepEqual(checkGateLabels({ gates: [{ path: "docs/delivery/gates/DG7.json", record: dg7 }], acknowledged: ack }).hits.map((h) => h.rule), ["L3"]);
});

test("T-M9 each rule fails on its SYNTHETIC case and passes the separation wording", () => {
  const base = { stage_id: "DG7", previous_gate: "DG6", decision: "APPROVED", decided_by: "release-auditor", notes: `${SYNTHETIC_NOTES_PREFIX}` };
  const ok = checkGateLabels({ gates: [{ path: "docs/delivery/gates/DG7.json", record: base }] });
  assert.deepEqual(ok.hits, [], "the synthetic marker prefix itself is not a hit");
  const rules = (rec, extra = {}) => checkGateLabels({ gates: [{ path: "docs/delivery/gates/DG7.json", record: { ...base, ...rec } }], ...extra }).hits.map((h) => h.rule);
  assert.ok(rules({ stage_id: "G6" }).includes("L1")); // R5
  assert.ok(rules({ stage_id: "G6" }).includes("L2"));
  assert.deepEqual(rules({ product_gate: "G4" }), ["L2", "L2"]); // R6: the key and the value
  assert.deepEqual(rules({ notes: "SYNTHETIC: DG7 follows from G6." }), ["L3"]);
  assert.deepEqual(rules({ notes: "SYNTHETIC: DG7 does not imply G6." }), []);
  assert.deepEqual(rules({ notes: "SYNTHETIC: the Sponsor approval was recorded." }), ["L4"]);
  assert.deepEqual(rules({ notes: "SYNTHETIC: no Finance approval is granted." }), []);
  const l5 = checkGateLabels({ demoTables: [{ table: "gate_review", rows: [{ gate_code: "G2" }, { gate_code: "DG7" }] }] }).hits; // R7
  assert.deepEqual(
    l5.map((h) => h.rule),
    ["L5", "L5"],
  );
  assert.deepEqual(checkGateLabels({ manifest: { business_gate: 1 } }).hits.map((h) => h.rule), ["L2"]);
  assert.deepEqual(checkGateLabels({ texts: [{ label: "README", text: "SYNTHETIC: DG7 equals G6.", rules: ["L3"] }] }).hits.map((h) => h.rule), ["L3"]);
});

test("T-M10 the untampered envelope passes archive mode; R10 a release-mode verify of it fails V14 only", async () => {
  const ok = await verifySeal({ envelope: sealed.envelopePath, expectSha256: sealed.report.envelopeArchive.archiveSha256, rehearsal: true, writeReport: false });
  assert.deepEqual(failedIds(ok), [], JSON.stringify(ok.checks.filter((c) => !c.ok), null, 1));
  assert.equal(ok.verdict, "REHEARSAL-PASS");
  assert.deepEqual(ok.checks.map((c) => c.id), Array.from({ length: 14 }, (_, k) => `V${k + 1}`), "archive mode runs V1–V14 only");
  const r10 = await verifySeal({ envelope: sealed.envelopePath, expectSha256: sealed.report.envelopeArchive.archiveSha256, rehearsal: false, writeReport: false });
  assert.deepEqual(failedIds(r10), ["V14"]);
  assert.equal(r10.exit, 1);
  assert.deepEqual(r10.lines.slice(-1), ["verify-seal: FAIL (1 checks)"]);
  assert.match(r10.lines[0], /^verify-seal: V14 FAIL a release verification refuses a rehearsal envelope/);
});

test("T-M10 R1: a source/ entry rewritten inside the payload archive fails V4 and V1; recomputed: V4 alone", async () => {
  const edit = (env) => editPayload(env, "source/package.json", (b) => Buffer.concat([b, Buffer.from(" ")]));
  assert.deepEqual(failedIds(await verifyTampered(edit)), ["V1", "V4"]);
  const r = await verifyTampered(edit, { recompute: true });
  assert.deepEqual(failedIds(r), ["V4"]);
  const v4 = r.checks.find((c) => c.id === "V4").detail;
  assert.match(v4, /archive-checksum/);
  assert.match(v4, /sha256sums/);
  assert.match(v4, /candidate-id/);
});

test("T-M10 R2: gates/DG3.json removed from the envelope fails V3 and V6 (and V1)", async () => {
  const edit = (env) => env.files.delete("evidence/docs/delivery/gates/DG3.json");
  assert.deepEqual(failedIds(await verifyTampered(edit)), ["V1", "V3", "V6"]);
  assert.deepEqual(failedIds(await verifyTampered(edit, { recompute: true })), ["V3", "V6"]);
});

test("T-M10 R3: an agent definition altered in evidence/ fails V3 and V8 (and V1)", async () => {
  const edit = (env) => {
    const p = "evidence/.claude/agents/qa-verifier.md";
    env.files.set(p, Buffer.concat([env.files.get(p), Buffer.from("\nSYNTHETIC tamper\n")]));
  };
  assert.deepEqual(failedIds(await verifyTampered(edit)), ["V1", "V3", "V8"]);
  assert.deepEqual(failedIds(await verifyTampered(edit, { recompute: true })), ["V3", "V8"]);
});

test("T-M10 R4: the register in evidence/ differing by one byte fails V3 and V9 (and V1)", async () => {
  const edit = (env) => {
    const p = "evidence/docs/delivery/requirements.csv";
    const b = Buffer.from(env.files.get(p));
    const k = b.lastIndexOf(Buffer.from("SPECIFIED"));
    b[k] = "s".charCodeAt(0); // SPECIFIED → sPECIFIED (still one byte)
    env.files.set(p, b);
  };
  const r = await verifyTampered(edit);
  assert.deepEqual(failedIds(r), ["V1", "V3", "V9"]);
  assert.deepEqual(failedIds(await verifyTampered(edit, { recompute: true })), ["V3", "V9"]);
});

test("T-M10 R5 and R6: DG7 stage_id G6, and a product_gate key, fail V12 (with V3 for the changed bytes)", async () => {
  const r5 = (env) => {
    const p = "evidence/docs/delivery/gates/DG7.json";
    env.files.set(p, jsonBuf({ ...json(env.files.get(p)), stage_id: "G6" }));
  };
  const a = await verifyTampered(r5);
  assert.deepEqual(failedIds(a), ["V1", "V3", "V12"]);
  assert.match(a.checks.find((c) => c.id === "V12").detail, /L1 docs\/delivery\/gates\/DG7\.json: stage_id is "G6", not DG7/);
  const r6 = (env) => {
    const p = "evidence/docs/delivery/gates/DG7.json";
    env.files.set(p, jsonBuf({ ...json(env.files.get(p)), product_gate: "G4" }));
  };
  const b = await verifyTampered(r6, { recompute: true });
  assert.deepEqual(failedIds(b), ["V3", "V12"]);
  assert.match(b.checks.find((c) => c.id === "V12").detail, /L2 docs\/delivery\/gates\/DG7\.json: key \$\.product_gate names a product or business gate/);
});

test("T-M10 (DO-J2) V12 takes the acknowledgement list from the sealed payload: untampered it acknowledges DG3's sentence; emptied, the L3 hit fails V12", async () => {
  const ok = await verifySeal({ envelope: sealed.envelopePath, expectSha256: sealed.report.envelopeArchive.archiveSha256, rehearsal: true, writeReport: false });
  const v12 = ok.checks.find((c) => c.id === "V12");
  assert.equal(v12.status, "PASS", v12.detail);
  assert.match(v12.detail, /1 acknowledged sentence\(s\) in approved records: L3 docs\/delivery\/gates\/DG3\.json \$\.notes \(entry 0\)/);
  const emptied = (env) =>
    editPayload(env, "source/tools/release/gate-labels-acknowledged.json", () => Buffer.from('{ "entries": [] }\n', "utf8"), { cover: true });
  const r = await verifyTampered(emptied, { recompute: true });
  assert.deepEqual(failedIds(r), ["V4", "V12"], "V4: the candidate id of source/ changed; V12: the L3 hit is back");
  assert.match(r.checks.find((c) => c.id === "V12").detail, /L3 docs\/delivery\/gates\/DG3\.json \$\.notes: \(2\) For backend-workflow-engineer/);
  const refused = (env) =>
    editPayload(env, "source/tools/release/gate-labels-acknowledged.json", () => Buffer.from('{ "entries": [{ "rule": "L1" }] }\n', "utf8"), { cover: true });
  const r2 = await verifyTampered(refused, { recompute: true });
  assert.match(r2.checks.find((c) => c.id === "V12").detail, /acknowledgement list tools\/release\/gate-labels-acknowledged\.json refused/);
});

test("T-M10 R7: a demo-data row with gate_code DG7 fails V12 L5 (the tamperer covers every checksum)", async () => {
  const edit = (env) =>
    editPayload(
      env,
      "demo-data/tables/gate_review.ndjson",
      (b) => Buffer.concat([b, Buffer.from('{"id":"00000000-0000-4000-8000-000000000199","gate_code":"DG7","note":"SYNTHETIC tamper"}\n')]),
      { cover: true },
    );
  const r = await verifyTampered(edit, { recompute: true });
  assert.deepEqual(failedIds(r), ["V12"]);
  assert.match(r.checks.find((c) => c.id === "V12").detail, /L5 gate_review row 4: gate_code "DG7" is not G1–G6/);
});

test("T-M10 BLOCKED: a missing envelope, a non-gzip file, a missing --expect-sha256", async () => {
  let r = await verifySeal({ envelope: join(work, "none.tar.gz"), expectSha256: "0".repeat(64), writeReport: false });
  assert.equal(r.exit, 2);
  assert.match(r.lines[0], /^verify-seal: BLOCKED: cannot read /);
  writeFileSync(join(work, "x.tar.gz"), "SYNTHETIC not gzip");
  r = await verifySeal({ envelope: join(work, "x.tar.gz"), expectSha256: "0".repeat(64), writeReport: false });
  assert.equal(r.exit, 2);
  assert.match(r.lines[0], /^verify-seal: BLOCKED: .* is not a readable gzip tar \(not gzip\)$/);
  r = await verifySeal({ envelope: sealed.envelopePath, writeReport: false });
  assert.deepEqual(r.lines, ["verify-seal: BLOCKED: --expect-sha256 <64 hex> is required"]);
  r = await verifySeal({ envelope: sealed.envelopePath, expectSha256: "0".repeat(64), repo: clone.dir, out: "docs/handover/x" });
  assert.deepEqual(r.lines, [`verify-seal: refused output path ${join(clone.dir, "docs/handover/x")}: it would change the payload hash`]);
});

test("T-M11 V16 runs validate.mjs --historical per gate, records exit codes, FAILs on non-zero, BLOCKED when it cannot run", () => {
  const fake = scratch("v16-fake");
  try {
    mkdirSync(join(fake, "tools", "gates"), { recursive: true });
    const script = join(fake, "tools", "gates", "validate.mjs");
    // SYNTHETIC stand-in for the validator: exits 1 for the stage named in FAIL_STAGE, 0 otherwise
    writeFileSync(script, 'const s = process.argv[process.argv.indexOf("--stage") + 1];\nconsole.log(`SYNTHETIC validate ${process.argv.slice(2).join(" ")}`);\nprocess.exit(s === process.env.FAIL_STAGE ? 1 : 0);\n');
    chmodSync(script, 0o644);
    process.env.FAIL_STAGE = "none";
    let r = historicalValidation({ repo: fake, rehearsal: false });
    assert.equal(r.status, "PASS");
    assert.deepEqual(r.runs.map((x) => [x.stage, x.status, x.exit]), ["DG0", "DG1", "DG2", "DG3", "DG4", "DG5", "DG6", "DG7"].map((s) => [s, "PASS", 0]));
    assert.match(r.runs[3].tail, /^SYNTHETIC validate --historical --stage DG3$/);
    process.env.FAIL_STAGE = "DG4";
    r = historicalValidation({ repo: fake, rehearsal: false });
    assert.equal(r.status, "FAIL");
    assert.deepEqual(r.runs[4], { stage: "DG4", status: "FAIL", exit: 1, tail: "SYNTHETIC validate --historical --stage DG4" });
    r = historicalValidation({ repo: fake, rehearsal: true });
    assert.equal(r.status, "FAIL", "outside a sparse clone a rehearsal's non-zero exit still fails");
    assert.equal(r.runs[7].status, "SKIPPED");
    process.env.FAIL_STAGE = "none";
    r = historicalValidation({ repo: fake, rehearsal: true, stages: ["DG7"] });
    assert.equal(r.status, "SKIPPED", "skipped only: never PASS");
    rmSync(script);
    r = historicalValidation({ repo: fake, rehearsal: false });
    assert.equal(r.status, "BLOCKED");
    assert.ok(r.runs.every((x) => x.status === "BLOCKED" && x.exit === null && /validate\.mjs not found/.test(x.reason)));
  } finally {
    delete process.env.FAIL_STAGE;
    rmSync(fake, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------------------------------------- T-M12 / V18 --

const TEMPLATE = readFileSync(join(REPO, "docs", "handover", "final-report.template.md"), "utf8");

function filledReport() {
  const gateLines = ["DG0", "DG1", "DG2", "DG3", "DG4", "DG5", "DG6", "DG7"]
    .map((s) => {
      const g = JSON.parse(readFileSync(join(clone.dir, "docs", "delivery", "gates", `${s}.json`), "utf8"));
      return `- ${s}: ${g.decision}, candidate ${g.candidate_id}, record \`docs/delivery/gates/${s}.json\``;
    })
    .join("\n");
  const fill = {
    PAYLOAD_HASH: sealed.report.payloadHash,
    SOURCE_COMMIT: sealed.report.sourceCommit,
    PAYLOAD_ARCHIVE_NAME: sealed.report.payloadArchive.name,
    PAYLOAD_ARCHIVE_SHA256: sealed.report.payloadArchive.archiveSha256,
    ENVELOPE_ARCHIVE_NAME: sealed.report.envelopeArchive.name,
    ENVELOPE_ARCHIVE_SHA256: sealed.report.envelopeArchive.archiveSha256,
    SEAL_REPORT: `${SEAL_DIR}/seal-report-1.json`,
    VERIFY_REPORT: `${SEAL_DIR}/verify-report-1.json`,
    A18: EVIDENCE.A18,
    A19: EVIDENCE.A19,
    INDEX: EVIDENCE["test-level-index"],
    GATE_LINES: gateLines,
  };
  let text = readFileSync(join(REPO, "tools", "release", "tests", "fixtures", "seal", "final-report.filled.md"), "utf8");
  for (const [k, v] of Object.entries(fill)) text = text.split(`@@${k}@@`).join(v);
  return text;
}
let ctxCache = null;
function ctx() {
  if (ctxCache) return ctxCache;
  const m = JSON.parse(readFileSync(join(clone.dir, SEAL_DIR, "envelope-manifest-1.json"), "utf8"));
  const listed = new Set(manifestPaths(m).map((e) => e.path));
  const payload = new Set(manifestFromRef(clone.dir, sealed.report.sourceCommit, APPROVED_SPEC).map((e) => e.path));
  ctxCache = {
    template: TEMPLATE,
    sealReport: sealed.report,
    isListed: (p) => listed.has(p) || payload.has(p) || p.startsWith(`${SEAL_DIR}/`),
    fileKind: (p) => {
      const abs = join(clone.dir, p);
      if (!existsSync(abs)) return "missing";
      return lstatSync(abs).isFile() ? "file" : lstatSync(abs).isDirectory() ? "dir" : "missing";
    },
  };
  return ctxCache;
}
const rulesOf = (text) => [...new Set(checkFinalReport(text, ctx()).problems.map((p) => p.rule))];

test("T-M12 the filled SYNTHETIC report passes V18; the template's section 2 is M0074 verbatim", () => {
  const r = checkFinalReport(filledReport(), ctx());
  assert.deepEqual(r.problems, []);
  assert.ok(TEMPLATE.includes("## 2. Limitation statement\nNeither the number of agents nor their agreement guarantees correctness. The quality mechanism is independent inspection, executed tests, traceability, repair and reproducible evidence.\n"));
  assert.equal(CAP_IDS.length, 12);
});

test("T-M12 every §7.3 rule has a failing fixture", () => {
  const good = filledReport();
  const cap = (id) => good.split("\n").find((l) => l.startsWith(`- **${id}** `) && l.includes(" — check: "));
  const cases = [
    ["placeholder left", good.replace(sealed.report.sourceCommit, "{{SOURCE_COMMIT}}"), 1],
    ["section 2 altered", good.replace("guarantees correctness.", "guarantees correctness in most cases."), 2],
    ["CAP missing", good.replace(`${cap("CAP-07")}\n`, ""), 3],
    ["CAP twice", good.replace(cap("CAP-07"), `${cap("CAP-07")}\n${cap("CAP-07")}`), 3],
    ["result not PASS", good.replace(cap("CAP-10"), cap("CAP-10").replace("result: PASS", "result: FAIL")), 4],
    ["evidence missing", good.replace(`evidence: \`${EVIDENCE.A19}\``, "evidence: `docs/delivery/test-evidence/DG7/qa/none-SYNTHETIC.md`"), 5],
    ["evidence a directory", good.replace(`evidence: \`${EVIDENCE.A19}\``, "evidence: `docs/handover`"), 5],
    ["evidence not listed", good.replace(`evidence: \`${EVIDENCE.A19}\``, "evidence: `docs/delivery/progress.md`"), 5],
    ["checksum mismatch", good.replace(sealed.report.envelopeArchive.archiveSha256, "f".repeat(64)), 6],
    ["seven gate lines", good.replace(/^- DG7: .*\n/m, ""), 7],
    ["L4 hit", good.replace("## 7. ", "- SYNTHETIC: the Mobily IT approval was recorded for this release.\n\n## 7. "), 8],
  ];
  for (const [name, text, rule] of cases) {
    assert.ok(text !== good, `${name}: the fixture changed`);
    assert.ok(rulesOf(text).includes(rule), `${name}: rule ${rule} expected, got ${JSON.stringify(checkFinalReport(text, ctx()).problems)}`);
  }
  assert.ok(existsSync(join(clone.dir, "docs/delivery/progress.md")), "the not-listed fixture names an existing file");
});

test("T-M12 R12 through verify-seal: V18 fails for a missing evidence path and for an altered section 2", async () => {
  const run = async (text) => {
    const p = join(clone.dir, SEAL_DIR, `final-report-r12-${++n}.md`);
    writeFileSync(p, text);
    return verifySeal({
      envelope: sealed.envelopePath,
      expectSha256: sealed.report.envelopeArchive.archiveSha256,
      repo: clone.dir,
      finalReport: p,
      rehearsal: true,
      historicalStages: ["DG7"], // V16 is T-M11's and R0's; here only DG7 (SKIPPED) keeps the case short
      writeReport: false,
    });
  };
  const good = filledReport();
  const pass = await run(good);
  assert.equal(pass.checks.find((c) => c.id === "V18").status, "PASS", JSON.stringify(pass.checks.filter((c) => !c.ok), null, 1));
  assert.equal(pass.checks.find((c) => c.id === "V16").status, "SKIPPED");
  assert.equal(pass.verdict, "REHEARSAL-PASS");
  const a = await run(good.replace(`evidence: \`${EVIDENCE.A19}\``, "evidence: `docs/delivery/test-evidence/DG7/qa/none-SYNTHETIC.md`"));
  assert.deepEqual(failedIds(a), ["V18"]);
  assert.match(a.checks.find((c) => c.id === "V18").detail, /rule 5: CAP-10 evidence .* does not exist/);
  const b = await run(good.replace("traceability, repair", "traceability and repair"));
  assert.deepEqual(failedIds(b), ["V18"]);
  assert.match(b.checks.find((c) => c.id === "V18").detail, /rule 2: section 2 differs from the template/);
  assert.equal(b.exit, 1);
});

test("T-M12 the template's section 8 guides exist in the tree (DOC-B's guides: strict with MTH_STRICT_GUIDES=1)", (t) => {
  const paths = guidePaths(TEMPLATE);
  assert.deepEqual(paths, [
    "docs/handover/deployment.md",
    "docs/handover/operator-guide.md",
    "docs/handover/known-limitations.md",
    "docs/handover/release-notes.md",
  ]);
  const missing = paths.filter((p) => !existsSync(join(REPO, p)));
  if (missing.length === 0) return;
  const message = `missing guide(s), reported to the orchestrator: ${missing.join(", ")}`;
  // ADR-0073 §7.1: a guide missing AT THE FREEZE fails this test. Before DOC-B (W9) and AN-P7's release-notes run (W12)
  // the gap is expected; it is shown as a TODO with the list, and the freeze verification sets MTH_STRICT_GUIDES=1.
  if (process.env.MTH_STRICT_GUIDES === "1") assert.fail(message);
  t.todo(message);
});
