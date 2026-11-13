#!/usr/bin/env node
// The A28 check (ADR-0073 §5; REQ-DLV-041, REQ-S20-028, REQ-DLV-031). Node 24, no dependency, no network.
//
//   node tools/release/verify-seal.mjs --envelope <envelope.tar.gz> --expect-sha256 <hex> \
//     [--repo <dir>] [--final-report <file>] [--rehearsal] [--out <dir>]
//
// Archive mode (always): V1–V14 on the envelope alone, read in memory. Repository mode (--repo): V15–V17.
// Final-report mode (--final-report, needs --repo): V18. Exit 0 PASS or REHEARSAL-PASS, 1 FAIL, 2 BLOCKED.
// A check that could not run is BLOCKED with its reason, never PASS. REHEARSAL-PASS is not PASS and never counts as A28.
// Verification is an engineering packaging check: it grants no business, Finance or IT approval, and product gate G6
// and engineering gate DG7 do not imply each other.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { APPROVED_SPEC, candidateId, manifestFromWorkingTree } from "../gates/lib/candidate.mjs";
import { parseRegister } from "../../apps/api/scripts/register-snapshot.mjs";
import { ArchiveError, verifyArchive } from "./build-archive.mjs";
import { scanClaims } from "./claims-scan.mjs";
import { DEFAULT_OUT, latestSequence, outputPathAllowed, REPO } from "./seal.mjs";
import { scanSecrets } from "./secret-scan.mjs";
import {
  AGENT_NAMES,
  FINDINGS_PATH,
  MANIFEST_KEYS,
  REGISTER_PATH,
  REQUIRED_EVIDENCE,
  STAGES,
  STATEMENT,
  envelopeName,
  isSafeRelPath,
  manifestPaths,
  readmeText,
  sha256,
} from "./lib/envelope.mjs";
import { checkFinalReport } from "./lib/final-report.mjs";
import { checkGateLabels, parseNdjson } from "./lib/gate-labels.mjs";
import { gunzipArchive, readTar } from "./lib/tar.mjs";

export const TEMPLATE_PATH = "docs/handover/final-report.template.md";
export const SEAL_DIR = "docs/delivery/test-evidence/DG7/seal/";
const CHECK_IDS = Array.from({ length: 18 }, (_, k) => `V${k + 1}`);

class VerifyBlocked extends Error {}

/** Files of a gzip tar in memory: { top, tops, files: Map<rest, entry>, entries }. Throws when unreadable. */
function openArchive(bytes) {
  const entries = [...readTar(gunzipArchive(bytes))];
  const tops = new Set(entries.map((e) => e.path.split("/")[0]));
  const top = [...tops][0] ?? "";
  const files = new Map();
  for (const e of entries) if (e.type === "file") files.set(e.path.slice(top.length + 1), e);
  return { top, tops, files, entries };
}

const parseJson = (buf) => {
  try {
    return JSON.parse(Buffer.from(buf).toString("utf8"));
  } catch {
    return undefined;
  }
};

