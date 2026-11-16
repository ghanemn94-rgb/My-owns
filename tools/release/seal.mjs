#!/usr/bin/env node
// Release seal (ADR-0073 §4; REQ-DLV-041, REQ-S20-028). Node 24, no dependency, no network.
//
//   node tools/release/seal.mjs --candidate sha256:<64 hex> \
//     --demo-data <dir> --demo-data-sha256 <64 hex> \
//     --evidence A18=<path> --evidence A19=<path> --evidence A26=<path> --evidence A27=<path> \
//     --evidence test-level-index=<path> --evidence protocol-audit=<path> \
//     [--extra <path>]... [--reseal-reason "<text>"] [--rehearsal] [--dist <dir>] [--out <dir>] [--repo <dir>]
//
// Exit codes (p7-work-split §2 rule 4): 0 sealed, 1 FAIL, 2 BLOCKED (missing or invalid input, usage).
// Sealing is an engineering packaging check: it grants no business, Finance or IT approval, product gate G6 does not
// imply DG7, and DG7 does not imply any of G1–G6. The seal never writes under docs/delivery/{gates,reviews}/,
// stages.json, findings.json, progress.md or decisions.md, never commits, never deletes an earlier report, and reads
// delivery records only through the gate records' named paths (D-138).
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { APPROVED_SPEC, META_EXCLUDES, candidateId, diffManifests, manifestFromRef, manifestFromWorkingTree, matchesAny } from "../gates/lib/candidate.mjs";
import { parseRegister } from "../../apps/api/scripts/register-snapshot.mjs";
import { ArchiveError, buildArchive, readDemoData } from "./build-archive.mjs";
import { scanClaims } from "./claims-scan.mjs";
import { scanSecrets } from "./secret-scan.mjs";
import {
  EVIDENCE_DIR,
  REQUIRED_EVIDENCE,
  STAGES,
  STATEMENT,
  buildEnvelopeManifest,
  envelopeList,
  isSafeRelPath,
  packEnvelope,
  sha256,
} from "./lib/envelope.mjs";
import { gunzipArchive, readTar } from "./lib/tar.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "..", "..");
export const DEFAULT_DIST = "dist/release";
export const DEFAULT_OUT = "docs/delivery/test-evidence/DG7/seal";
export const DG7_PATH = "docs/delivery/gates/DG7.json";

/** A refusal: one exact line and its exit code. */
export class SealStop extends Error {
  constructor(exit, line) {
    super(line);
    this.exit = exit;
    this.line = line;
  }
}

const git = (repo, args, opts = {}) => execFileSync("git", ["-C", repo, ...args], { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"], ...opts });
const gitOk = (repo, args) => {
  try {
    git(repo, args);
    return true;
  } catch {
    return false;
  }
};

/** The repository-relative form of `p` (resolved against `repo`), or null when it lies outside the repository. */
export function repoRel(repo, p) {
  const abs = isAbsolute(p) ? p : join(repo, p);
  const rel = relative(resolve(repo), resolve(abs));
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return rel === "" ? "" : null;
  return rel.split(sep).join("/");
}

/**
 * The output-path guard (ADR-0073 §2): an output directory inside the repository must be git-ignored or matched by
 * META_EXCLUDES, so nothing the tools write can change the payload hash. A directory outside the repository cannot.
 * @returns {boolean}
 */
export function outputPathAllowed(repo, dir) {
  const rel = repoRel(repo, dir);
  if (rel === null) return true;
  if (rel === "") return false;
  const probe = `${rel}/seal-output-probe`;
  if (matchesAny(probe, META_EXCLUDES)) return true;
  return gitOk(repo, ["check-ignore", "-q", "--no-index", "--", probe]);
}

/** The next free report sequence number in `outDir` for `prefix` (probes <prefix>-1.json, -2.json, …; no walk). */
export function latestSequence(outDir, prefix) {
  let n = 0;
  while (existsSync(join(outDir, `${prefix}-${n + 1}.json`))) n++;
  return n;
}

function parseArgs(argv) {
  const o = { evidence: {}, extras: [], rehearsal: false };
  const value = (k) => {
    const v = argv[k + 1];
    if (v === undefined || v.startsWith("--")) throw new SealStop(2, `seal: BLOCKED: ${argv[k]} needs a value`);
    return v;
  };
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === "--rehearsal") o.rehearsal = true;
    else if (a === "--evidence") {
      const v = value(k++);
      const eq = v.indexOf("=");
      if (eq <= 0) throw new SealStop(2, `seal: BLOCKED: --evidence needs <key>=<path>, got ${v}`);
      o.evidence[v.slice(0, eq)] = v.slice(eq + 1);
    } else if (a === "--extra") o.extras.push(value(k++));
    else if (["--candidate", "--demo-data", "--demo-data-sha256", "--reseal-reason", "--dist", "--out", "--repo"].includes(a)) {
      const key = a.slice(2).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
      o[key] = value(k++);
    } else throw new SealStop(2, `seal: BLOCKED: unknown argument ${a}`);
  }
  return o;
}

