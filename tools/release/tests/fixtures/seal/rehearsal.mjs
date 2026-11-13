// SYNTHETIC rehearsal helper (ADR-0073 §8) for tools/release/tests/{seal,verify-seal}.test.mjs. It writes a synthetic
// DG7 gate record, synthetic review records and synthetic evidence placeholders ONLY inside a sparse scratch clone
// under $TMPDIR. It never writes the repository, its docs/delivery/ records or its git metadata. Nothing here is a gate
// decision: the synthetic record approves nothing.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { APPROVED_SPEC, candidateId, manifestFromWorkingTree } from "../../../../gates/lib/candidate.mjs";
import { readDemoData } from "../../../build-archive.mjs";
import { SYNTHETIC_NOTES_PREFIX } from "../../../lib/gate-labels.mjs";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = join(HERE, "..", "..", "..", "..", "..");
export const SEAL_DEMO = join(HERE, "demo-data");

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "seal-rehearsal",
  GIT_AUTHOR_EMAIL: "seal-rehearsal@example.invalid",
  GIT_COMMITTER_NAME: "seal-rehearsal",
  GIT_COMMITTER_EMAIL: "seal-rehearsal@example.invalid",
  GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
  GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
};
export const git = (dir, args) => execFileSync("git", ["-C", dir, ...args], { env: ENV, maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
export const scratch = (prefix) => mkdtempSync(join(process.env.TMPDIR || tmpdir(), `mth-${prefix}-`));

/** The three omitted directories of ADR-0073 §8.1 (all in META_EXCLUDES). */
export const SPARSE_PATTERNS = ["/*", "!/docs/delivery/test-evidence/", "!/docs/delivery/handbacks/", "!/docs/delivery/runs/"];

/** ADR-0073 §8.1: a sparse scratch clone of the repository's HEAD. Returns { dir, head }. */
export function sparseClone(prefix = "seal-rehearsal") {
  const parent = scratch(prefix);
  const dir = join(parent, "clone");
  const head = git(REPO, ["rev-parse", "HEAD"]);
  execFileSync("git", ["clone", "-q", "--no-checkout", "--shared", REPO, dir], { env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  git(dir, ["sparse-checkout", "set", "--no-cone", ...SPARSE_PATTERNS]);
  git(dir, ["checkout", "-q", head]);
  return { dir, parent, head };
}

export const removeClone = (c) => c && rmSync(c.parent, { recursive: true, force: true });

/** The evidence keys and their synthetic placeholder paths (ADR-0073 §8.2). */
export const EVIDENCE = Object.freeze({
  A18: "docs/delivery/test-evidence/DG7/qa/rehearsal-a18-SYNTHETIC.md",
  A19: "docs/delivery/test-evidence/DG7/qa/rehearsal-a19-SYNTHETIC.md",
  A26: "docs/delivery/test-evidence/DG7/orchestrator/a26/rehearsal-drill-report-SYNTHETIC.md",
  A27: "docs/delivery/test-evidence/DG7/orchestrator/a27/rehearsal-drill-report-SYNTHETIC.md",
  "test-level-index": "docs/delivery/test-evidence/DG7/qa/rehearsal-test-level-index-SYNTHETIC.md",
  "protocol-audit": "docs/delivery/test-evidence/DG7/orchestrator/rehearsal-protocol-audit-SYNTHETIC.json",
});
export const evidenceArgs = (map = EVIDENCE) => Object.entries(map).flatMap(([k, p]) => ["--evidence", `${k}=${p}`]);

const put = (dir, rel, text) => {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
};

/** Commits every change in the clone, including paths outside the sparse patterns (`git add --sparse`). */
export function commitAll(dir, message = "SYNTHETIC rehearsal commit") {
  git(dir, ["add", "--sparse", "-A"]);
  git(dir, ["-c", "commit.gpgsign=false", "commit", "-q", "--allow-empty", "-m", message]);
  return git(dir, ["rev-parse", "HEAD"]);
}

/**
 * Writes the synthetic DG7 record (§8.2), its four synthetic review files under reviews/DG7/round-0/ and the six
 * synthetic evidence placeholders, then commits them in the clone. The record's candidate is the clone's working-tree
 * candidate before that commit; the files written are all META-excluded, so the candidate does not change.
 * @param {{ mutate?: (record: any) => void }} [opts]
 * @returns {{ candidate: string, sourceCommit: string, sealCommit: string }}
 */
export function writeSynthetic(dir, { mutate } = {}) {
  const sourceCommit = git(dir, ["rev-parse", "HEAD"]);
  const candidate = candidateId(manifestFromWorkingTree(dir, APPROVED_SPEC));
  const roles = ["domain-reviewer", "code-security-reviewer", "qa-verifier", "release-auditor"];
  const reviewPath = (role) => `docs/delivery/reviews/DG7/round-0/${role}.json`;
  for (const role of roles)
    put(
      dir,
      reviewPath(role),
      `${JSON.stringify(
        {
          synthetic_rehearsal: true,
          stage_id: "DG7",
          candidate_id: candidate,
          source_commit: sourceCommit,
          reviewer_role: role,
          verdict: "SYNTHETIC",
          notes: "SYNTHETIC REHEARSAL REVIEW: not a review. Written by the DG7 seal rehearsal in a scratch clone.",
        },
        null,
        2,
      )}\n`,
    );
  const record = {
    schema_version: 1,
    stage_id: "DG7",
    decision: "APPROVED",
    candidate_id: candidate,
    source_commit: sourceCommit,
    manifest_path: "docs/delivery/candidates/DG7/rehearsal-SYNTHETIC.manifest.json",
    previous_gate: "DG6",
    reviews: Object.fromEntries(roles.slice(0, 3).map((r) => [r, reviewPath(r)])),
    release_audit: reviewPath("release-auditor"),
    decided_at: "2000-01-01T00:00:00Z",
    decided_by: "release-auditor",
    synthetic_rehearsal: true,
    notes: `${SYNTHETIC_NOTES_PREFIX} Its candidate is the scratch clone's own.`,
  };
  if (mutate) mutate(record);
  put(dir, "docs/delivery/gates/DG7.json", `${JSON.stringify(record, null, 2)}\n`);
  put(
    dir,
    record.manifest_path,
    `${JSON.stringify({ stage_id: "DG7", candidate_id: candidate, source_commit: sourceCommit, note: "SYNTHETIC rehearsal manifest stub" }, null, 2)}\n`,
  );
  for (const [key, p] of Object.entries(EVIDENCE))
    put(dir, p, p.endsWith(".json") ? `${JSON.stringify({ synthetic: "SYNTHETIC rehearsal placeholder", key })}\n` : `SYNTHETIC rehearsal placeholder for the ${key} evidence key; not a drill report.\n`);
  const sealCommit = commitAll(dir);
  return { candidate, sourceCommit, sealCommit };
}

/** The synthetic demo-data input copied to <clone>/dist/release/inputs/demo-data (git-ignored), with its inputSha256. */
export function demoInput(dir, from = SEAL_DEMO) {
  const target = join(dir, "dist", "release", "inputs", "demo-data");
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(from, target, { recursive: true });
  return { path: target, sha256: readDemoData(target, { rehearsal: true }).inputSha256 };
}

/** Standard rehearsal seal options for the module API. */
export function sealOptions(dir, syn, demo, extra = {}) {
  return {
    repo: dir,
    candidate: syn.candidate,
    demoData: demo.path,
    demoDataSha256: demo.sha256,
    evidence: { ...EVIDENCE },
    rehearsal: true,
    ...extra,
  };
}

/**
 * Envelope-only secret-scan hits found by the rehearsal in APPROVED delivery records, which are never rewritten
 * (D-243 Q13). Each is a reviewer narrative quoting a synthetic test fixture, not a credential. The entries belong in
 * DO-B's tools/release/secret-allowlist.json (scope "envelope"); DO-J requests them in its handback (p7-work-split §M.4
 * seam G) and, until they are merged, the rehearsal passes them through a scratch copy of DO-B's list.
 */
export const ENVELOPE_ALLOW_REQUESTS = Object.freeze([
  {
    rule: "S1",
    path: "docs/delivery/reviews/DG6/round-7/code-security-reviewer.json",
    valueSha256: "457643f44d19aed85fd756aa50cc0cd6b57376d4e8f5a72f9f85972a522002a3",
    reason: "approved DG6 review narrative (l.220) quoting the synthetic AWS-shaped redaction fixture of operations/exceptions.test.ts; not a credential",
    scopes: ["envelope"],
  },
]);

/** A scratch copy of DO-B's allow-list plus ENVELOPE_ALLOW_REQUESTS, written under `dir` (a $TMPDIR path). */
export function scratchAllowlist(dir) {
  const base = JSON.parse(readFileSync(join(REPO, "tools", "release", "secret-allowlist.json"), "utf8"));
  const file = join(dir, "secret-allowlist.rehearsal.json");
  writeFileSync(file, `${JSON.stringify({ ...base, entries: [...base.entries, ...ENVELOPE_ALLOW_REQUESTS] }, null, 2)}\n`);
  return file;
}

/**
 * The DO-J files of the working tree, copied into the clone and committed there (SYNTHETIC rehearsal commit), so the
 * rehearsal's payload carries the tools and template it rehearses, as the frozen candidate will. Their repository
 * copies are only read.
 */
export const DO_J_PATHS = Object.freeze(["tools/release", "docs/handover/final-report.template.md", "docs/handover/release-notes.md"]);
export function overlayWorkingFiles(dir, paths = DO_J_PATHS) {
  for (const p of paths) {
    const from = join(REPO, p);
    try {
      cpSync(from, join(dir, p), { recursive: true });
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  return commitAll(dir, "SYNTHETIC rehearsal: the DO-J working-tree files");
}

/**
 * The known L3 hit on the approved DG3 gate record (T-M9; reported to the orchestrator, never fixed in the repository,
 * D-243 Q13). For the rehearsal's pass path the scratch clone's copy gets a labelled separation phrase; the repository's
 * record is untouched.
 */
export const DG3_L3_SENTENCE = "where a G4 capacity-conflict item";
export function neutralizeKnownLabelHits(dir) {
  const p = join(dir, "docs", "delivery", "gates", "DG3.json");
  const text = readFileSync(p, "utf8");
  if (!text.includes(DG3_L3_SENTENCE)) throw new Error("the known DG3 L3 sentence is not in the clone's DG3.json");
  writeFileSync(p, text.replace(DG3_L3_SENTENCE, "where a product gate G4 (distinct from engineering gate DG6; SYNTHETIC rehearsal edit) capacity-conflict item"));
}
