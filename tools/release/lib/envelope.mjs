// The release evidence envelope (ADR-0073 §3): the fixed list from the gate records (no folder walk, D-138), the
// ENVELOPE-MANIFEST.json writer (§3.4 key order, sorted arrays, no clock), the archive layout (§3.5) and README (§3.6).
// Node 24 built-ins only. This module performs no I/O: callers pass the records and bytes in.
import { createHash } from "node:crypto";
import { compareBytes, gzipDeterministic, writeTar } from "./tar.mjs";

export const PREFIX = "mth-transformation-hub";

/** The ten agent definitions of ADR-0073 §3.1, by name (sorted). */
export const AGENT_NAMES = Object.freeze([
  "backend-workflow-engineer",
  "code-security-reviewer",
  "devops-engineer",
  "domain-reviewer",
  "frontend-ux-engineer",
  "kpi-benefits-engineer",
  "qa-verifier",
  "release-auditor",
  "solution-architect",
  "transformation-analyst",
]);

/** The required --evidence keys (ADR-0073 §3.1; p7-work-split §L.1). */
export const REQUIRED_EVIDENCE = Object.freeze(["A18", "A19", "A26", "A27", "protocol-audit", "test-level-index"]);
export const EVIDENCE_DIR = "docs/delivery/test-evidence/DG7/";
export const STAGES = Object.freeze(["DG0", "DG1", "DG2", "DG3", "DG4", "DG5", "DG6", "DG7"]);
export const REGISTER_PATH = "docs/delivery/requirements.csv";
export const FINDINGS_PATH = "docs/delivery/findings.json";
export const STAGES_PATH = "docs/delivery/stages.json";

/** The statement of ADR-0073 §4.6 (exact; every seal and verify report, the README and the final report carry it). */
export const STATEMENT =
  "Sealing and its verification are engineering packaging checks. They grant no business, Finance or IT approval. Product gate G6 does not imply engineering gate DG7, and DG7 does not imply any product gate G1–G6.";

/** The manifest's `gateSystems` text (ADR-0073 §3.4), exact. */
export const GATE_SYSTEMS_TEXT =
  "DG0-DG7 are engineering delivery gates. G1-G6 are business approvals inside the product. Neither implies the other, and this envelope grants no business, Finance or IT approval.";

/** README.txt of the envelope (ADR-0073 §3.6), exact, with the `<version>` and `<payload hash>` placeholders. */
export const ENVELOPE_README_TEXT = `Mobily Transformation Hub — release evidence envelope <version>

payload/   The release archive. Its source/ directory hashes to the payload hash below,
           which is the DG7 candidate id the engineering gate approved.
evidence/  Delivery records: the eight engineering gate records DG0-DG7, the review records
           they cite, the candidate manifests, the ten agent definitions, the requirement
           register, the findings, the stage records and the drill reports.

Payload hash:  <payload hash>
Check:         sha256sum -c SHA256SUMS

DG0-DG7 are engineering delivery gates. G1-G6 are business approvals inside the product.
Neither implies the other. This envelope is engineering evidence: it grants no business,
Finance or IT approval, and Mobily IT's acceptance of the package is a separate decision.
Agent count or agreement does not guarantee correctness; see the final delivery report.
`;

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export const readmeText = (version, payloadHash) =>
  ENVELOPE_README_TEXT.replace("<version>", version).replace("<payload hash>", payloadHash);

/** The envelope's top-level directory and archive base name (§3.5; `-REHEARSAL` appended in a rehearsal). */
export const envelopeName = (version, rehearsal) => `${PREFIX}-${version}-envelope${rehearsal ? "-REHEARSAL" : ""}`;

const byBytes = (key) => (a, b) => compareBytes(String(a[key]), String(b[key]));

