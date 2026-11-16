#!/usr/bin/env node
// Release payload archive (ADR-0062 §1–§4; REQ-S19-001). Node 24, no dependency, no network.
//
//   node tools/release/build-archive.mjs --commit <40 hex> --demo-data <dir> [--candidate sha256:<hex>] [--rehearsal]
//                                        --out <dir> [--repo <dir>]
//   node tools/release/build-archive.mjs --verify <archive.tar.gz> --expect-sha256 <hex> [--candidate sha256:<hex>]
//   node tools/release/build-archive.mjs --pack-store <pnpm store dir> --out <dir> [--repo <dir>]
//
// Exit codes (p7-work-split §2 rule 4): 0 PASS, 1 FAIL, 2 BLOCKED (missing/invalid input, usage).
// The archive is an engineering delivery artefact, not a business, Finance or IT approval. It never writes under
// docs/delivery/** and reads no delivery folder: source/ is the candidate manifest at the commit
// (tools/gates/lib/candidate.mjs, imported read-only), which already excludes the delivery metadata.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { APPROVED_SPEC, candidateId, manifestFromRef } from "../gates/lib/candidate.mjs";
import { checkPath, compareBytes, DEFAULT_MTIME, gunzipArchive, gzipDeterministic, readTar, writeTar } from "./lib/tar.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const PRODUCT = "mobily-transformation-hub";
const PREFIX = "mth-transformation-hub";
/** The `app` role directory (ADR-0062 §2; D-244 O1 keeps the name `source/`). */
export const SOURCE_DIR = "source";
export const ROLE_DIRS = Object.freeze({ [SOURCE_DIR]: "app", infra: "infra", docs: "docs", "demo-data": "demo-data" });
const TOP_FILES = new Set(["ARCHIVE-MANIFEST.json", "SHA256SUMS", "README.txt"]);
const FILE_MODES = new Set([0o644, 0o755]);

export const ARCHIVE_README_TEXT = `Mobily Transformation Hub — release archive <version>

source/     The complete application source at the approved candidate. Build it with the steps in
            docs/handover/ (deployment guide) or tools/release/build-from-archive.sh.
infra/      Deployment files: Compose, container definition, environment template (names only),
            service and dependency list, SBOM and licence inventory, dependency manifests and lockfile.
docs/       Handover documentation, operations guides, API contract, architecture records and the
            requirements coverage register.
demo-data/  SYNTHETIC demonstration data exported as a migration manifest. It is not Mobily data.

SHA256SUMS lists the SHA-256 of every file in this archive. ARCHIVE-MANIFEST.json records the
candidate id, the layout and the inputs. The checksum of the archive file itself is published
next to it, outside the archive.

This archive is an engineering delivery artefact. It is not a business, Finance or IT approval.
The playbook this product operationalizes is a practical synthesis inspired by PMI, Brightline and
BRM practice; it is not an official PMI standard, and this product is not certified by any body.

ملخص: يحتوي هذا الأرشيف على الشيفرة المصدرية الكاملة (source)، وملفات النشر (infra)، والوثائق
(docs)، وبيانات عرض تجريبية اصطناعية (demo-data). وهو مُخرَج تسليم هندسي وليس موافقة عمل أو مالية
أو تقنية. (ترجمة مؤقتة لم يراجعها مراجع عربي مؤهل.)
`;

const DEMO_README_TEXT = `SYNTHETIC demonstration data of the Mobily Transformation Hub, exported as a migration manifest
(ADR-0064) from a freshly seeded demo installation. It is not Mobily data. manifest.json carries the
environment marker (sourceEnvironment = demo) and the demo checksum. The files next to this README
are copied byte for byte from the build input; this README is the only generated file here.
`;

/** A refusal with a fixed message and exit code (p7-work-split A.3). */
export class ArchiveError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Paths of source/ copied under infra/ at their repository path (ADR-0062 §2). */
export function infraTarget(path) {
  if (path.startsWith("deploy/") || path === ".env.example") return `infra/${path}`;
  if (["licenses/sbom.cdx.json", "licenses/inventory.csv", "licenses/README.md"].includes(path)) return `infra/${path}`;
  return null;
}

/** Workspace dependency manifests copied under infra/manifests/ (root, apps/*, packages/* per pnpm-workspace.yaml). */
export function manifestTarget(path) {
  return /^(?:(?:apps|packages)\/[^/]+\/)?(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|\.npmrc)$/.test(path)
    ? `infra/manifests/${path}`
    : null;
}