/** Whether `repo` is a sparse checkout (the rehearsal's scratch clone, ADR-0073 §8.1). */
function isSparse(repo) {
  const r = spawnSync("git", ["-C", repo, "config", "--bool", "core.sparseCheckout"], { encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() === "true";
}

/**
 * V16: `node tools/gates/validate.mjs --historical --stage DGx` per gate, each a child process (ADR-0073 §5.2).
 * In a rehearsal DG7 is SKIPPED (synthetic record). A non-zero exit FAILs, except in a rehearsal on a sparse clone,
 * where the validator cannot see the META-excluded directories the clone omits (ADR-0073 Residual 2): that is BLOCKED
 * with the reason. A validator that cannot be started is BLOCKED. Nothing here is ever reported PASS without an exit 0.
 * @returns {{ status: "PASS"|"FAIL"|"BLOCKED", runs: { stage, status, exit, tail, reason? }[], allowedInRehearsal: boolean }}
 */
export function historicalValidation({ repo, rehearsal, stages = STAGES, timeoutMs = 900_000 }) {
  const validator = join(repo, "tools", "gates", "validate.mjs");
  const sparse = rehearsal && isSparse(repo);
  const runs = [];
  for (const stage of stages) {
    if (rehearsal && stage === "DG7") {
      runs.push({ stage, status: "SKIPPED", exit: null, tail: "", reason: "rehearsal: synthetic gate record" });
      continue;
    }
    if (!existsSync(validator)) {
      runs.push({ stage, status: "BLOCKED", exit: null, tail: "", reason: `${validator} not found` });
      continue;
    }
    const r = spawnSync(process.execPath, [validator, "--historical", "--stage", stage], {
      cwd: repo,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 1 << 26,
    });
    const tail = `${r.stdout ?? ""}${r.stderr ?? ""}`.trimEnd().split("\n").slice(-6).join("\n");
    if (r.error || r.status === null) {
      runs.push({ stage, status: "BLOCKED", exit: r.status, tail, reason: `validate.mjs did not run to completion (${r.error?.code ?? r.signal ?? "no exit status"})` });
    } else if (r.status === 0) runs.push({ stage, status: "PASS", exit: 0, tail });
    else if (sparse)
      runs.push({
        stage,
        status: "BLOCKED",
        exit: r.status,
        tail,
        reason: "rehearsal on a sparse clone: the clone omits docs/delivery/{test-evidence,handbacks,runs}/ (ADR-0073 §8.1, Residual 2), so the historical validation cannot see its evidence; the real seal runs it in the full repository",
      });
    else runs.push({ stage, status: "FAIL", exit: r.status, tail });
  }
  const status = runs.some((x) => x.status === "FAIL")
    ? "FAIL"
    : runs.some((x) => x.status === "BLOCKED")
      ? "BLOCKED"
      : runs.some((x) => x.status === "PASS")
        ? "PASS"
        : "SKIPPED"; // every run skipped: never reported as PASS
  const allowedInRehearsal = runs.every((x) => x.status !== "BLOCKED" || x.reason?.startsWith("rehearsal on a sparse clone"));
  return { status, runs, allowedInRehearsal };
}

/**
 * Module API: verifySeal({ envelope, expectSha256, repo, finalReport, rehearsal, out, writeReport, historicalStages,
 *                         secretAllowlist })
 * `historicalStages` (default DG0–DG7) and `secretAllowlist` (default DO-B's file) are module-only test seams.
 *   → Promise<{ verdict: "PASS"|"REHEARSAL-PASS"|"FAIL"|"BLOCKED", checks: { id, ok, status, detail }[], exit, lines,
 *               report, reportPath }>
 */
export async function verifySeal(options = {}) {
  const { envelope, expectSha256, finalReport, historicalStages } = options;
  const rehearsal = Boolean(options.rehearsal);
  const repo = options.repo ? resolve(options.repo) : null;
  const lines = [];
  const checks = new Map();
  const set = (id, status, detail = "", extra = {}) => checks.set(id, { id, ok: status === "PASS" || status === "SKIPPED", status, detail, ...extra });
  const pass = (id, detail = "") => set(id, "PASS", detail);
  const fail = (id, detail) => set(id, "FAIL", detail);
  const judge = (id, problems, okDetail = "") => (problems.length ? fail(id, problems.slice(0, 6).join("; ") + (problems.length > 6 ? `; … ${problems.length} problems` : "")) : pass(id, okDetail));
  const scratch = [];
  const finish = (verdict, exit, extraLines = []) => {
    lines.push(...extraLines);
    return { verdict, exit, lines, checks: CHECK_IDS.filter((id) => checks.has(id)).map((id) => checks.get(id)) };
  };
  try {
    if (!envelope) throw new VerifyBlocked("--envelope <file> is required");
    if (!/^[0-9a-f]{64}$/.test(expectSha256 ?? "")) throw new VerifyBlocked("--expect-sha256 <64 hex> is required");
    if (finalReport && !repo) throw new VerifyBlocked("--final-report needs --repo (V18 checks evidence paths in the sealed repository)");
    const outDir = resolve(repo ?? REPO, options.out ?? DEFAULT_OUT);
    if (options.writeReport !== false && !outputPathAllowed(repo ?? REPO, outDir))
      return finish("BLOCKED", 2, [`verify-seal: refused output path ${outDir}: it would change the payload hash`]);
    let bytes;
    try {
      bytes = readFileSync(envelope);
    } catch (e) {
      throw new VerifyBlocked(`cannot read ${envelope} (${e.code ?? e.message})`);
    }
    let env;
    try {
      env = openArchive(bytes);
    } catch (e) {
      throw new VerifyBlocked(`${envelope} is not a readable gzip tar (${e.code === "NOT_GZIP" ? "not gzip" : e.message})`);
    }
    const envelopeSha256 = sha256(bytes);
    const file = (p) => env.files.get(p)?.data;
    const ev = (p) => file(`evidence/${p}`);

    // V1
    if (envelopeSha256 === expectSha256) pass("V1", `sha256 ${envelopeSha256}`);
    else fail("V1", `sha256 ${envelopeSha256}, expected ${expectSha256}`);

    const manifestBytes = file("ENVELOPE-MANIFEST.json");
    const m = manifestBytes ? parseJson(manifestBytes) : undefined;

    // V2
    {
      const p = [];
      const want = m ? envelopeName(m.version, m.rehearsal === true) : null;
      if (env.tops.size !== 1) p.push(`${env.tops.size} top-level entries`);
      else if (!want) p.push("ENVELOPE-MANIFEST.json missing or invalid");
      else if (env.top !== want) p.push(`named ${env.top}, expected ${want}`);
      if (!env.entries.some((e) => e.type === "dir" && e.path === env.top)) p.push("no top-level directory entry");
      const sums = file("SHA256SUMS");
      if (!sums) p.push("SHA256SUMS missing");
      else {
        const listed = new Map();
        for (const line of sums.toString("utf8").split("\n")) {
          if (!line) continue;
          const mm = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
          if (!mm) p.push(`bad SHA256SUMS line ${JSON.stringify(line.slice(0, 80))}`);
          else listed.set(mm[2], mm[1]);
        }
        for (const [path, e] of env.files) {
          if (path === "SHA256SUMS") continue;
          if (!listed.has(path)) p.push(`${path} not in SHA256SUMS`);
          else if (listed.get(path) !== sha256(e.data)) p.push(`${path} hash mismatch`);
        }
        for (const path of listed.keys()) if (!env.files.has(path)) p.push(`${path} listed but missing`);
      }
      judge("V2", p, `${env.files.size} files`);
    }

    // V3
    const listedPaths = new Map();
    {
      const p = [];
      if (!m) p.push("ENVELOPE-MANIFEST.json missing or not JSON");
      else {
        if (m.schemaVersion !== 1 || m.kind !== "mth-release-envelope") p.push("schemaVersion/kind is not 1/mth-release-envelope");
        if (Object.keys(m).join(",") !== MANIFEST_KEYS.join(",")) p.push("top-level keys are not in the §3.4 order");
        for (const e of manifestPaths(m)) {
          if (!isSafeRelPath(e.path)) {
            p.push(`unsafe path ${JSON.stringify(e.path)}`);
            continue;
          }
          listedPaths.set(e.path, e);
          const data = ev(e.path);
          if (!data) p.push(`${e.path} listed but not under evidence/`);
          else if (sha256(data) !== e.sha256) p.push(`${e.path} does not match its manifest sha256`);
        }
        for (const path of env.files.keys())
          if (path.startsWith("evidence/") && !listedPaths.has(path.slice("evidence/".length))) p.push(`${path} is not listed in the manifest`);
        const readme = file("README.txt");
        if (!readme || readme.toString("utf8") !== readmeText(m.version, m.payload?.hash)) p.push("README.txt is not the §3.6 text");
      }
      judge("V3", p, `${listedPaths.size} listed files present and matching`);
    }

    // V4 (and the payload archive's files, for V8, V9, V12, V13)
    let payload = null;
    {
      const p = [];
      const name = m?.payload?.archive?.name;
      const data = name ? file(`payload/${name}`) : undefined;
      const payloadEntries = [...env.files.keys()].filter((x) => x.startsWith("payload/"));
      if (!name || !data) p.push(`payload/${name ?? "<name>"} missing`);
      else {
        if (payloadEntries.length !== 2) p.push(`payload/ holds ${payloadEntries.length} files, expected the archive and its .sha256`);
        const line = file(`payload/${name}.sha256`)?.toString("utf8");
        if (line !== `${m.payload.archive.archiveSha256}  ${name}\n`) p.push(`payload/${name}.sha256 does not state the manifest's archive checksum`);
        const work = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "mth-verify-"));
        scratch.push(work);
        const tmpArchive = join(work, name);
        writeFileSync(tmpArchive, data);
        try {
          const r = await verifyArchive(tmpArchive, { expectSha256: m.payload.archive.archiveSha256, candidate: m.payload.hash });
          for (const c of r.checks) if (!c.ok) p.push(`payload ${c.id}: ${c.detail}`);
        } catch (e) {
          p.push(e instanceof ArchiveError ? e.message : `payload archive: ${e.message}`);
        }
        rmSync(tmpArchive, { force: true });
        try {
          payload = openArchive(data);
        } catch (e) {
          p.push(`payload archive unreadable (${e.message})`);
        }
      }
      judge("V4", p, "the payload archive passes all seven archive checks with the manifest's checksum and payload hash");
    }
    const src = (p) => payload?.files.get(`source/${p}`)?.data;

    // Gate records from the envelope.
    const gates = STAGES.map((stage) => {
      const path = `docs/delivery/gates/${stage}.json`;
      const data = ev(path);
      return { stage, path, data, record: data ? parseJson(data) : undefined };
    });
    const dg7 = gates[7].record;

    // V5
    if (!dg7) fail("V5", "evidence/docs/delivery/gates/DG7.json missing or not JSON");
    else if (dg7.candidate_id !== m?.payload?.hash) fail("V5", `payload hash ${m?.payload?.hash} is not the DG7 candidate_id ${dg7.candidate_id}`);
    else pass("V5", `payload hash equals the DG7 candidate_id ${dg7.candidate_id}`);

    // V6
    {
      const p = [];
      const listedGates = (m?.gates ?? []).map((g) => g.stage).join(",");
      if (listedGates !== STAGES.join(",")) p.push(`manifest lists gates ${listedGates || "none"}, expected DG0–DG7`);
      gates.forEach((g, k) => {
        if (!g.data) return p.push(`${g.path} missing`);
        if (!g.record) return p.push(`${g.path} is not JSON`);
        if (g.record.decision !== "APPROVED") p.push(`${g.stage} decision ${g.record.decision}`);
        const prev = k === 0 ? null : STAGES[k - 1];
        if (g.record.previous_gate !== prev) p.push(`${g.stage} previous_gate ${JSON.stringify(g.record.previous_gate)}, expected ${JSON.stringify(prev)}`);
        const mp = g.record.manifest_path;
        const mdata = typeof mp === "string" ? ev(mp) : undefined;
        if (!mdata) p.push(`${g.stage} manifest_path ${mp} not in the envelope`);
        else if (parseJson(mdata)?.candidate_id !== g.record.candidate_id) p.push(`${g.stage} candidate manifest names another candidate_id`);
      });
      judge("V6", p, "eight APPROVED gate records DG0–DG7 in chain, each with its candidate manifest");
    }

    // V7
    {
      const p = [];
      let n = 0;
      for (const g of gates) {
        if (!g.record) continue;
        const cited = [...Object.values(g.record.reviews ?? {}), g.record.release_audit].filter((x) => typeof x === "string");
        if (cited.length === 0) p.push(`${g.stage} cites no review record`);
        for (const path of cited) {
          n++;
          const data = ev(path);
          const r = data ? parseJson(data) : undefined;
          if (!data) p.push(`${path} (cited by ${g.stage}) not in the envelope`);
          else if (!r) p.push(`${path} is not JSON`);
          else if (r.candidate_id !== g.record.candidate_id) p.push(`${path} candidate_id ${r.candidate_id} is not ${g.stage}'s ${g.record.candidate_id}`);
        }
      }
      judge("V7", p, `${n} cited review records present, each naming its gate's candidate`);
    }

    // V8
    {
      const p = [];
      const names = (m?.agentDefinitions ?? []).map((a) => a.name);
      if (names.join(",") !== AGENT_NAMES.join(",")) p.push(`agent definitions ${names.join(",") || "none"}, expected the ten of §3.1`);
      for (const name of AGENT_NAMES) {
        const path = `.claude/agents/${name}.md`;
        const a = ev(path);
        const b = src(path);
        if (!a) p.push(`${path} not in the envelope`);
        else if (!b) p.push(`${path} not in the payload archive`);
        else if (!a.equals(b)) p.push(`${path} differs from the payload archive's source/${path}`);
      }
      judge("V8", p, "the ten agent definitions equal the payload's");
    }

    // V9
    {
      const p = [];
      const a = ev(REGISTER_PATH);
      const b = src(REGISTER_PATH);
      if (!a) p.push(`${REGISTER_PATH} not in the envelope`);
      else if (!b) p.push(`${REGISTER_PATH} not in the payload archive`);
      else if (!a.equals(b)) p.push(`${REGISTER_PATH} differs from the payload archive's source/${REGISTER_PATH}`);
      if (a) {
        try {
          const rows = parseRegister(a).rows.length;
          if (rows !== m?.register?.rows) p.push(`register has ${rows} rows, the manifest says ${m?.register?.rows}`);
        } catch (e) {
          p.push(`register does not parse (${e.message})`);
        }
      }
      judge("V9", p, `register equals the payload's, ${m?.register?.rows} rows with unique ids`);
    }

    // V10
    let findingsSummary = null;
    {
      const p = [];
      const data = ev(FINDINGS_PATH);
      const f = data ? parseJson(data) : undefined;
      if (!data) p.push(`${FINDINGS_PATH} not in the envelope`);
      else if (sha256(data) !== m?.findings?.sha256) p.push(`${FINDINGS_PATH} does not match the manifest`);
      else if (!f) p.push(`${FINDINGS_PATH} is not JSON`);
      else {
        const list = Array.isArray(f) ? f : f.findings;
        if (!Array.isArray(list)) p.push(`${FINDINGS_PATH} holds no findings array`);
        else {
          findingsSummary = { total: list.length, dg7ByStatus: {} };
          for (const x of list.filter((y) => y?.stage_id === "DG7")) {
            const s = String(x.status ?? "unknown");
            findingsSummary.dg7ByStatus[s] = (findingsSummary.dg7ByStatus[s] ?? 0) + 1;
          }
        }
      }
      judge("V10", p, findingsSummary ? `${findingsSummary.total} findings; DG7 by status ${JSON.stringify(findingsSummary.dg7ByStatus)} (recorded, not re-judged)` : "");
    }

    // V11
    {
      const keys = new Set((m?.evidence ?? []).map((e) => e.key));
      const missing = REQUIRED_EVIDENCE.filter((k) => !keys.has(k));
      judge("V11", missing.map((k) => `evidence key ${k} missing`), `required evidence keys ${REQUIRED_EVIDENCE.join(", ")} present`);
    }

    // V12
    {
      const demoTables = [];
      for (const [path, e] of payload?.files ?? []) {
        const mm = /^demo-data\/tables\/([^/]+)\.ndjson$/.exec(path);
        if (!mm) continue;
        try {
          demoTables.push({ table: mm[1], rows: parseNdjson(e.data.toString("utf8")) });
        } catch {
          demoTables.push({ table: mm[1], rows: [{ gate_code: { unreadable: path } }] });
        }
      }
      const r = checkGateLabels({
        gates: gates.filter((g) => g.record).map((g) => ({ path: g.path, record: g.record })),
        manifest: m ?? null,
        texts: [{ label: "README.txt", text: file("README.txt")?.toString("utf8") ?? "", rules: ["L3"] }],
        demoTables,
      });
      judge("V12", r.hits.map((h) => `${h.rule} ${h.where}: ${h.detail.slice(0, 160)}`), `L1–L5 pass (${demoTables.length} demo-data tables)`);
    }

    // V13
    {
      const p = [];
      const work = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "mth-verify-scan-"));
      scratch.push(work);
      const tree = join(work, "tree");
      const list = [];
      for (const [path, e] of env.files) {
        if (path.startsWith("payload/")) continue; // the payload archive is scanned through its docs/ (claims) and was secret-scanned as a payload
        const rel = path.startsWith("evidence/") ? path.slice("evidence/".length) : `ENVELOPE/${path}`;
        if (!isSafeRelPath(rel)) continue;
        mkdirSync(dirname(join(tree, rel)), { recursive: true });
        writeFileSync(join(tree, rel), e.data);
        list.push(rel);
      }
      const listFile = join(work, "list.json");
      writeFileSync(listFile, JSON.stringify(list));
      try {
        const s = await scanSecrets({ scope: "envelope", repo: tree, list: listFile, ...(options.secretAllowlist ? { allowlist: options.secretAllowlist } : {}) });
        for (const h of s.hits) p.push(`secret ${h.rule} ${h.path}:${h.line}: ${h.masked}`);
        for (const x of s.stale) p.push(`secret-scan stale allow-list entry ${x.n} (${x.path})`);
      } catch (e) {
        p.push(`secret scan could not run: ${e.message}`);
      }
      const docs = join(work, "payload-docs");
      for (const [path, e] of payload?.files ?? []) {
        if (!path.startsWith("docs/")) continue;
        mkdirSync(dirname(join(docs, path)), { recursive: true });
        writeFileSync(join(docs, path), e.data);
      }
      if (existsSync(join(docs, "docs"))) {
        try {
          const c = await scanClaims({ repo: repo ?? REPO, roots: [join(docs, "docs")] });
          for (const h of c.hits) p.push(`claims ${h.rule} ${h.path.slice(h.path.indexOf("/docs/") + 1)}:${h.line}: ${String(h.sentence).slice(0, 120)}`);
          for (const x of c.stale) p.push(`claims-scan stale allow-list entry ${x.n} (${x.path})`);
        } catch (e) {
          p.push(`claims scan could not run: ${e.message}`);
        }
      } else if (payload) p.push("the payload archive has no docs/");
      rmSync(work, { recursive: true, force: true });
      judge("V13", p, `secret scan of ${list.length} envelope files and claims scan of the payload docs/: no hit`);
    }

    // V14
    {
      const p = [];
      const marked = gates.filter((g) => g.record && Object.hasOwn(g.record, "synthetic_rehearsal")).map((g) => g.stage);
      if (!rehearsal) {
        if (m?.rehearsal !== false) p.push("a release verification refuses a rehearsal envelope (manifest rehearsal is not false)");
        if (marked.length) p.push(`a release verification refuses synthetic gate records: ${marked.join(", ")}`);
      } else {
        if (m?.rehearsal !== true) p.push("a rehearsal verification requires a rehearsal envelope");
        if (dg7?.synthetic_rehearsal !== true) p.push("a rehearsal verification requires the synthetic DG7 marker");
        const wrong = marked.filter((s) => s !== "DG7");
        if (wrong.length) p.push(`synthetic marker on ${wrong.join(", ")}`);
      }
      judge("V14", p, rehearsal ? "rehearsal envelope with the synthetic DG7 marker" : "release envelope without a synthetic marker");
    }

    // V15–V17 (repository mode)
    let historical = null;
    let sealReport = null;
    if (repo) {
      {
        const p = [];
        try {
          const id = candidateId(manifestFromWorkingTree(repo, APPROVED_SPEC));
          if (id !== m?.payload?.hash) p.push(`the working tree hashes to ${id}, not the payload hash ${m?.payload?.hash}`);
        } catch (e) {
          p.push(`no candidate manifest for ${repo} (${String(e.message).split("\n")[0]})`);
        }
        for (const path of listedPaths.keys()) {
          const abs = join(repo, path);
          if (!existsSync(abs) || !lstatSync(abs).isFile()) p.push(`${path} missing in the repository`);
          else if (!readFileSync(abs).equals(ev(path) ?? Buffer.alloc(0))) p.push(`${path} differs from the repository`);
        }
        judge("V15", p, "the working tree hashes to the payload hash; every evidence file equals the repository's");
      }
      historical = historicalValidation({ repo, rehearsal, stages: historicalStages ?? STAGES });
      set(
        "V16",
        historical.status,
        historical.runs.map((r) => `${r.stage} ${r.status}${r.exit === null ? "" : ` (exit ${r.exit})`}${r.reason ? `: ${r.reason}` : ""}`).join("; "),
        { runs: historical.runs, allowedInRehearsal: historical.allowedInRehearsal },
      );
      {
        const p = [];
        const n = latestSequence(outDir, "seal-report");
        sealReport = n ? parseJson(readFileSync(join(outDir, `seal-report-${n}.json`))) : null;
        if (!sealReport) p.push(`no seal report in ${outDir}`);
        else {
          if (sealReport.payloadHash !== m?.payload?.hash) p.push(`seal-report-${n} payloadHash ${sealReport.payloadHash} is not ${m?.payload?.hash}`);
          if (sealReport.envelopeArchive?.archiveSha256 !== envelopeSha256)
            p.push(`seal-report-${n} envelope archive sha256 ${sealReport.envelopeArchive?.archiveSha256} is not this envelope's ${envelopeSha256}`);
          if (sealReport.envelopeManifestSha256 !== (manifestBytes ? sha256(manifestBytes) : null))
            p.push(`seal-report-${n} envelopeManifestSha256 is not this envelope's`);
        }
        judge("V17", p, sealReport ? `seal-report-${n} names this payload hash, envelope checksum and manifest` : "");
      }
    }

    // V18 (final-report mode)
    if (finalReport) {
      let text;
      let template;
      try {
        text = readFileSync(resolve(finalReport), "utf8");
        template = readFileSync(join(repo, TEMPLATE_PATH), "utf8");
      } catch (e) {
        set("V18", "BLOCKED", `cannot read the final report or ${TEMPLATE_PATH} (${e.code ?? e.message})`);
      }
      if (text !== undefined && template !== undefined) {
        const r = checkFinalReport(text, {
          template,
          sealReport,
          isListed: (p) => listedPaths.has(p) || p.startsWith(SEAL_DIR) || Boolean(src(p)),
          fileKind: (p) => {
            if (!isSafeRelPath(p)) return "missing";
            const abs = join(repo, p);
            if (!existsSync(abs)) return "missing";
            const st = lstatSync(abs);
            return st.isFile() ? "file" : st.isDirectory() ? "dir" : "missing";
          },
        });
        judge("V18", r.problems.map((x) => `rule ${x.rule}: ${x.detail}`), "the final report meets §7.3 rules 1–8");
      }
    }

    // Verdict
    const all = CHECK_IDS.filter((id) => checks.has(id)).map((id) => checks.get(id));
    const failed = all.filter((c) => c.status === "FAIL");
    const blocked = all.filter((c) => c.status === "BLOCKED" && !(rehearsal && c.id === "V16" && c.allowedInRehearsal));
    let verdict;
    let exit;
    const out = [];
    if (failed.length) {
      for (const c of failed) out.push(`verify-seal: ${c.id} FAIL ${c.detail}`);
      out.push(`verify-seal: FAIL (${failed.length} checks)`);
      verdict = "FAIL";
      exit = 1;
    } else if (blocked.length) {
      for (const c of blocked) out.push(`verify-seal: BLOCKED: ${c.id} ${c.detail}`);
      verdict = "BLOCKED";
      exit = 2;
    } else if (rehearsal) {
      out.push("verify-seal: REHEARSAL-PASS (not a release verification; DG7 historical validation skipped: synthetic gate record)");
      verdict = "REHEARSAL-PASS";
      exit = 0;
    } else {
      out.push("verify-seal: PASS");
      verdict = "PASS";
      exit = 0;
    }
    const res = finish(verdict, exit, out);
    if (options.writeReport !== false) {
      mkdirSync(outDir, { recursive: true });
      const n = latestSequence(outDir, "verify-report") + 1;
      const reportPath = join(outDir, `verify-report-${n}.json`);
      res.report = {
        schemaVersion: 1,
        kind: "mth-verify-report",
        rehearsal,
        sequence: n,
        verdict,
        modes: { archive: true, repository: Boolean(repo), finalReport: Boolean(finalReport) },
        declarationEligible: verdict === "PASS" && Boolean(repo) && Boolean(finalReport),
        envelope: { name: env.top, archiveSha256: envelopeSha256, expectSha256 },
        payloadHash: m?.payload?.hash ?? null,
        findings: findingsSummary,
        checks: res.checks,
        tool: { node: process.version, verifySealSha256: sha256(readFileSync(fileURLToPath(import.meta.url))) },
        verifiedAt: new Date().toISOString(),
        statement: STATEMENT,
      };
      writeFileSync(reportPath, `${JSON.stringify(res.report, null, 2)}\n`, { flag: "wx" });
      res.reportPath = reportPath;
    }
    return res;
  } catch (e) {
    if (e instanceof VerifyBlocked) return finish("BLOCKED", 2, [`verify-seal: BLOCKED: ${e.message}`]);
    throw e;
  } finally {
    for (const d of scratch) rmSync(d, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const o = { rehearsal: false };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === "--rehearsal") o.rehearsal = true;
    else if (["--envelope", "--expect-sha256", "--repo", "--final-report", "--out"].includes(a)) {
      const v = argv[k + 1];
      if (v === undefined || v.startsWith("--")) return { error: `${a} needs a value` };
      o[a.slice(2).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())] = v;
      k++;
    } else return { error: `unknown argument ${a}` };
  }
  return o;
}

async function main(argv) {
  const o = parseArgs(argv);
  if (o.error) {
    console.log(`verify-seal: BLOCKED: ${o.error}`);
    return 2;
  }
  const r = await verifySeal(o);
  for (const c of r.checks) console.log(`verify-seal: ${c.id} ${c.status} ${c.detail}`.trimEnd());
  for (const l of r.lines) console.log(l);
  if (r.reportPath) console.log(`verify-seal: report ${r.reportPath}`);
  console.log(`verify-seal: ${STATEMENT}`);
  return r.exit;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