/** A repository-relative path that is safe to place under evidence/ (no absolute path, no `..`, no backslash). */
export function isSafeRelPath(p) {
  return (
    typeof p === "string" &&
    p !== "" &&
    !p.startsWith("/") &&
    !p.includes("\\") &&
    !p.includes("\0") &&
    p.split("/").every((s) => s !== "" && s !== "." && s !== "..")
  );
}

/**
 * The §3.1 list, from the gate records only (no folder walk). Each path appears once, under its first group.
 * @param {{ gates: { stage: string, path: string, record: any }[], evidence: Record<string,string>, extras?: string[] }} input
 * @returns {{ group: string, path: string, stage?: string, role?: string, key?: string, name?: string, source: "commit"|"tree" }[]}
 */
export function envelopeList({ gates, evidence, extras = [] }) {
  const out = [];
  const seen = new Set();
  const add = (e) => {
    if (seen.has(e.path)) return;
    seen.add(e.path);
    out.push(e);
  };
  for (const g of gates) add({ group: "gate", path: g.path, stage: g.stage, source: "tree" });
  for (const g of gates)
    if (typeof g.record?.manifest_path === "string") add({ group: "candidate manifest", path: g.record.manifest_path, stage: g.stage, source: "tree" });
  for (const g of gates) {
    const reviews = g.record?.reviews && typeof g.record.reviews === "object" ? g.record.reviews : {};
    for (const [role, path] of Object.entries(reviews)) if (typeof path === "string") add({ group: "review", path, stage: g.stage, role, source: "tree" });
    if (typeof g.record?.release_audit === "string")
      add({ group: "review", path: g.record.release_audit, stage: g.stage, role: "release-auditor", source: "tree" });
  }
  for (const name of AGENT_NAMES) add({ group: "agent definition", path: `.claude/agents/${name}.md`, name, source: "commit" });
  add({ group: "register", path: REGISTER_PATH, source: "commit" });
  add({ group: "findings", path: FINDINGS_PATH, source: "tree" });
  add({ group: "stages", path: STAGES_PATH, source: "tree" });
  for (const key of Object.keys(evidence).sort(compareBytes)) add({ group: "evidence", path: evidence[key], key, source: "tree" });
  for (const p of [...extras].sort(compareBytes)) add({ group: "extra", path: p, source: "tree" });
  return out;
}

/**
 * ENVELOPE-MANIFEST.json (§3.4): keys in the documented order, arrays sorted, UTF-8, 2-space indent, LF, final newline.
 * `files` maps each listed path to its bytes. Returns { manifest, bytes }.
 */