/** Paths of source/ copied under docs/ (the archive's docs/ stands for the repository's docs/). */
export function docsTarget(path) {
  return /^docs\/(?:handover|operations|api|architecture)\//.test(path) || path === "docs/delivery/requirements.csv"
    ? path
    : null;
}

function git(repo, args, input) {
  return execFileSync("git", ["-C", repo, ...args], { maxBuffer: 1 << 30, input });
}

/** The files at <commit>: ls-tree checks (symlinks, gitlinks, paths) and content via one `git cat-file --batch`. */
function readCommitFiles(repo, commit) {
  const raw = git(repo, ["ls-tree", "-r", "-z", "--full-tree", commit]);
  const objects = new Map();
  let start = 0;
  while (start < raw.length) {
    const end = raw.indexOf(0, start);
    const rec = raw.subarray(start, end === -1 ? raw.length : end);
    start = end === -1 ? raw.length : end + 1;
    const tab = rec.indexOf(0x09);
    const [mode, , oid] = rec.subarray(0, tab).toString("ascii").split(" ");
    const pathRaw = rec.subarray(tab + 1);
    const path = pathRaw.toString("utf8");
    objects.set(path, { mode, oid, pathRaw });
  }
  const entries = (() => {
    try {
      return manifestFromRef(repo, commit, APPROVED_SPEC);
    } catch (e) {
      const m = /'(.+)'/.exec(String(e.message));
      if (/submodule|gitlink/.test(String(e.message)) && m)
        throw new ArchiveError(`build-archive: ${m[1]}: symlinks and submodules are not archived`, 1);
      throw e;
    }
  })();
  for (const e of entries) {
    const o = objects.get(e.path);
    if (e.mode === "120000" || o?.mode === "120000" || o?.mode === "160000")
      throw new ArchiveError(`build-archive: ${e.path}: symlinks and submodules are not archived`, 1);
    try {
      checkPath(e.path, o?.pathRaw);
    } catch {
      throw new ArchiveError(`build-archive: refused path ${JSON.stringify(e.path)}`, 1);
    }
  }
  const out = git(repo, ["cat-file", "--batch"], entries.map((e) => objects.get(e.path).oid).join("\n") + "\n");
  let off = 0;
  const files = [];
  for (const e of entries) {
    const nl = out.indexOf(0x0a, off);
    const [, , size] = out.subarray(off, nl).toString("ascii").split(" ");
    const data = out.subarray(nl + 1, nl + 1 + Number(size));
    off = nl + 1 + Number(size) + 1;
    if (sha256(data) !== e.sha256) throw new Error(`build-archive: ${e.path}: content does not match its manifest hash`);
    files.push({ path: e.path, data: Buffer.from(data), mode: e.mode === "100755" ? 0o755 : 0o644 });
  }
  return { entries, files };
}

function walkDir(root, rel = "") {
  const out = [];
  for (const name of readdirSync(join(root, rel)).sort(compareBytes)) {
    const p = rel ? `${rel}/${name}` : name;
    const st = lstatSync(join(root, p));
    if (st.isSymbolicLink()) throw new ArchiveError(`build-archive: demo-data/${p}: symlinks and submodules are not archived`, 1);
    if (st.isDirectory()) out.push(...walkDir(root, p));
    else if (st.isFile()) out.push({ path: p, data: readFileSync(join(root, p)), mode: st.mode & 0o111 ? 0o755 : 0o644 });
  }
  return out;
}

/** Reads and checks the --demo-data input (ADR-0062 §2.1; ADR-0064 marker `sourceEnvironment`, D-244 O2). */
export function readDemoData(dir, { rehearsal }) {
  if (!dir || !existsSync(join(dir, "manifest.json"))) throw new ArchiveError("build-archive: demo-data has no manifest.json", 2);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  } catch {
    throw new ArchiveError("build-archive: demo-data has no manifest.json", 2);
  }
  if (manifest?.fixture === true && !rehearsal)
    throw new ArchiveError("build-archive: the fixture demo-data cannot be used for a release build", 1);
  if (manifest?.sourceEnvironment !== "demo")
    throw new ArchiveError(
      `build-archive: demo-data is not a synthetic demo export (environment marker '${manifest?.sourceEnvironment ?? ""}')`,
      1,
    );
  const files = walkDir(dir);
  for (const f of files) {
    try {
      checkPath(f.path);
    } catch {
      throw new ArchiveError(`build-archive: refused path ${JSON.stringify(`demo-data/${f.path}`)}`, 1);
    }
  }
  if (files.some((f) => f.path === "README.txt"))
    throw new ArchiveError("build-archive: refused path \"demo-data/README.txt\" (the README is generated)", 1);
  const lines = files
    .map((f) => `${sha256(f.data)}  ${f.path}\n`)
    .sort((a, b) => compareBytes(a.slice(66), b.slice(66)))
    .join("");
  return {
    files,
    inputSha256: sha256(Buffer.from(lines, "utf8")),
    demoChecksum: typeof manifest.demoChecksum === "string" ? manifest.demoChecksum : null,
  };
}