const readJson = (abs) => JSON.parse(readFileSync(abs, "utf8"));

/**
 * The seal (ADR-0073 §4). Module API:
 * seal(options) → Promise<{ ok, exit, report, envelopePath, payloadArchivePath, lines }>.
 * options: { candidate, demoData, demoDataSha256, evidence: { key: path }, extras: [], resealReason, rehearsal, dist, out,
 *            repo, print, secretAllowlist }
 * `secretAllowlist` (module only, no CLI flag) replaces DO-B's tools/release/secret-allowlist.json for the S10 secret
 * scans; the rehearsal tests use it for the envelope-only entries requested from DO-B. The CLI always uses DO-B's file.
 */
export async function seal(options = {}) {
  const lines = [];
  const print = options.print ?? (() => {});
  const say = (l) => {
    lines.push(l);
    print(l);
  };
  const steps = [];
  const step = (id, ok, detail) => {
    steps.push({ id, ok, detail });
    say(`seal: ${id} ${ok ? "ok" : "FAIL"} ${detail}`.trimEnd());
  };
  const result = { ok: false, exit: 2, report: null, envelopePath: null, payloadArchivePath: null, lines };
  const scratch = [];
  try {
    const repo = resolve(options.repo ?? REPO);
    const rehearsal = Boolean(options.rehearsal);
    const evidence = { ...(options.evidence ?? {}) };
    const extras = [...(options.extras ?? [])];
    const candidate = options.candidate;
    if (!/^sha256:[0-9a-f]{64}$/.test(candidate ?? "")) throw new SealStop(2, "seal: BLOCKED: --candidate must be sha256:<64 hex>");
    if (!/^[0-9a-f]{64}$/.test(options.demoDataSha256 ?? "")) throw new SealStop(2, "seal: BLOCKED: --demo-data-sha256 must be <64 hex>");
    if (!options.demoData) throw new SealStop(2, "seal: BLOCKED: --demo-data <dir> is required");
    const dist = resolve(repo, options.dist ?? DEFAULT_DIST);
    const out = resolve(repo, options.out ?? DEFAULT_OUT);
    // The output-path guard and the re-seal rule are checked before any work, so a refusal leaves nothing behind.
    for (const d of [out, dist]) if (!outputPathAllowed(repo, d)) throw new SealStop(2, `seal: refused output path ${d}: it would change the payload hash`);
    const previous = latestSequence(out, "seal-report");
    if (previous > 0 && !options.resealReason)
      throw new SealStop(2, `seal: BLOCKED: ${join(out, `seal-report-${previous}.json`)} exists; a re-seal needs --reseal-reason`);
    const sequence = previous + 1;

    // S1
    const dg7Abs = join(repo, DG7_PATH);
    if (!existsSync(dg7Abs)) throw new SealStop(2, `seal: BLOCKED: ${DG7_PATH} does not exist; DG7 is not approved`);
    let dg7;
    try {
      dg7 = readJson(dg7Abs);
    } catch {
      throw new SealStop(2, "seal: BLOCKED: DG7 decision is unreadable, not APPROVED");
    }
    if (dg7?.decision !== "APPROVED") throw new SealStop(2, `seal: BLOCKED: DG7 decision is ${dg7?.decision ?? "missing"}, not APPROVED`);
    if (dg7.stage_id !== "DG7") throw new SealStop(1, `seal: ${DG7_PATH} has stage_id ${JSON.stringify(dg7.stage_id)}, not DG7 (rule L1)`);
    step("S1", true, `${DG7_PATH} decision APPROVED`);

    // S2
    if (candidate !== dg7.candidate_id) throw new SealStop(1, `seal: --candidate ${candidate} is not the approved DG7 candidate ${dg7.candidate_id}`);
    step("S2", true, `--candidate equals the DG7 record's candidate_id`);

    // S3
    const sourceCommit = dg7.source_commit;
    if (!/^[0-9a-f]{40}$/.test(sourceCommit ?? "")) throw new SealStop(2, "seal: BLOCKED: the DG7 record's source_commit is not a 40-hex commit id");
    let approved;
    try {
      approved = manifestFromRef(repo, sourceCommit, APPROVED_SPEC);
    } catch (e) {
      throw new SealStop(2, `seal: BLOCKED: cannot read ${sourceCommit} (${String(e.message).split("\n")[0]})`);
    }
    const atCommit = candidateId(approved);
    if (atCommit !== candidate) throw new SealStop(1, `seal: the files at ${sourceCommit} hash to ${atCommit}, not the approved ${candidate}`);
    step("S3", true, `the files at ${sourceCommit} hash to ${candidate}`);

    // S4 (and S12)
    const driftCheck = (id) => {
      const tree = manifestFromWorkingTree(repo, APPROVED_SPEC);
      const now = candidateId(tree);
      if (now !== candidate) {
        const d = diffManifests(approved, tree);
        throw new SealStop(
          1,
          `seal: the working tree payload differs from the approved candidate (${d.changed.length} changed, ${d.added.length} added, ${d.removed.length} removed); a payload change requires a new candidate and new reviews (master prompt l.621)`,
        );
      }
      step(id, true, `the working tree payload hashes to ${candidate}`);
    };
    driftCheck("S4");

    // S5: mode markers (§8.2).
    const gates = [];
    for (const stage of STAGES) {
      const path = `docs/delivery/gates/${stage}.json`;
      let record = null;
      try {
        record = readJson(join(repo, path));
      } catch {
        /* missing or unreadable: S6 refuses it */
      }
      gates.push({ stage, path, record });
    }
    for (const g of gates) {
      if (!g.record) continue;
      const synthetic = Object.hasOwn(g.record, "synthetic_rehearsal");
      if (!rehearsal && synthetic) throw new SealStop(1, `seal: a release seal refuses a synthetic gate record: ${g.path}`);
      if (rehearsal && g.stage !== "DG7" && synthetic) throw new SealStop(1, `seal: a rehearsal seal refuses a synthetic marker on ${g.path}`);
    }
    if (rehearsal && dg7.synthetic_rehearsal !== true) throw new SealStop(1, "seal: a rehearsal requires a synthetic DG7 gate record");
    step("S5", true, rehearsal ? "rehearsal: DG7 carries the synthetic marker, DG0–DG6 do not" : "release: no gate record carries a synthetic marker");

    // S6: the §3.1 list.
    for (const key of REQUIRED_EVIDENCE) if (!evidence[key]) throw new SealStop(2, `seal: BLOCKED: missing --evidence ${key}`);
    for (const [key, p] of Object.entries(evidence)) {
      const rel = repoRel(repo, p);
      const abs = rel === null ? null : join(repo, rel);
      if (rel === null || !isSafeRelPath(rel) || !rel.startsWith(EVIDENCE_DIR) || !existsSync(abs) || !lstatSync(abs).isFile())
        throw new SealStop(2, `seal: BLOCKED: --evidence ${key} must be a file under ${EVIDENCE_DIR}`);
      evidence[key] = rel;
    }
    for (let k = 0; k < extras.length; k++) {
      const rel = repoRel(repo, extras[k]);
      if (rel === null || !isSafeRelPath(rel) || !/^docs\/delivery\/(test-evidence|reviews)\//.test(rel))
        throw new SealStop(2, `seal: BLOCKED: --extra ${extras[k]} must be a file under docs/delivery/test-evidence/ or docs/delivery/reviews/`);
      extras[k] = rel;
    }
    for (const g of gates) if (!g.record) throw new SealStop(2, `seal: BLOCKED: missing gate file ${g.path}`);
    const list = envelopeList({ gates, evidence, extras });
    const files = new Map();
    for (const e of list) {
      if (!isSafeRelPath(e.path)) throw new SealStop(2, `seal: BLOCKED: missing ${e.group} file ${e.path}`);
      if (e.source === "commit") {
        try {
          files.set(e.path, git(repo, ["cat-file", "blob", `${sourceCommit}:${e.path}`]));
        } catch {
          throw new SealStop(2, `seal: BLOCKED: missing ${e.group} file ${e.path}`);
        }
        continue;
      }
      const abs = join(repo, e.path);
      if (!existsSync(abs) || !lstatSync(abs).isFile()) throw new SealStop(2, `seal: BLOCKED: missing ${e.group} file ${e.path}`);
      const tracked = gitOk(repo, ["ls-files", "--error-unmatch", "--", e.path]);
      const clean = tracked && git(repo, ["status", "--porcelain", "--ignored", "--", e.path]).length === 0;
      if (!clean) throw new SealStop(2, `seal: BLOCKED: ${e.path} is not committed or differs from HEAD`);
      files.set(e.path, readFileSync(abs));
    }
    let registerRows;
    try {
      registerRows = parseRegister(files.get("docs/delivery/requirements.csv")).rows.length;
    } catch (e) {
      throw new SealStop(2, `seal: BLOCKED: the register at ${sourceCommit} does not parse (${e.message})`);
    }
    step("S6", true, `${list.length} envelope files (${gates.length} gate records, ${list.filter((e) => e.group === "review").length} review records, ${registerRows} register rows)`);

    // S7
    let demo;
    try {
      demo = readDemoData(resolve(repo, options.demoData), { rehearsal });
    } catch (e) {
      if (e instanceof ArchiveError) throw new SealStop(e.exitCode, `seal: ${e.message.replace(/^build-archive: /, "")}`);
      throw e;
    }
    if (demo.inputSha256 !== options.demoDataSha256)
      throw new SealStop(1, `seal: demo-data input hashes to ${demo.inputSha256}, not the recorded ${options.demoDataSha256}`);
    step("S7", true, `demo-data input sha256 ${demo.inputSha256}`);

    // S8
    let built;
    try {
      built = await buildArchive({ repo, commit: sourceCommit, demoData: resolve(repo, options.demoData), candidate, rehearsal, outDir: dist });
    } catch (e) {
      if (e instanceof ArchiveError) throw new SealStop(e.exitCode, `seal: ${e.message.replace(/^build-archive: /, "")}`);
      throw e;
    }
    const payloadFile = `${built.name}.tar.gz`;
    const payloadBytes = readFileSync(built.archivePath);
    result.payloadArchivePath = built.archivePath;
    step("S8", true, `payload archive ${payloadFile} sha256 ${built.archiveSha256}`);

    // S9
    const version = built.manifest.version;
    const { bytes: manifestBytes } = buildEnvelopeManifest({
      version,
      rehearsal,
      payload: {
        hash: candidate,
        sourceCommit,
        files: approved.length,
        archive: { name: payloadFile, archiveSha256: built.archiveSha256, tarSha256: built.tarSha256 },
        demoDataInputSha256: demo.inputSha256,
      },
      list,
      files,
      registerRows,
    });
    const env = packEnvelope({
      version,
      rehearsal,
      payloadHash: candidate,
      manifestBytes,
      payloadArchive: { name: payloadFile, data: payloadBytes, sha256Line: `${built.archiveSha256}  ${payloadFile}\n` },
      evidence: list.map((e) => ({ path: e.path, data: files.get(e.path) })),
    });
    mkdirSync(dist, { recursive: true });
    const envelopePath = join(dist, `${env.name}.tar.gz`);
    writeFileSync(envelopePath, env.gz);
    writeFileSync(`${envelopePath}.sha256`, `${env.archiveSha256}  ${env.name}.tar.gz\n`);
    result.envelopePath = envelopePath;
    step("S9", true, `envelope archive ${env.name}.tar.gz sha256 ${env.archiveSha256}`);

    // S10: scans.
    const work = mkdtempSync(join(process.env.TMPDIR || tmpdir(), "mth-seal-"));
    scratch.push(work);
    const listFile = join(work, "envelope-list.json");
    writeFileSync(listFile, JSON.stringify(list.map((e) => e.path)));
    const allow = options.secretAllowlist ? { allowlist: options.secretAllowlist } : {};
    const secretEnv = await scanSecrets({ scope: "envelope", repo, list: listFile, ...allow });
    const secretDemo = await scanSecrets({ scope: "path", repo, paths: [resolve(repo, options.demoData)], ...allow });
    const docsRoot = join(work, "payload");
    for (const t of readTar(gunzipArchive(payloadBytes))) {
      if (t.type !== "file") continue;
      const rest = t.path.slice(built.name.length + 1);
      if (!rest.startsWith("docs/")) continue;
      mkdirSync(dirname(join(docsRoot, rest)), { recursive: true });
      writeFileSync(join(docsRoot, rest), t.data);
    }
    const claims = existsSync(join(docsRoot, "docs"))
      ? await scanClaims({ repo, roots: [join(docsRoot, "docs")] })
      : { ok: true, hits: [], stale: [], files: 0 };
    rmSync(docsRoot, { recursive: true, force: true });
    const secretHits = [...secretEnv.hits, ...secretDemo.hits];
    const secretStale = [...secretEnv.stale, ...secretDemo.stale];
    const scans = {
      secret: { files: secretEnv.files + secretDemo.files, hits: secretHits.length + secretStale.length },
      claims: { files: claims.files, hits: claims.hits.length + claims.stale.length },
    };
    for (const h of secretHits) say(`seal: ${h.rule} ${h.path}:${h.line}: ${h.masked} (value sha256 ${h.valueSha256.slice(0, 12)})`);
    for (const s of secretStale) say(`seal: secret-scan stale allow-list entry ${s.n} (${s.path})`);
    if (scans.secret.hits) throw new SealStop(1, `seal: secret scan found ${scans.secret.hits} hit(s)`);
    for (const h of claims.hits) say(`seal: ${h.rule} ${h.path}:${h.line}: ${String(h.sentence).slice(0, 160)}`);
    for (const s of claims.stale) say(`seal: claims-scan stale allow-list entry ${s.n} (${s.path})`);
    if (scans.claims.hits) throw new SealStop(1, `seal: claims scan found ${scans.claims.hits} hit(s)`);
    step("S10", true, `secret scan ${scans.secret.files} files, claims scan ${scans.claims.files} files, no hit`);

    // S12 runs before the reports are written, so a report never records a seal whose payload drifted.
    driftCheck("S12");

    // S11
    const sealCommit = git(repo, ["rev-parse", "HEAD"]).toString().trim();
    mkdirSync(out, { recursive: true });
    const manifestCopy = join(out, `envelope-manifest-${sequence}.json`);
    const reportPath = join(out, `seal-report-${sequence}.json`);
    if (existsSync(reportPath) || existsSync(manifestCopy)) throw new SealStop(2, `seal: BLOCKED: ${reportPath} exists; a re-seal needs --reseal-reason`);
    writeFileSync(manifestCopy, manifestBytes, { flag: "wx" });
    steps.push({ id: "S11", ok: true, detail: `wrote ${manifestCopy} and ${reportPath}` });
    say(`seal: S11 ok wrote ${manifestCopy} and ${reportPath}`);
    const report = {
      schemaVersion: 1,
      kind: "mth-seal-report",
      rehearsal,
      sequence,
      resealReason: options.resealReason ?? null,
      payloadHash: candidate,
      sourceCommit,
      sealCommit,
      payloadArchive: { name: payloadFile, archiveSha256: built.archiveSha256, tarSha256: built.tarSha256 },
      envelopeArchive: { name: `${env.name}.tar.gz`, archiveSha256: env.archiveSha256, tarSha256: env.tarSha256 },
      envelopeManifestSha256: sha256(manifestBytes),
      demoDataInputSha256: demo.inputSha256,
      scans,
      steps: [...steps].sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1))),
      tool: { node: process.version, sealSha256: sha256(readFileSync(fileURLToPath(import.meta.url))) },
      sealedAt: new Date().toISOString(),
      statement: STATEMENT,
    };
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
    result.report = report;
    result.ok = true;
    result.exit = 0;
    say(`seal: sealed payload ${candidate}; payload archive sha256 ${built.archiveSha256}; envelope archive sha256 ${env.archiveSha256}`);
    say("seal: run verify-seal next; delivery is not complete until it passes");
  } catch (e) {
    if (!(e instanceof SealStop)) throw e;
    say(e.line);
    result.exit = e.exit;
  } finally {
    for (const d of scratch) rmSync(d, { recursive: true, force: true });
  }
  return result;
}

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (e) {
    if (e instanceof SealStop) {
      console.log(e.line);
      return e.exit;
    }
    throw e;
  }
  try {
    const r = await seal({ ...options, print: (l) => console.log(l) });
    if (r.ok) console.log(`seal: ${STATEMENT}`);
    return r.exit;
  } catch (e) {
    console.log(`seal: BLOCKED: ${e.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await main(process.argv.slice(2));