export function buildEnvelopeManifest({ version, rehearsal, payload, list, files, registerRows }) {
  const hashOf = (p) => sha256(files.get(p));
  const gates = list
    .filter((e) => e.group === "gate")
    .map((e) => {
      const r = JSON.parse(files.get(e.path).toString("utf8"));
      return {
        stage: e.stage,
        path: e.path,
        sha256: hashOf(e.path),
        candidateId: r.candidate_id,
        sourceCommit: r.source_commit,
        decision: r.decision,
        decidedAt: r.decided_at ?? null,
      };
    })
    .sort(byBytes("stage"));
  const pick = (group) => list.filter((e) => e.group === group);
  const manifest = {
    schemaVersion: 1,
    kind: "mth-release-envelope",
    product: "mobily-transformation-hub",
    version,
    rehearsal: Boolean(rehearsal),
    gateSystems: GATE_SYSTEMS_TEXT,
    payload: {
      hash: payload.hash,
      hashAlgorithm: "mth-candidate-v2",
      sourceCommit: payload.sourceCommit,
      files: payload.files,
      archive: { name: payload.archive.name, archiveSha256: payload.archive.archiveSha256, tarSha256: payload.archive.tarSha256 },
      demoDataInputSha256: payload.demoDataInputSha256,
    },
    gates,
    candidateManifests: pick("candidate manifest")
      .map((e) => ({ stage: e.stage, path: e.path, sha256: hashOf(e.path) }))
      .sort(byBytes("stage")),
    reviews: pick("review")
      .map((e) => ({ stage: e.stage, role: e.role, path: e.path, sha256: hashOf(e.path) }))
      .sort((a, b) => compareBytes(a.stage, b.stage) || compareBytes(a.role, b.role)),
    agentDefinitions: pick("agent definition")
      .map((e) => ({ name: e.name, path: e.path, sha256: hashOf(e.path) }))
      .sort(byBytes("name")),
    register: { path: REGISTER_PATH, sha256: hashOf(REGISTER_PATH), rows: registerRows },
    findings: { path: FINDINGS_PATH, sha256: hashOf(FINDINGS_PATH) },
    stages: { path: STAGES_PATH, sha256: hashOf(STAGES_PATH) },
    evidence: pick("evidence")
      .map((e) => ({ key: e.key, path: e.path, sha256: hashOf(e.path) }))
      .sort(byBytes("key")),
    extras: pick("extra")
      .map((e) => ({ path: e.path, sha256: hashOf(e.path) }))
      .sort(byBytes("path")),
  };
  return { manifest, bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8") };
}

/** The top-level key order of §3.4, for the verifier. */
export const MANIFEST_KEYS = Object.freeze([
  "schemaVersion",
  "kind",
  "product",
  "version",
  "rehearsal",
  "gateSystems",
  "payload",
  "gates",
  "candidateManifests",
  "reviews",
  "agentDefinitions",
  "register",
  "findings",
  "stages",
  "evidence",
  "extras",
]);

/** Every listed path of a parsed manifest, with its recorded sha256. */
export function manifestPaths(m) {
  const out = [];
  for (const k of ["gates", "candidateManifests", "reviews", "agentDefinitions", "evidence", "extras"])
    for (const e of Array.isArray(m?.[k]) ? m[k] : []) out.push({ group: k, path: e.path, sha256: e.sha256 });
  for (const k of ["register", "findings", "stages"]) if (m?.[k]) out.push({ group: k, path: m[k].path, sha256: m[k].sha256 });
  return out;
}

/** SHA256SUMS text over `entries` ({ path, data }), sorted by path (sha256sum -c format). */
export function sha256sums(entries) {
  return entries
    .map((f) => ({ path: f.path, hex: sha256(f.data) }))
    .sort((a, b) => compareBytes(a.path, b.path))
    .map((s) => `${s.hex}  ${s.path}\n`)
    .join("");
}

/**
 * Packs the envelope (§3.5). `payloadArchive` is { name (file name), data, sha256Line }; `evidence` is [{ path, data }].
 * Returns { name, tar, gz, tarSha256, archiveSha256 }.
 */
export function packEnvelope({ version, rehearsal, payloadHash, manifestBytes, payloadArchive, evidence }) {
  const name = envelopeName(version, rehearsal);
  const inner = [
    { path: "README.txt", data: Buffer.from(readmeText(version, payloadHash), "utf8"), mode: 0o644 },
    { path: "ENVELOPE-MANIFEST.json", data: manifestBytes, mode: 0o644 },
    { path: `payload/${payloadArchive.name}`, data: payloadArchive.data, mode: 0o644 },
    { path: `payload/${payloadArchive.name}.sha256`, data: Buffer.from(payloadArchive.sha256Line, "utf8"), mode: 0o644 },
    ...evidence.map((f) => ({ path: `evidence/${f.path}`, data: f.data, mode: 0o644 })),
  ];
  inner.push({ path: "SHA256SUMS", data: Buffer.from(sha256sums(inner), "utf8"), mode: 0o644 });
  const tar = writeTar(inner.map((f) => ({ ...f, path: `${name}/${f.path}` })));
  const gz = gzipDeterministic(tar);
  return { name, tar, gz, tarSha256: sha256(tar), archiveSha256: sha256(gz) };
}