function toolSha256() {
  return sha256(Buffer.concat([readFileSync(join(HERE, "build-archive.mjs")), readFileSync(join(HERE, "lib", "tar.mjs"))]));
}

function mtimeValue() {
  const v = process.env.SOURCE_DATE_EPOCH;
  if (v === undefined || v === "") return DEFAULT_MTIME;
  if (!/^\d+$/.test(v)) throw new ArchiveError(`build-archive: SOURCE_DATE_EPOCH is not an integer ('${v}')`, 2);
  return Number(v);
}

/** Builds the payload archive. Module API for seal.mjs (ADR-0073). */
export async function buildArchive({ repo = REPO, commit, demoData, candidate, rehearsal = false, outDir }) {
  const t0 = Date.now();
  if (!/^[0-9a-f]{40}$/.test(commit ?? "")) throw new ArchiveError("build-archive: --commit must be a full 40-hex commit id", 2);
  if (candidate !== undefined && !/^sha256:[0-9a-f]{64}$/.test(candidate))
    throw new ArchiveError("build-archive: --candidate must be sha256:<64 hex>", 2);
  if (!outDir) throw new ArchiveError("build-archive: --out is required", 2);
  const mtime = mtimeValue();
  const demo = readDemoData(demoData, { rehearsal });
  const { entries, files: sourceFiles } = readCommitFiles(repo, commit);
  const id = candidateId(entries);
  if (candidate !== undefined && candidate !== id)
    throw new ArchiveError(`build-archive: the files at ${commit} hash to ${id}, not the expected ${candidate}`, 1);
  const t1 = Date.now();

  const rootPkg = sourceFiles.find((f) => f.path === "package.json");
  const pkgVersion = rootPkg ? JSON.parse(rootPkg.data.toString("utf8")).version : "0.0.0";
  const version = `${pkgVersion}-${id.slice(7, 19)}`;
  const name = `${PREFIX}-${version}${rehearsal ? "-REHEARSAL" : ""}`;

  const inner = []; // paths relative to the top-level directory
  for (const f of sourceFiles) {
    inner.push({ path: `${SOURCE_DIR}/${f.path}`, data: f.data, mode: f.mode });
    for (const target of [infraTarget(f.path), manifestTarget(f.path), docsTarget(f.path)])
      if (target) inner.push({ path: target, data: f.data, mode: f.mode });
  }
  for (const f of demo.files) inner.push({ path: `demo-data/${f.path}`, data: f.data, mode: f.mode });
  inner.push({ path: "demo-data/README.txt", data: Buffer.from(DEMO_README_TEXT, "utf8"), mode: 0o644 });
  const count = (dir) => inner.filter((f) => f.path.startsWith(`${dir}/`)).length;
  const manifest = {
    schemaVersion: 1,
    product: PRODUCT,
    version,
    candidateId: id,
    sourceCommit: commit,
    rehearsal: Boolean(rehearsal),
    mtime,
    // No Node version here (D-246 Q1; ADR-0062 §4.2 amendment): the .tar bytes must not depend on it (§3).
    // The Node and zlib versions that built the archive are in build-report.json `tool`.
    tool: { buildArchiveSha256: toolSha256() },
    layout: [
      { dir: SOURCE_DIR, role: "app", files: count(SOURCE_DIR), rule: "candidate manifest at sourceCommit" },
      { dir: "infra", role: "infra", files: count("infra"), rule: "ADR-0062 §2" },
      { dir: "docs", role: "docs", files: count("docs"), rule: "ADR-0062 §2" },
      { dir: "demo-data", role: "demo-data", files: count("demo-data"), rule: "ADR-0064 export of a seeded demo database" },
    ],
    demoData: { synthetic: true, inputSha256: demo.inputSha256, demoChecksum: demo.demoChecksum },
    copies: "infra/, docs/ are byte copies of source/ paths (ADR-0062 §2)",
  };
  inner.push({ path: "ARCHIVE-MANIFEST.json", data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"), mode: 0o644 });
  inner.push({ path: "README.txt", data: Buffer.from(ARCHIVE_README_TEXT.replace("<version>", version), "utf8"), mode: 0o644 });
  const sums = inner
    .map((f) => ({ path: f.path, hex: sha256(f.data) }))
    .sort((a, b) => compareBytes(a.path, b.path))
    .map((s) => `${s.hex}  ${s.path}\n`)
    .join("");
  inner.push({ path: "SHA256SUMS", data: Buffer.from(sums, "utf8"), mode: 0o644 });

  const tar = writeTar(
    inner.map((f) => ({ ...f, path: `${name}/${f.path}` })),
    { mtime },
  );
  const gz = gzipDeterministic(tar);
  const tarSha256 = sha256(tar);
  const archiveSha256 = sha256(gz);
  mkdirSync(outDir, { recursive: true });
  const archivePath = join(outDir, `${name}.tar.gz`);
  writeFileSync(archivePath, gz);
  writeFileSync(`${archivePath}.sha256`, `${archiveSha256}  ${name}.tar.gz\n`);
  const report = {
    name,
    archive: `${name}.tar.gz`,
    archiveSha256,
    tarSha256,
    archiveBytes: gz.length,
    tarBytes: tar.length,
    candidateId: id,
    sourceCommit: commit,
    rehearsal: Boolean(rehearsal),
    files: inner.length,
    layout: manifest.layout.map(({ dir, files }) => ({ dir, files })),
    tool: { node: process.versions.node, zlib: process.versions.zlib, buildArchiveSha256: manifest.tool.buildArchiveSha256 },
    timingsMs: { readCommit: t1 - t0, total: Date.now() - t0 },
    builtAt: new Date().toISOString(),
  };
  writeFileSync(join(outDir, `${name}.build-report.json`), `${JSON.stringify(report, null, 2)}\n`);
  return { name, tarSha256, archiveSha256, archivePath, manifest };
}

/** Verifies an archive (ADR-0062 §4.3). Streams through the tar in memory; never extracts to disk. */
export async function verifyArchive(path, { expectSha256, candidate } = {}) {
  if (!/^[0-9a-f]{64}$/.test(expectSha256 ?? "")) throw new ArchiveError("archive-verify: BLOCKED: --expect-sha256 <64 hex> is required", 2);
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (e) {
    throw new ArchiveError(`archive-verify: BLOCKED: cannot read ${path} (${e.code ?? e.message})`, 2);
  }
  let entries;
  try {
    entries = [...readTar(gunzipArchive(bytes))];
  } catch (e) {
    throw new ArchiveError(`archive-verify: BLOCKED: ${path} is not a readable gzip tar (${e.message})`, 2);
  }
  const checks = [];
  const add = (id, ok, detail = "") => checks.push({ id, ok, detail });

  const actual = sha256(bytes);
  add("archive-checksum", actual === expectSha256, actual === expectSha256 ? "" : `sha256 ${actual}, expected ${expectSha256}`);

  const tops = new Set(entries.map((e) => e.path.split("/")[0]));
  const top = [...tops][0] ?? "";
  const fileOf = new Map();
  for (const e of entries) if (e.type === "file") fileOf.set(e.path.slice(top.length + 1), e);
  let manifest = null;
  try {
    manifest = JSON.parse(fileOf.get("ARCHIVE-MANIFEST.json").data.toString("utf8"));
  } catch {
    /* reported below */
  }
  const expectedTop = manifest ? `${PREFIX}-${manifest.version}${manifest.rehearsal ? "-REHEARSAL" : ""}` : null;
  add(
    "single-top-level-directory",
    tops.size === 1 && top === expectedTop && entries.some((e) => e.type === "dir" && e.path === top),
    tops.size !== 1 ? `${tops.size} top-level entries` : manifest ? (top === expectedTop ? "" : `named ${top}, expected ${expectedTop}`) : "ARCHIVE-MANIFEST.json missing or invalid",
  );

  // layout: the four roles, each a separate top-level directory with at least one file; nothing else at the top.
  const layoutProblems = [];
  const secondLevel = new Map(); // name -> { dir, files }
  for (const e of entries) {
    const rest = e.path.slice(top.length + 1);
    if (!rest) continue;
    const [first, ...more] = rest.split("/");
    const s = secondLevel.get(first) ?? { dir: false, files: 0 };
    if (e.type === "dir" || more.length > 0) s.dir = true;
    if (e.type === "file" && more.length > 0) s.files++;
    secondLevel.set(first, s);
  }
  const roleOfDir = new Map((manifest?.layout ?? []).map((l) => [l.dir, l.role]));
  const rolesSeen = new Set();
  for (const [n, s] of [...secondLevel].sort((a, b) => compareBytes(a[0], b[0]))) {
    if (!s.dir) {
      if (!TOP_FILES.has(n)) layoutProblems.push(`unexpected top-level file ${n}`);
      continue;
    }
    const role = roleOfDir.get(n);
    if (!role || ROLE_DIRS[n] !== role) layoutProblems.push(`unexpected top-level directory ${n}/`);
    else if (s.files === 0) layoutProblems.push(`${n}/ (${role}) has no file`);
    else rolesSeen.add(role);
  }
  for (const role of Object.values(ROLE_DIRS)) if (!rolesSeen.has(role)) layoutProblems.push(`role ${role} missing`);
  add("layout", layoutProblems.length === 0, layoutProblems.join("; "));

  // SHA256SUMS
  const sumProblems = [];
  const sumsFile = fileOf.get("SHA256SUMS");
  if (!sumsFile) sumProblems.push("SHA256SUMS missing");
  else {
    const listed = new Map();
    for (const line of sumsFile.data.toString("utf8").split("\n")) {
      if (!line) continue;
      const m = /^([0-9a-f]{64}) {2}(.+)$/.exec(line);
      if (!m) sumProblems.push(`bad line ${JSON.stringify(line.slice(0, 80))}`);
      else listed.set(m[2], m[1]);
    }
    for (const [p, e] of fileOf) {
      if (p === "SHA256SUMS") continue;
      if (!listed.has(p)) sumProblems.push(`${p} not listed`);
      else if (listed.get(p) !== sha256(e.data)) sumProblems.push(`${p} hash mismatch`);
    }
    for (const p of listed.keys()) if (!fileOf.has(p)) sumProblems.push(`${p} listed but missing`);
  }
  add("sha256sums", sumProblems.length === 0, sumProblems.slice(0, 5).join("; ") + (sumProblems.length > 5 ? `; … ${sumProblems.length} problems` : ""));

  // candidate id of source/
  const srcEntries = [...fileOf]
    .filter(([p]) => p.startsWith(`${SOURCE_DIR}/`))
    .map(([p, e]) => ({ path: p.slice(SOURCE_DIR.length + 1), sha256: sha256(e.data), mode: e.mode === 0o755 ? "100755" : "100644" }));
  const srcId = candidateId(srcEntries);
  const candProblems = [];
  if (!manifest) candProblems.push("ARCHIVE-MANIFEST.json missing or invalid");
  else if (srcId !== manifest.candidateId) candProblems.push(`source/ hashes to ${srcId}, manifest says ${manifest.candidateId}`);
  if (candidate !== undefined && srcId !== candidate) candProblems.push(`source/ hashes to ${srcId}, expected ${candidate}`);
  add("candidate-id", candProblems.length === 0, candProblems.join("; "));

  // copies
  const copyProblems = [];
  for (const [p, e] of fileOf) {
    let src = null;
    if (p.startsWith("infra/manifests/")) src = p.slice("infra/manifests/".length);
    else if (p.startsWith("infra/")) src = p.slice("infra/".length);
    else if (p.startsWith("docs/")) src = p;
    else continue;
    const s = fileOf.get(`${SOURCE_DIR}/${src}`);
    if (!s) copyProblems.push(`${p}: no source/${src}`);
    else if (!s.data.equals(e.data) || s.mode !== e.mode) copyProblems.push(`${p} differs from source/${src}`);
  }
  add("copies", copyProblems.length === 0, copyProblems.slice(0, 5).join("; ") + (copyProblems.length > 5 ? `; … ${copyProblems.length} problems` : ""));

  // determinism metadata
  const mt = manifest?.mtime ?? DEFAULT_MTIME;
  const metaProblems = [];
  for (const e of entries) {
    const modeOk = e.type === "dir" ? e.mode === 0o755 : e.type === "file" ? FILE_MODES.has(e.mode) : false;
    if (e.mtime !== mt || e.uid !== 0 || e.gid !== 0 || e.uname || e.gname || !modeOk || e.paxKeys.some((k) => k !== "path"))
      metaProblems.push(e.path);
  }
  add("determinism-metadata", metaProblems.length === 0, metaProblems.length ? `${metaProblems.length} entries, first ${metaProblems[0]}` : "");

  return { ok: checks.every((c) => c.ok), checks, manifest };
}

/** Packs a filled pnpm store as the offline dependency artefact (ADR-0062 §5.2), with the same tar rules. */
export async function packStore({ repo = REPO, storeDir, outDir }) {
  if (!storeDir || !existsSync(storeDir) || !lstatSync(storeDir).isDirectory())
    throw new ArchiveError(`build-archive: BLOCKED: pnpm store ${storeDir ?? "(none)"} not found`, 2);
  if (!outDir) throw new ArchiveError("build-archive: --out is required", 2);
  const pkgVersion = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
  const head = git(repo, ["rev-parse", "HEAD"]).toString().trim();
  const id = candidateId(manifestFromRef(repo, head, APPROVED_SPEC));
  const name = `${PREFIX}-${pkgVersion}-${id.slice(7, 19)}-pnpm-store`;
  const files = [];
  const walk = (rel) => {
    for (const n of readdirSync(join(storeDir, rel)).sort(compareBytes)) {
      const p = rel ? `${rel}/${n}` : n;
      const st = lstatSync(join(storeDir, p));
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) files.push({ path: `${name}/${p}`, data: readFileSync(join(storeDir, p)), mode: st.mode & 0o111 ? 0o755 : 0o644 });
    }
  };
  walk("");
  const gz = gzipDeterministic(writeTar(files, { mtime: mtimeValue() }));
  const hex = sha256(gz);
  mkdirSync(outDir, { recursive: true });
  const archivePath = join(outDir, `${name}.tar.gz`);
  writeFileSync(archivePath, gz);
  writeFileSync(`${archivePath}.sha256`, `${hex}  ${name}.tar.gz\n`);
  return { name, archivePath, archiveSha256: hex, files: files.length };
}

function parseArgs(argv) {
  const opts = { rehearsal: false };
  const value = (i) => {
    if (i + 1 >= argv.length || argv[i + 1].startsWith("--")) throw new ArchiveError(`build-archive: ${argv[i]} needs a value`, 2);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--rehearsal") opts.rehearsal = true;
    else if (["--commit", "--demo-data", "--candidate", "--out", "--verify", "--expect-sha256", "--pack-store", "--repo"].includes(a)) {
      opts[a.slice(2)] = value(i);
      i++;
    } else throw new ArchiveError(`build-archive: unknown argument ${a}`, 2);
  }
  return opts;
}

async function main(argv) {
  const o = parseArgs(argv);
  if (o.verify) {
    const r = await verifyArchive(o.verify, { expectSha256: o["expect-sha256"], candidate: o.candidate });
    r.checks.forEach((c, i) => console.log(`${i + 1} ${c.id}: ${c.ok ? "ok" : `FAIL ${c.detail}`}`));
    const failed = r.checks.filter((c) => !c.ok).length;
    console.log(failed ? `archive-verify: FAIL (${failed} checks)` : "archive-verify: PASS");
    return failed ? 1 : 0;
  }
  if (o["pack-store"]) {
    const r = await packStore({ repo: o.repo ? resolve(o.repo) : REPO, storeDir: o["pack-store"], outDir: o.out });
    console.log(`build-archive: wrote ${r.archivePath} (${r.files} files) sha256 ${r.archiveSha256}`);
    return 0;
  }
  if (!o.commit || !o["demo-data"] || !o.out)
    throw new ArchiveError(
      "usage: build-archive.mjs --commit <40 hex> --demo-data <dir> [--candidate sha256:<hex>] [--rehearsal] --out <dir> | --verify <archive> --expect-sha256 <hex> [--candidate <id>] | --pack-store <dir> --out <dir>",
      2,
    );
  const r = await buildArchive({
    repo: o.repo ? resolve(o.repo) : REPO,
    commit: o.commit,
    demoData: resolve(o["demo-data"]),
    candidate: o.candidate,
    rehearsal: o.rehearsal,
    outDir: resolve(o.out),
  });
  console.log(`build-archive: wrote ${r.archivePath}`);
  console.log(`build-archive: candidate ${r.manifest.candidateId} commit ${r.manifest.sourceCommit}`);
  console.log(`build-archive: tar sha256 ${r.tarSha256}`);
  console.log(`build-archive: archive sha256 ${r.archiveSha256}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (e) => {
      if (e instanceof ArchiveError) {
        console.error(e.message);
        process.exit(e.exitCode);
      }
      console.error(`build-archive: BLOCKED: ${e.message}`);
      process.exit(2);
    },
  );
}
