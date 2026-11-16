#!/usr/bin/env node
// Delivery protocol audit over the engineering gate records (T-DG7-DO-I; p7-plan §5.1 row DO-I, slice J of §1.2).
//
//   node tools/release/protocol-audit.mjs (--stage DGx | --all) [--root <repo>] [--json <file>] [--no-git] [--quiet]
//
// Read-only over the repository: it reads docs/delivery/** in place and, when the root is a git repository, older
// versions of progress.md and the add dates of evidence files through `git log` / `git show`. It writes nothing except
// the optional --json report path. Approved records are never rewritten (D-243 Q13): every hit is reported, never fixed.
//
// Checks (one per concern of the DO-I row; each names the requirement and acceptance clause it proves):
//   C1 concurrency          REQ-DLV-009  "overlapping run intervals in docs/delivery/runs/<DGx>/*/meta.json never exceed four"
//   C2 assignment-contract  REQ-DLV-011  "every run's meta.json records an assignment SHA-256 that matches an assignment
//                                         file containing all ten contract elements"
//   C3 handback-sections    REQ-DLV-012  "every implementation task in a gate has a handback with the five sections"
//   C4 file-ownership       REQ-DLV-008  "no two concurrently active assignments share a writable file"
//   C5 historical-first     REQ-DLV-024  "test-evidence contains a passing --historical run for the previous gate, dated
//                                         before the stage's first implementation run"
//   C6 progress-updates     REQ-DLV-028  "progress.md has an update with all six elements and the candidate ID matching
//                                         gates/DGx.json"; REQ-DLV-012 "any task whose handback lists open gaps is not
//                                         reported as complete in progress.md"
//   C7 three-failed-fixes   REQ-DLV-018  "any finding with three failed fix verifications has a blocker entry with a
//                                         recovery plan in progress.md and stages.json"
//   C8 approval-claims      REQ-DLV-027  "no record claims a business, Finance, IT or production approval"; CLAUDE.md
//                                         "Product gate G6 never implies DG7"
//   C9 stage-continuation   REQ-DLV-027/REQ-DLV-040 "each next stage entering BUILDING after the prior APPROVED gate";
//                                         out-of-order history covered by an ACCEPTED_OBSERVATION finding (F-DG6-952) is
//                                         reported as that observation, not as a new hit.
//
// Exit codes: 0 PASS (no hit; every check ran), 1 FAIL (at least one hit), 2 BLOCKED (cannot run: usage error, no
// docs/delivery, or a check that could not run and no hit elsewhere). The summary line says which.
// Pattern-based checks (C2, C3, C6, C8) read prose; every hit carries the matched text so a human can judge it.
// Dependency-free (Node built-ins only); no network.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const TOOL_VERSION = "1.0.0";
export const MAX_CONCURRENT_RUNS = 4; // D-004, REQ-DLV-009

export const IMPLEMENTER_ROLES = Object.freeze([
  "transformation-analyst",
  "solution-architect",
  "frontend-ux-engineer",
  "backend-workflow-engineer",
  "kpi-benefits-engineer",
  "devops-engineer",
]); // docs/delivery/agents.md: the six implementer roles
/** Roles whose runs count as "implementation runs" for C5 (the analyst and architect plan and specify first). */
export const BUILD_ROLES = Object.freeze([
  "frontend-ux-engineer",
  "backend-workflow-engineer",
  "kpi-benefits-engineer",
  "devops-engineer",
]);
export const REVIEW_ROLES = Object.freeze(["domain-reviewer", "code-security-reviewer", "qa-verifier", "release-auditor"]);

/**
 * The ten assignment contract elements (agent-protocol.md "Assignment contract"; REQ-DLV-011 input_fields). Each has
 * one or more regular expressions; an element is present when every group in `all` has at least one match.
 */
export const ASSIGNMENT_ELEMENTS = Object.freeze([
  { id: "stage_id", label: "Stage ID", all: [[/\b(stage|gate)\b[^\n]{0,80}\bDG[0-7]\b|\bDG[0-7]\b[^\n]{0,40}\b(stage|gate)\b|\bP[0-7]\b[^\n]{0,20}\bstage\b/i]] },
  {
    id: "task_and_requirement_ids",
    label: "Task and requirement IDs",
    all: [
      [/\bT-DG[0-7]-[A-Z0-9][A-Z0-9-]*/, /\btask( id)?\b[^\n]{0,20}`[^`]+`/i],
      [/\bREQ-[A-Z0-9]+-\d{3}\b/, /\b(requirement|acceptance)( rows?| ids?| texts?)\b/i, /\bF-DG[0-7]-\d{3}/],
    ],
  },
  {
    id: "source_reference_files",
    label: "Source/reference files",
    all: [[/`docs\/(source|architecture|delivery|analysis|api|operations|handover)\/[^`]+`/, /\bADR-\d{4}\b/, /\bp[0-7]-(plan|work-split)\.md\b/]],
  },
  {
    id: "base_revision",
    label: "Candidate/base revision",
    all: [[/\bbase revision\b/i, /\bcandidate(_id)?\b[^\n]{0,40}sha256:[0-9a-f]{8}/i, /\bsource_commit\b/, /\bgit rev-parse HEAD\b/, /\bbase\b[^\n]{0,30}\bHEAD\b/i, /\bcurrent `?HEAD\b/i, /\b(at|on) (the )?(integrated |current )?`?HEAD`?/i, /\bcommit `?[0-9a-f]{7,40}`?/i, /\bbase\b[^\n]{0,40}`?[0-9a-f]{7,40}`?/i]],
  },
  {
    id: "permitted_files",
    label: "Permitted files",
    all: [[/\bpermitted files\b/i, /\bfiles you may write\b/i, /\byou may (only )?write\b/i, /\b(file )?ownership\b/i, /\byou own\b/i, /\bwrite only\b/i, /\bwrite scope\b/i, /\btouch only\b/i, /\bedit only\b/i, /\bwrite guard\b/i, /\bWrite `docs\/delivery\/reviews\//, /\byour (section|slice)\b/i, /\bowns?\b[^\n]{0,60}`[^`]+\//i]],
  },
  { id: "constraints", label: "Constraints", all: [[/\bconstraints?\b/i, /^#+ .*\brules\b/im, /\bnever\b/i, /\bmust not\b/i, /\bdo not\b/i]] },
  {
    id: "input_output_contracts",
    label: "Input/output contracts",
    all: [[/\bcontracts?\b/i, /\bdeliverables?\b/i, /\binputs?\b[^\n]{0,40}\boutputs?\b/i, /\bschema\b/i, /\bformat\b/i, /\bopenapi\b/i]],
  },
  { id: "acceptance_checks", label: "Acceptance checks", all: [[/\bacceptance\b/i, /\bexits? 0\b/i, /\bverdict\b/i, /\bmust pass\b/i, /\bself-(verification|check)\b/i]] },
  {
    id: "dependency_status",
    label: "Dependency status",
    all: [[/\bdependenc(y|ies)\b/i, /\bdepends on\b/i, /\bpreceding gate\b/i, /\bprevious gates?\b/i, /\bconcurren(cy|t|tly)\b/i, /\bruns? alone\b/i, /\bDG[0-7]\b[^\n]{0,30}\bAPPROVED\b/, /\byou run first\b/i]],
  },
  {
    id: "handback_path",
    label: "Handback path",
    all: [[/docs\/delivery\/handbacks\//, /\bhandback\b/i, /docs\/delivery\/reviews\/DG[0-7]\/round-/, /\bgates\/DG[0-7]\.json\b/]],
  },
]);

/** The five implementation handback sections (agent-protocol.md "Implementation handback contract"; REQ-DLV-012). */
export const HANDBACK_SECTIONS = Object.freeze([
  { id: "changed_files", label: "Changed files", re: /\b(changed files|files changed|files (written|created|touched|modified|delivered)|what (i )?(changed|built|wrote)|file list|deliverables?|files)\b/i },
  { id: "behaviour", label: "Behaviour delivered, per requirement", re: /\b(behaviou?r|delivered|what was built|requirements?|req-|outcome|results? per)\b/i },
  { id: "checks_run", label: "Checks actually run", re: /\b(checks?|tests?( run)?|verification|commands?|exit (codes?|status)|validation)\b/i },
  { id: "known_gaps", label: "Known gaps / not done", re: /\b(gaps?|not done|what remains|remaining|remains|undone|unfinished|open (items|questions|issues)|limitations?|residuals?|blocked|deviations?)\b/i },
  { id: "merge_instructions", label: "Merge instructions", re: /\b(merge|integration (notes|instructions|order)|for the orchestrator)\b/i },
]);

/** The six gate-update elements (REQ-DLV-028 input_fields). `cand` is the 8-hex candidate prefix of gates/DGx.json. */
export const PROGRESS_ELEMENTS = Object.freeze([
  { id: "stage_and_candidate", label: "Stage and candidate" },
  { id: "capabilities", label: "Capabilities demonstrated", re: /\b(requirements?|capabilit\w*|DG[0-7]-final|scope|in scope|delivered|demonstrat\w*|\d+\/\d+)\b/i },
  { id: "reviewer_verdicts", label: "Reviewers and verdicts", re: /\b(PASS|FAIL|BLOCKED)\b[^\n]{0,120}\b(domain|code-security|qa|auditor|audit|review)|\b(domain|code-security|qa|auditor|audit|review\w*)\b[^\n]{0,120}\b(PASS|FAIL|BLOCKED)\b/i },
  { id: "findings_fixed", label: "Findings fixed", re: /\b(findings?|F-DG[0-7]-\d{3}|CLOSED_VERIFIED|ACCEPTED_OBSERVATION)\b/i },
  { id: "blockers", label: "Remaining blockers", re: /\b(blockers?|blocking|unresolved|Critical\/High|mandatory violations?)\b/i },
  { id: "next_stage", label: "Next stage", re: /\b(next( action| stage)?|then DG[0-7]|DG[1-7] \(|starts? (DG|P)[0-7])\b/i },
]);

const NEGATION = /\b(no|not|never|nor|none|nothing|nobody|cannot|can't|without|neither|isn't|doesn't|don't|won't|must not|untouched|unaffected|unrelated|n't)\b/i;

// ---------------------------------------------------------------------------------------------------------------- io

class Blocked extends Error {}

function readText(path) {
  return readFileSync(path, "utf8");
}
function readJson(path) {
  return JSON.parse(readText(path));
}
function listDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}
function walkFiles(dir, filter, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, filter, out);
    else if (e.isFile() && filter(p)) out.push(p);
  }
  return out;
}
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const toPosix = (p) => p.split(sep).join("/");

/** A git helper bound to the root; disabled when the root is not a repository or --no-git is given. */
export function makeGit(root, enabled = true) {
  let ok = false;
  if (enabled) {
    try {
      ok = execFileSync("git", ["-C", root, "rev-parse", "--show-toplevel"], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() === resolve(root);
    } catch {
      ok = false;
    }
  }
  const run = (args) => execFileSync("git", ["-C", root, ...args], { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 }).toString();
  const addDates = new Map();
  return {
    ok,
    head() {
      return ok ? run(["rev-parse", "HEAD"]).trim() : null;
    },
    /** [{commit, date, text}] for every committed version of a file, newest first. */
    versions(path) {
      if (!ok) return [];
      const lines = run(["log", "--format=%H %cI", "--", path]).trim().split("\n").filter(Boolean);
      const out = [];
      for (const l of lines) {
        const [commit, date] = l.split(" ");
        try {
          out.push({ commit, date, text: run(["show", `${commit}:${path}`]) });
        } catch {
          /* the file did not exist at that commit (a delete) */
        }
      }
      return out;
    },
    /** Author date of the commit that first added each file under a prefix (one git log call per prefix). */
    addDates(prefix) {
      if (!ok) return new Map();
      if (addDates.has(prefix)) return addDates.get(prefix);
      const m = new Map();
      const out = run(["log", "--diff-filter=A", "--format=@%aI", "--name-only", "--", prefix]);
      let date = null;
      for (const line of out.split("\n")) {
        if (line.startsWith("@")) date = line.slice(1);
        else if (line.trim()) m.set(line.trim(), date); // log is newest first: the last assignment is the first add
      }
      addDates.set(prefix, m);
      return m;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------- records

/** Loads every run of a gate. Directories without meta.json are returned separately (no interval can be computed). */
export function loadRuns(root, stage) {
  const dir = join(root, "docs", "delivery", "runs", stage);
  const runs = [];
  const unbounded = [];
  for (const name of listDirs(dir)) {
    const metaPath = join(dir, name, "meta.json");
    if (!existsSync(metaPath)) {
      const m = /-(\d{8}T\d{6}Z)/.exec(name);
      unbounded.push({ run_dir: `docs/delivery/runs/${stage}/${name}`, started_from_name: m ? isoFromCompact(m[1]) : null, files: readdirSync(join(dir, name)).sort() });
      continue;
    }
    let meta;
    try {
      meta = readJson(metaPath);
    } catch (e) {
      unbounded.push({ run_dir: `docs/delivery/runs/${stage}/${name}`, error: `meta.json unreadable: ${e.message}` });
      continue;
    }
    runs.push({ ...meta, run_dir: `docs/delivery/runs/${stage}/${name}`, start: Date.parse(meta.started_at), end: Date.parse(meta.finished_at) });
  }
  return { runs, unbounded };
}
function isoFromCompact(s) {
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;
}

export function stageIds(root) {
  const runsDir = join(root, "docs", "delivery", "runs");
  return listDirs(runsDir).filter((s) => /^DG[0-7]$/.test(s));
}

function loadStages(root) {
  const p = join(root, "docs", "delivery", "stages.json");
  if (!existsSync(p)) return null;
  const s = readJson(p);
  const arr = Array.isArray(s.stages) ? s.stages : Object.values(s.stages ?? {});
  return new Map(arr.map((x) => [x.id ?? x.stage_id, x]));
}
function loadFindings(root) {
  const p = join(root, "docs", "delivery", "findings.json");
  if (!existsSync(p)) return null;
  const f = readJson(p);
  return Array.isArray(f) ? f : (f.findings ?? []);
}
function loadGate(root, stage) {
  const p = join(root, "docs", "delivery", "gates", `${stage}.json`);
  return existsSync(p) ? readJson(p) : null;
}

// --------------------------------------------------------------------------------------------- C1 concurrency

/** Sweep over [start, end) intervals: the maximum number of simultaneously active runs and one peak window. */
export function maxOverlap(runs) {
  const ev = [];
  for (const r of runs) {
    if (!Number.isFinite(r.start) || !Number.isFinite(r.end)) continue;
    ev.push([r.start, 1, r], [Math.max(r.end, r.start), -1, r]);
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]); // an end at t frees its slot before a start at t
  let cur = 0;
  let max = 0;
  let peakAt = null;
  const active = new Set();
  let peakRuns = [];
  for (const [t, d, r] of ev) {
    if (d === 1) active.add(r);
    else active.delete(r);
    cur += d;
    if (cur > max) {
      max = cur;
      peakAt = t;
      peakRuns = [...active];
    }
  }
  return { max, peakAt: peakAt === null ? null : new Date(peakAt).toISOString(), peakRuns };
}

/** Every maximal window in which more than `limit` runs were active (each window listed once). */
export function overLimitWindows(runs, limit) {
  const ev = [];
  for (const r of runs) {
    if (!Number.isFinite(r.start) || !Number.isFinite(r.end)) continue;
    ev.push([r.start, 1, r], [Math.max(r.end, r.start), -1, r]);
  }
  ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const active = new Set();
  const windows = [];
  let open = null;
  for (const [t, d, r] of ev) {
    if (d === 1) active.add(r);
    else active.delete(r);
    if (active.size > limit) {
      if (!open) open = { from: t, max: active.size, runs: new Set(active) };
      open.max = Math.max(open.max, active.size);
      for (const a of active) open.runs.add(a);
    } else if (open) {
      windows.push({ from: new Date(open.from).toISOString(), to: new Date(t).toISOString(), max_active: open.max, runs: [...open.runs].map((x) => x.run_id) });
      open = null;
    }
  }
  return windows;
}

export function checkConcurrency(ctx, stage) {
  const { runs, unbounded } = ctx.runs(stage);
  const o = maxOverlap(runs);
  const windows = overLimitWindows(runs, MAX_CONCURRENT_RUNS);
  const hits = windows.map((w) => ({ stage, kind: "overlap-above-limit", ...w, limit: MAX_CONCURRENT_RUNS }));
  const bad = runs.filter((r) => !Number.isFinite(r.start) || !Number.isFinite(r.end) || r.end < r.start);
  for (const r of bad) hits.push({ stage, kind: "bad-interval", run_id: r.run_id, started_at: r.started_at, finished_at: r.finished_at });
  return {
    stats: { runs_with_meta: runs.length, runs_without_meta: unbounded.length, max_concurrent: o.max, peak_at: o.peakAt, peak_runs: o.peakRuns.map((r) => r.run_id), limit: MAX_CONCURRENT_RUNS },
    hits,
    notes: unbounded.length ? [{ kind: "runs-without-meta", detail: "no finished_at, so not counted in the overlap; listed for disclosure", runs: unbounded }] : [],
  };
}

// ---------------------------------------------------------------------------------------- C2 assignment contract

export function assignmentElements(text) {
  const found = {};
  for (const el of ASSIGNMENT_ELEMENTS) {
    const evidence = [];
    let ok = true;
    for (const group of el.all) {
      let hit = null;
      for (const re of group) {
        const m = re.exec(text);
        if (m) {
          hit = m[0].slice(0, 120);
          break;
        }
      }
      if (!hit) ok = false;
      else evidence.push(hit);
    }
    found[el.id] = ok ? evidence : null;
  }
  const missing = ASSIGNMENT_ELEMENTS.filter((e) => !found[e.id]).map((e) => e.id);
  return { found, missing };
}

/** Text of files an assignment names as binding: other assignment files (e.g. review-common.md) and a work-split § section. */
export function referencedText(root, selfPath, text) {
  const refs = [];
  const parts = [];
  for (const m of text.matchAll(/docs\/delivery\/assignments\/[A-Za-z0-9_./-]+\.md/g)) {
    const p = m[0];
    if (p === selfPath || refs.includes(p) || !existsSync(join(root, p))) continue;
    refs.push(p);
    parts.push(readText(join(root, p)));
  }
  const ws = workSplitSection(root, text);
  if (ws) {
    refs.push(ws.ref);
    parts.push(ws.text);
  }
  return { refs, text: parts.join("\n") };
}

export function checkAssignments(ctx, stage) {
  const { runs } = ctx.runs(stage);
  const seen = new Map();
  const hits = [];
  const notes = [];
  const byReference = [];
  for (const r of runs) {
    if (!r.assignment) {
      hits.push({ stage, kind: "run-without-assignment", run_id: r.run_id });
      continue;
    }
    if (seen.has(r.assignment)) {
      seen.get(r.assignment).runs.push(r.run_id);
      continue;
    }
    const entry = { assignment: r.assignment, runs: [r.run_id] };
    seen.set(r.assignment, entry);
    const abs = join(ctx.root, r.assignment);
    if (!existsSync(abs)) {
      hits.push({ stage, kind: "assignment-file-missing", assignment: r.assignment, run_id: r.run_id });
      continue;
    }
    const buf = readFileSync(abs);
    const cur = sha256(buf);
    let text = buf.toString("utf8");
    if (r.assignment_sha256 && r.assignment_sha256 !== cur) {
      // Audit the bytes the run actually received when git still has them.
      const v = ctx.git.ok ? ctx.git.versions(r.assignment).find((x) => sha256(Buffer.from(x.text, "utf8")) === r.assignment_sha256) : null;
      if (v) {
        text = v.text;
        notes.push({ kind: "assignment-changed-after-run", assignment: r.assignment, run_id: r.run_id, audited_version: v.commit });
      } else {
        hits.push({ stage, kind: "assignment-sha-mismatch", assignment: r.assignment, run_id: r.run_id, recorded: r.assignment_sha256, current: cur });
      }
    } else if (!r.assignment_sha256) {
      hits.push({ stage, kind: "run-without-assignment-sha", assignment: r.assignment, run_id: r.run_id });
    }
    const own = assignmentElements(text);
    entry.missing = own.missing;
    if (!own.missing.length) continue;
    // An element may be supplied by a file the assignment names as binding (a shared review-common.md, or the
    // work-split section that holds the file ownership and requirement table). Reported as "by reference".
    const ref = referencedText(ctx.root, r.assignment, text);
    const all = ref.text ? assignmentElements(`${text}\n${ref.text}`) : own;
    const byRef = own.missing.filter((m) => !all.missing.includes(m));
    if (byRef.length) byReference.push({ assignment: r.assignment, elements: byRef, via: ref.refs });
    if (all.missing.length) hits.push({ stage, kind: "assignment-missing-elements", assignment: r.assignment, role: r.role, missing: all.missing, ...(byRef.length ? { supplied_by_reference: byRef, via: ref.refs } : {}) });
  }
  if (byReference.length) notes.push({ kind: "elements-supplied-by-reference", detail: "present only in a file the assignment names as binding (one level)", count: byReference.length, items: byReference });
  return { stats: { assignments_audited: seen.size, runs: runs.length, assignments_complete_in_own_text: [...seen.values()].filter((e) => e.missing && !e.missing.length).length, assignments_complete_by_reference: byReference.filter((b) => !hits.some((h) => h.assignment === b.assignment)).length, elements: ASSIGNMENT_ELEMENTS.map((e) => e.label) }, hits, notes };
}

// --------------------------------------------------------------------------------------- C3 handback sections

/** Headings (#..####) and bold-led lines ("**Changed files**", "1. **Checks run**") with their bodies. */
export function handbackBlocks(text) {
  const lines = text.split("\n");
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    const h = /^(#{1,4})\s+(.*)$/.exec(line) || /^(?:\d+\.\s+|-\s+)?\*\*([^*]{3,80})\*\*/.exec(line);
    if (h) {
      cur = { title: (h[2] ?? h[1]).trim(), body: [] };
      blocks.push(cur);
    } else if (cur) cur.body.push(line);
  }
  return blocks.map((b) => ({ title: b.title, body: b.body.join("\n").trim() }));
}

export function handbackSections(text) {
  const blocks = handbackBlocks(text);
  const found = {};
  for (const s of HANDBACK_SECTIONS) {
    const b = blocks.find((x) => s.re.test(x.title));
    found[s.id] = b ? b.title : null;
  }
  return { found, missing: HANDBACK_SECTIONS.filter((s) => !found[s.id]).map((s) => s.id), blocks };
}

const TRIVIAL_GAPS = /^(none\b|nothing\b|no (known )?(gaps?|open|remaining|unfinished)|n\/a\b|—$|-$|all (delivered|done)\b)/i;
/** The open-gaps text of a handback, or null when the gaps section says none. */
export function openGaps(text) {
  const { blocks } = handbackSections(text);
  const g = blocks.find((x) => HANDBACK_SECTIONS[3].re.test(x.title));
  if (!g) return null;
  const body = g.body.replace(/^[-*\s>_]+/, "").trim();
  if (!body || TRIVIAL_GAPS.test(body) || body.length < 12) return null;
  return body.slice(0, 300);
}

function implementationHandbacks(ctx, stage) {
  const dir = join(ctx.root, "docs", "delivery", "handbacks", stage);
  if (!existsSync(dir)) return [];
  const re = new RegExp(`^(T-${stage}-[A-Za-z0-9-]+?)-(${IMPLEMENTER_ROLES.join("|")})\\.md$`);
  return readdirSync(dir)
    .filter((f) => re.test(f))
    .sort()
    .map((f) => {
      const m = re.exec(f);
      return { path: `docs/delivery/handbacks/${stage}/${f}`, task: m[1], role: m[2] };
    });
}

export function checkHandbacks(ctx, stage) {
  const hbs = implementationHandbacks(ctx, stage);
  const hits = [];
  const notes = [];
  const byTask = new Set(hbs.map((h) => h.task));
  for (const h of hbs) {
    const { missing } = handbackSections(readText(join(ctx.root, h.path)));
    if (missing.length) hits.push({ stage, kind: "handback-missing-sections", handback: h.path, role: h.role, missing });
  }
  // Implementation runs with no handback at the conventional path.
  const { runs } = ctx.runs(stage);
  const noHandback = [];
  for (const r of runs) {
    if (!IMPLEMENTER_ROLES.includes(r.role) || !r.task || byTask.has(r.task)) continue;
    const written = (r.written_by_tools ?? []).filter((p) => /handback/i.test(p) || /HANDBACK/.test(p));
    noHandback.push({ run_id: r.run_id, task: r.task, other_handback_paths: written });
  }
  if (noHandback.length) notes.push({ kind: "implementation-runs-without-conventional-handback", detail: "task id has no docs/delivery/handbacks/<stage>/<task>-<role>.md (plan or orphaned runs; a re-run's handback is under the same task)", runs: noHandback });
  return { stats: { implementation_handbacks: hbs.length, sections: HANDBACK_SECTIONS.map((s) => s.label) }, hits, notes };
}

// ---------------------------------------------------------------------------------------- C4 file ownership

const PATH_TOKEN = /`([^`\s]+)`/g;
function looksLikePath(s) {
  if (/^(https?:|sha256:|--|\$|node |pnpm )/.test(s)) return false;
  if (/^[0-9a-f]{7,40}$/.test(s)) return false;
  return /\//.test(s) && /^[A-Za-z0-9_.@{}*\-[\]/,]+$/.test(s);
}
/** Expands a single level of {a,b} braces. */
function expandBraces(p) {
  const m = /\{([^{}]+)\}/.exec(p);
  if (!m) return [p];
  return m[1].split(",").flatMap((alt) => expandBraces(p.slice(0, m.index) + alt + p.slice(m.index + m[0].length)));
}

/** A line that names paths the task must NOT write (forbidden, frozen, read-only) declares no ownership. */
const FORBID_LINE = /\b(never|not|forbid\w*|frozen|read-only|do not|don't|must not|nothing else|owned by|belongs? to)\b/i;
/** A repository root or top-level folder is not a file-ownership declaration. */
const TOO_BROAD = /^(\.?[A-Za-z0-9_-]+\/?(\*\*)?|\.\/?)$/;
const OWN_LABEL = /(permitted files|files you may write|you may (only )?write|file ownership|ownership|files you own|you own|your files|^creates:?$|^owns:?$|^\*\*creates|write scope)/i;
/** Declared writable paths of an assignment: the backtick paths of its permitted-files block(s). */
export function declaredPaths(text) {
  const lines = text.split("\n");
  const out = new Set();
  let inBlock = false;
  let blockIndent = 0;
  let blockLevel = 0;
  for (const line of lines) {
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^(\s*)[-*]\s+\*\*([^*]+)\*\*/.exec(line);
    if (h) {
      if (inBlock && h[1].length <= blockLevel) inBlock = false;
      if (OWN_LABEL.test(h[2])) {
        inBlock = true;
        blockLevel = h[1].length;
        blockIndent = -1;
        continue;
      }
    } else if (bullet) {
      const indent = bullet[1].length;
      if (inBlock && blockIndent >= 0 && indent <= blockIndent) inBlock = false;
      if (OWN_LABEL.test(bullet[2])) {
        inBlock = true;
        blockIndent = indent;
        blockLevel = 7;
      }
    } else if (inBlock && blockIndent >= 0 && /^\S/.test(line) && line.trim()) {
      inBlock = false;
    }
    if (!inBlock || FORBID_LINE.test(line)) continue;
    for (const m of line.matchAll(PATH_TOKEN)) if (looksLikePath(m[1])) for (const p of expandBraces(m[1].replace(/^\.\//, ""))) if (!TOO_BROAD.test(p)) out.add(p);
  }
  return [...out].sort();
}

/** The ownership rows of a work-split section (`§X`) named by the assignment: first-cell backtick paths and Creates lines. */
/** The `## §X` section of the pN-work-split.md an assignment names ("§E/F.1 of p6-work-split.md" or "p6-work-split.md §E"). */
export function workSplitSection(root, text) {
  const m = /`?(?:docs\/architecture\/)?(p[0-7]-work-split\.md)`?\s*§\s*([A-Z](?:\/[A-Z])?(?:\.\d+)?)/.exec(text) || /§\s*([A-Z](?:\/[A-Z])?(?:\.\d+)?)\s+of\s+`?(?:docs\/architecture\/)?(p[0-7]-work-split\.md)`?/.exec(text);
  if (!m) return null;
  const [file, secRef] = /work-split/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
  const abs = join(root, "docs", "architecture", file);
  if (!existsSync(abs)) return null;
  const lines = readText(abs).split("\n");
  const sec = secRef.split(/[/.]/)[0];
  const start = lines.findIndex((l) => new RegExp(`^##\\s+§${sec}\\b`).test(l));
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^##\s/.test(lines[end])) end++;
  // The task's own subsection ("### A.1 …", "### E/F.1 …") when the reference names one; else the whole section.
  let sub = null;
  if (/\.\d+$/.test(secRef)) {
    const esc = secRef.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
    const s0 = lines.findIndex((l, i) => i > start && i < end && new RegExp(`^###\\s+§?${esc}\\s`).test(l));
    if (s0 > 0) {
      let s1 = s0 + 1;
      while (s1 < end && !/^###?\s/.test(lines[s1])) s1++;
      sub = lines.slice(s0 + 1, s1);
    }
  }
  return { ref: `docs/architecture/${file} §${secRef}`, lines: sub ?? lines.slice(start + 1, end), text: lines.slice(start, end).join("\n") };
}

export function workSplitPaths(root, text) {
  const ws = workSplitSection(root, text);
  if (!ws) return { ref: null, paths: [] };
  const out = new Set();
  for (const l of ws.lines) {
    if (FORBID_LINE.test(l.split("|").slice(0, 2).join("|"))) continue;
    const cell = /^\|\s*`([^`]+)`/.exec(l);
    if (cell && looksLikePath(cell[1])) for (const p of expandBraces(cell[1])) if (!TOO_BROAD.test(p)) out.add(p);
    if (/^-?\s*\*\*(Creates|Owns|Modifies|Changes)/.test(l)) for (const t of l.matchAll(PATH_TOKEN)) if (looksLikePath(t[1])) for (const p of expandBraces(t[1])) if (!TOO_BROAD.test(p)) out.add(p);
  }
  return { ref: ws.ref, paths: [...out].sort() };
}

function globRe(p) {
  const esc = p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*");
  return new RegExp(`^${esc}${p.endsWith("/") ? ".*" : ""}$`);
}
const staticPrefix = (p) => p.split(/[*]/)[0];
/** True when two declared path patterns can name the same file. */
export function pathsOverlap(a, b) {
  if (a === b) return true;
  const ga = /\*|\/$/.test(a);
  const gb = /\*|\/$/.test(b);
  if (!ga && !gb) return false;
  if (ga && !gb) return globRe(a).test(b);
  if (!ga && gb) return globRe(b).test(a);
  const pa = staticPrefix(a);
  const pb = staticPrefix(b);
  return pa.startsWith(pb) || pb.startsWith(pa);
}
/** Paths every task writes for itself or that the protocol shares by design (never an ownership conflict). */
const NOT_OWNERSHIP = /^docs\/delivery\/(handbacks|runs|reviews|test-evidence)\/|^\$TMPDIR|^\/|^tmp\//;

export function checkOwnership(ctx, stage) {
  const { runs } = ctx.runs(stage);
  const decl = new Map();
  for (const r of runs) {
    if (!r.assignment || decl.has(r.assignment)) continue;
    const abs = join(ctx.root, r.assignment);
    if (!existsSync(abs)) {
      decl.set(r.assignment, { paths: [], source: "missing" });
      continue;
    }
    const text = readText(abs);
    let paths = declaredPaths(text);
    let source = "assignment";
    if (!paths.length) {
      const ws = workSplitPaths(ctx.root, text);
      if (ws.paths.length) {
        paths = ws.paths;
        source = `work-split ${ws.ref}`;
      }
    }
    decl.set(r.assignment, { paths: paths.filter((p) => !NOT_OWNERSHIP.test(p)), source });
  }
  const hits = [];
  const sorted = runs.filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end)).sort((a, b) => a.start - b.start);
  let pairs = 0;
  let withDecl = 0;
  const scopeNotes = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].start < sorted[i].end; j++) {
      const a = sorted[i];
      const b = sorted[j];
      if (a.assignment === b.assignment) continue;
      pairs++;
      // Actual writes: files both runs wrote with their own tools while both were active.
      const wa = new Set((a.written_by_tools ?? []).filter((p) => !NOT_OWNERSHIP.test(p)));
      const sharedWritten = (b.written_by_tools ?? []).filter((p) => wa.has(p) && !NOT_OWNERSHIP.test(p));
      const da = decl.get(a.assignment)?.paths ?? [];
      const db = decl.get(b.assignment)?.paths ?? [];
      if (da.length && db.length) withDecl++;
      const sharedDeclared = [];
      const scopeOverlap = [];
      for (const x of da) for (const y of db) if (pathsOverlap(x, y)) (x === y && !/\*|\/$/.test(x) ? sharedDeclared : scopeOverlap).push(x === y ? x : `${x} ~ ${y}`);
      if (!sharedWritten.length && !sharedDeclared.length && scopeOverlap.length) {
        scopeNotes.push({ runs: [a.run_id, b.run_id], assignments: [a.assignment, b.assignment], scope_overlap: [...new Set(scopeOverlap)].slice(0, 10) });
      }
      if (sharedWritten.length || sharedDeclared.length) {
        hits.push({
          stage,
          kind: sharedWritten.length ? "concurrent-runs-wrote-same-file" : "concurrent-assignments-declare-same-file",
          runs: [a.run_id, b.run_id],
          assignments: [a.assignment, b.assignment],
          declared_from: [decl.get(a.assignment)?.source ?? null, decl.get(b.assignment)?.source ?? null],
          overlap: [new Date(Math.max(a.start, b.start)).toISOString(), new Date(Math.min(a.end, b.end)).toISOString()],
          shared_written: sharedWritten,
          shared_declared: [...new Set(sharedDeclared)].slice(0, 20),
          scope_overlap: [...new Set(scopeOverlap)].slice(0, 10),
        });
      }
    }
  }
  const noDecl = [...decl].filter(([, v]) => !v.paths.length).map(([k]) => k);
  return {
    stats: { concurrent_pairs: pairs, pairs_with_both_declarations: withDecl, assignments: decl.size, assignments_without_declared_paths: noDecl.length },
    hits,
    notes: [
      ...(noDecl.length ? [{ kind: "assignments-without-declared-paths", detail: "no permitted-files list or work-split section found; only actual writes (written_by_tools) are compared for these", count: noDecl.length, assignments: noDecl }] : []),
      ...(scopeNotes.length ? [{ kind: "declared-scope-overlap-writes-disjoint", detail: "directory or glob scopes overlap, no concrete file is named by both, and the runs' own writes are disjoint", count: scopeNotes.length, pairs: scopeNotes }] : []),
    ],
  };
}

// ------------------------------------------------------------------------------------- C5 --historical first

const PASS_MARK = /\b(exit(ed)?( code| status)?[:= ]+0\b|exits? 0\b|PASS\b|"exit_status":\s*0|OK\b)/i;
function historicalRe(prev) {
  return new RegExp(`--historical[^\\n]{0,40}--stage[= ]${prev}\\b|--stage[= ]${prev}\\b[^\\n]{0,40}--historical`);
}

export function checkHistorical(ctx, stage) {
  const n = Number(stage.slice(2));
  if (n === 0) return { stats: { applicable: false, reason: "P0 has no preceding gate" }, hits: [], notes: [] };
  const prev = `DG${n - 1}`;
  const re = historicalRe(prev);
  const { runs } = ctx.runs(stage);
  const build = runs.filter((r) => BUILD_ROLES.includes(r.role) && Number.isFinite(r.start)).sort((a, b) => a.start - b.start);
  const anyImpl = runs.filter((r) => IMPLEMENTER_ROLES.includes(r.role) && Number.isFinite(r.start)).sort((a, b) => a.start - b.start);
  const first = build[0] ?? null;
  // Producer index: which run wrote each evidence file (its finished_at bounds the evidence date).
  const producer = new Map();
  for (const r of runs) {
    for (const p of [...(r.written_by_tools ?? []), ...Object.keys(r.outputs ?? {})]) {
      const prev = producer.get(p);
      if (!prev || r.end < prev.end) producer.set(p, r); // the earliest run that wrote it
    }
  }
  const tePrefix = `docs/delivery/test-evidence/${stage}`;
  const addDates = ctx.git.addDates(tePrefix);
  const files = walkFiles(join(ctx.root, tePrefix), (p) => /\.(log|txt|md|json|out)$/i.test(p) && statSync(p).size < 4 * 1024 * 1024);
  const evidence = [];
  for (const abs of files) {
    const text = readText(abs);
    if (!re.test(text)) continue;
    const rel = toPosix(relative(ctx.root, abs));
    const passed = PASS_MARK.test(text);
    const prod = producer.get(rel);
    const inFile = [...text.matchAll(/\b(20\d\d-\d\d-\d\dT\d\d:\d\d:\d\dZ)\b/g)].map((m) => m[1]).sort()[0] ?? null;
    let date = null;
    let source = "none";
    if (prod) [date, source] = [prod.finished_at, `finished_at of ${prod.run_id}`];
    else if (addDates.get(rel)) [date, source] = [addDates.get(rel), "git add date"];
    else if (inFile) [date, source] = [inFile, "earliest timestamp in the file"];
    evidence.push({ path: rel, passed, dated: date, date_source: source });
  }
  const before = first ? evidence.filter((e) => e.passed && e.dated && Date.parse(e.dated) < first.start) : evidence.filter((e) => e.passed);
  // Records (not test-evidence) that state the run: handbacks of this stage, decisions.md, progress.md.
  const recordHits = [];
  const recordBefore = [];
  for (const h of walkFiles(join(ctx.root, "docs", "delivery", "handbacks", stage), (p) => p.endsWith(".md"))) {
    if (!re.test(readText(h))) continue;
    const rel = toPosix(relative(ctx.root, h));
    recordHits.push(rel);
    const prod = producer.get(rel);
    if (prod && first && prod.start < first.start) recordBefore.push({ handback: rel, run_id: prod.run_id, run_started_at: prod.started_at, run_finished_at: prod.finished_at });
  }
  const decisions = join(ctx.root, "docs", "delivery", "decisions.md");
  if (existsSync(decisions) && readText(decisions).split("\n").some((l) => re.test(l) && /\bP?DG?\d?\b/.test(l) && new RegExp(`\\b${stage}\\b|\\bP${n}\\b`).test(l))) recordHits.push("docs/delivery/decisions.md");
  const hits = [];
  if (!before.length) {
    hits.push({
      stage,
      kind: evidence.length ? "historical-evidence-not-before-first-implementation" : "historical-evidence-missing-from-test-evidence",
      previous_gate: prev,
      first_implementation_run: first ? { run_id: first.run_id, started_at: first.started_at } : null,
      test_evidence_found: evidence.slice(0, 10),
      stated_in_records: recordHits.slice(0, 15),
      stated_by_runs_started_before_first_implementation: recordBefore,
    });
  }
  return {
    stats: {
      previous_gate: prev,
      first_implementation_run: first ? { run_id: first.run_id, started_at: first.started_at } : null,
      first_implementer_role_run: anyImpl[0] ? { run_id: anyImpl[0].run_id, role: anyImpl[0].role, started_at: anyImpl[0].started_at } : null,
      test_evidence_files: evidence.length,
      passing_before_first_implementation: before.map((e) => e.path),
      records_stating_the_run: recordHits.length,
    },
    hits,
    notes: [],
  };
}

// -------------------------------------------------------------------------------------- C6 progress updates

/** Splits a progress.md text into update blocks: each top-level bullet with its sub-bullets, and each ## section. */
export function progressBlocks(text) {
  const blocks = [];
  const lines = text.split("\n");
  let section = null;
  let bullet = null;
  for (const line of lines) {
    if (/^#{1,4}\s/.test(line)) {
      section = { kind: "section", text: line };
      blocks.push(section);
      bullet = null;
      continue;
    }
    if (section) section.text += `\n${line}`;
    if (/^- /.test(line)) {
      bullet = { kind: "bullet", text: line };
      blocks.push(bullet);
    } else if (bullet && /^\s+\S/.test(line)) bullet.text += `\n${line}`;
    else if (!line.trim()) {
      /* blank line keeps the bullet open */
    } else bullet = null;
  }
  return blocks;
}

export function progressElements(block, stage, candidatePrefix) {
  const out = {};
  out.stage_and_candidate = new RegExp(`\\b${stage}\\b`).test(block) && !!candidatePrefix && block.includes(candidatePrefix);
  for (const e of PROGRESS_ELEMENTS.slice(1)) out[e.id] = e.re.test(block);
  return out;
}

function progressVersions(ctx) {
  const path = "docs/delivery/progress.md";
  const abs = join(ctx.root, path);
  const cur = existsSync(abs) ? [{ commit: "working-tree", date: null, text: readText(abs) }] : [];
  return [...cur, ...ctx.git.versions(path)];
}

export function checkProgress(ctx, stage) {
  const hits = [];
  const notes = [];
  const gate = loadGate(ctx.root, stage);
  const stats = { gate_decision: gate?.decision ?? null };
  const versions = ctx.progressVersions();
  stats.progress_versions_read = versions.length;
  if (gate && gate.decision === "APPROVED") {
    const prefix = String(gate.candidate_id ?? "").replace(/^sha256:/, "").slice(0, 8);
    const approvedRe = new RegExp(`\\b${stage}\\b[^\\n]{0,120}\\bAPPROVED\\b|\\bAPPROVED\\b[^\\n]{0,40}\\b${stage}\\b`);
    let best = null;
    for (const v of versions) {
      for (const b of progressBlocks(v.text)) {
        if (!approvedRe.test(b.text)) continue;
        const el = progressElements(b.text, stage, prefix);
        const score = Object.values(el).filter(Boolean).length;
        if (!best || score > best.score) best = { score, el, version: v.commit, date: v.date, excerpt: b.text.slice(0, 240) };
        if (score === 6) break;
      }
      if (best?.score === 6) break;
    }
    stats.gate_update = best ? { version: best.version, elements_present: best.score, of: 6 } : null;
    if (!best || best.score < 6) {
      hits.push({
        stage,
        kind: best ? "gate-update-missing-elements" : "gate-update-missing",
        candidate_prefix: prefix,
        best_update: best ? { version: best.version, missing: PROGRESS_ELEMENTS.filter((e) => !best.el[e.id]).map((e) => e.id), excerpt: best.excerpt } : null,
      });
    }
  } else stats.gate_update = "not applicable (gate not APPROVED)";
  // Open gaps reported complete (REQ-DLV-012 clause 2).
  const statements = [];
  const decisionsAbs = join(ctx.root, "docs", "delivery", "decisions.md");
  const sources = [...versions.map((v) => ({ where: `progress.md@${v.commit}`, text: v.text })), ...(existsSync(decisionsAbs) ? [{ where: "decisions.md", text: readText(decisionsAbs) }] : [])];
  let withGaps = 0;
  for (const h of implementationHandbacks(ctx, stage)) {
    const gaps = openGaps(readText(join(ctx.root, h.path)));
    if (!gaps) continue;
    withGaps++;
    const taskRe = new RegExp(`${h.task.replace(/[-]/g, "\\-")}(?![A-Za-z0-9-])`);
    for (const s of sources) {
      for (const line of s.text.split("\n")) {
        if (!taskRe.test(line)) continue;
        const clauses = line.split(/[;.]\s|<br>/).filter((c) => taskRe.test(c));
        for (const c of clauses) {
          if (/\b(complete|completed|done|finished|fully delivered)\b/i.test(c) && !/\b(gaps?|remain\w*|open|follow-?up|partial\w*|not (done|complete)|unfinished|incomplete|carried|repair|second half|rest|pending|BLOCKED|except|but)\b/i.test(c) && !/\bW\d+ (is )?complete\b/i.test(c)) {
            statements.push({ handback: h.path, task: h.task, where: s.where, statement: c.trim().slice(0, 240), handback_gaps: gaps.slice(0, 160) });
          }
        }
      }
    }
  }
  stats.handbacks_with_open_gaps = withGaps;
  const dedup = new Map();
  for (const s of statements) dedup.set(`${s.task}|${s.statement}`, s);
  for (const s of dedup.values()) hits.push({ stage, kind: "task-with-open-gaps-reported-complete", ...s });
  return { stats, hits, notes };
}

// ------------------------------------------------------------------------------------ C7 three failed fixes

/** Failed fix verifications of a finding: FIXED_PENDING_VERIFICATION followed by OPEN in its history. */
export function failedFixCount(finding) {
  let n = 0;
  let pending = false;
  for (const h of finding.history ?? []) {
    if (h.status === "FIXED_PENDING_VERIFICATION") pending = true;
    else if (h.status === "OPEN" && pending) {
      n++;
      pending = false;
    } else if (h.status !== "OPEN") pending = false;
  }
  return n;
}

export function checkFailedFixes(ctx, stage) {
  const findings = (ctx.findings ?? []).filter((f) => f.stage_id === stage);
  const hits = [];
  const counted = [];
  const blockerSources = () => [
    ...ctx.progressVersions().map((v) => ({ where: `progress.md@${v.commit}`, text: v.text })),
    { where: "stages.json", text: existsSync(join(ctx.root, "docs/delivery/stages.json")) ? readText(join(ctx.root, "docs/delivery/stages.json")) : "" },
    { where: "decisions.md", text: existsSync(join(ctx.root, "docs/delivery/decisions.md")) ? readText(join(ctx.root, "docs/delivery/decisions.md")) : "" },
  ];
  for (const f of findings) {
    const n = failedFixCount(f);
    if (n > 0) counted.push({ id: f.id, failed_fix_verifications: n });
    if (n < 3) continue;
    const where = [];
    for (const s of blockerSources()) {
      // Prose: paragraphs and list items; JSON (stages.json): one line per history note.
      const paras = s.where === "stages.json" ? s.text.split("\n") : s.text.split(/\n\s*\n|\n(?=- |\| D-)/);
      for (const para of paras) {
        if (para.includes(f.id) && /\b(blocker|BLOCKED)\b/i.test(para) && /\b(recovery|plan|root[- ]cause)\b/i.test(para)) {
          where.push(s.where);
          break;
        }
      }
    }
    if (!where.some((w) => w.startsWith("progress.md")) || !where.includes("stages.json")) {
      hits.push({ stage, kind: "three-failed-fixes-without-blocker", finding: f.id, severity: f.severity, failed_fix_verifications: n, status: f.status, blocker_found_in: [...new Set(where)] });
    }
  }
  return {
    stats: { findings: findings.length, findings_with_failed_fix_verifications: counted.length, max_failed: counted.reduce((m, c) => Math.max(m, c.failed_fix_verifications), 0), counted },
    hits,
    notes: [{ kind: "scope", detail: "counts history transitions FIXED_PENDING_VERIFICATION -> OPEN in docs/delivery/findings.json on this branch; findings of superseded branches (clean re-gates) are not in this file" }],
  };
}

// ------------------------------------------------------------------------------------- C8 approval claims

const APPROVAL_KIND = /\b(business|finance|financial|IT|production|go-live|CFO|sponsor|steering committee|company)\b/;
const APPROVAL_WORD = /\b(approvals?|approved|sign-?offs?|signed off|authori[sz]ations?|authori[sz]ed)\b/i;
const GRANT_VERB = /\b(granted|grants?|gave|given|obtained|received|issued|approved|signed off|authori[sz]ed)\b/i;
const PRODUCT_CONTEXT = /\b(demo|synthetic|seed(ed)?|fixtures?|test(s|ed)?|e2e|in[- ]product|product gates?|G[1-6]\b|workflow|endpoint|route|permission|role|UI|screen|scenario|spec|mock|sample|example)\b/i;
const AGENT_ACTOR = /\b(agent|orchestrator|engineer|reviewer|auditor|analyst|architect|verifier|claude|we|I)\b/i;

const EQUATES = String.raw`(implies|imply|implied|means|equals?|equivalent( to)?|same as|satisf\w+|counts? as|stands? for|completes?|passes|=)`;
/** G6 and DG7 joined by an equivalence word within a short window, in either order. */
const G6_DG7 = new RegExp(String.raw`\bG6\b[^.;]{0,40}(?<![A-Za-z])${EQUATES}[^.;]{0,40}\bDG7\b|\bDG7\b[^.;]{0,40}(?<![A-Za-z])${EQUATES}[^.;]{0,40}\bG6\b`, "i");

/** Sentence splitter for prose records (keeps table cells and <br> items apart). */
export function sentencesOf(text) {
  return text
    .split(/(?<=[.!?])\s+|\n+|\\n|<br>|\s\|\s/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
}

export function classifySentence(s) {
  const out = [];
  const engineeringGate = /\bDG[0-7]\b[^.;]{0,20}\bapprov|\bapprov\w*[^.;]{0,20}\bDG[0-7]\b/i.test(s);
  if (APPROVAL_KIND.test(s) && APPROVAL_WORD.test(s) && GRANT_VERB.test(s) && AGENT_ACTOR.test(s) && !NEGATION.test(s) && !PRODUCT_CONTEXT.test(s) && !engineeringGate) out.push("agent-claims-business-approval");
  if (G6_DG7.test(s) && !NEGATION.test(s)) out.push("g6-equated-with-dg7");
  return out;
}

const CLAIM_SCOPE = [
  { dir: "docs/delivery", skip: /^docs\/delivery\/(runs|candidates)\//, ext: /\.(md|json|csv)$/ },
  { dir: "docs/handover", skip: null, ext: /\.md$/ },
  { dir: "docs/architecture", skip: null, ext: /\.md$/ },
  { dir: "docs/operations", skip: null, ext: /\.md$/ },
];

export function checkApprovalClaims(ctx, stages) {
  const hits = [];
  let files = 0;
  let sentences = 0;
  const stageSet = new Set(stages);
  for (const sc of CLAIM_SCOPE) {
    for (const abs of walkFiles(join(ctx.root, sc.dir), (p) => sc.ext.test(p) && statSync(p).size < 8 * 1024 * 1024)) {
      const rel = toPosix(relative(ctx.root, abs));
      if (sc.skip && sc.skip.test(rel)) continue;
      // Stage-scoped files (…/DGx/…) are scanned only with their stage; shared records with every run.
      const sm = /\/(DG[0-7])\//.exec(rel);
      if (sm && !stageSet.has(sm[1])) continue;
      files++;
      const text = readText(abs);
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        for (const s of sentencesOf(lines[i])) {
          sentences++;
          for (const kind of classifySentence(s)) hits.push({ stage: sm ? sm[1] : "shared", kind, file: rel, line: i + 1, text: s.slice(0, 240) });
        }
      }
    }
  }
  return { stats: { files_scanned: files, sentences_scanned: sentences }, hits, notes: [{ kind: "method", detail: "sentence-level patterns; a negation token or a product/demo context word in the sentence suppresses a hit (residual: unusual phrasing)" }] };
}

// ------------------------------------------------------------------------------- C9 stage continuation

export function checkContinuation(ctx, stage) {
  const stages = ctx.stages;
  if (!stages) return { blocked: "docs/delivery/stages.json not found" };
  const s = stages.get(stage);
  if (!s) return { stats: { present: false }, hits: [], notes: [] };
  const hist = (s.history ?? []).map((h) => ({ state: h.state ?? h.to ?? h.status, at: h.at ?? h.timestamp }));
  const hits = [];
  const accepted = (ctx.findings ?? []).filter((f) => f.status === "ACCEPTED_OBSERVATION" && /stages\.json/.test(`${f.title} ${f.actual ?? ""}`) && /order/i.test(`${f.title} ${f.actual ?? ""}`));
  const coveredBy = accepted.filter((f) => new RegExp(`\\b${stage}\\b`).test(`${f.title} ${f.actual ?? ""}`)).map((f) => f.id);
  const observations = [];
  for (let i = 1; i < hist.length; i++) {
    if (Date.parse(hist[i].at) < Date.parse(hist[i - 1].at)) {
      const item = { stage, kind: "history-out-of-order", earlier: hist[i - 1], later: hist[i] };
      if (coveredBy.length) observations.push({ ...item, accepted_observation: coveredBy });
      else hits.push(item);
    }
  }
  const n = Number(stage.slice(2));
  let entered = null;
  if (n > 0) {
    const prev = stages.get(`DG${n - 1}`);
    const prevApproved = (prev?.history ?? []).filter((h) => (h.state ?? h.to ?? h.status) === "APPROVED").map((h) => h.at ?? h.timestamp)[0] ?? null;
    const building = hist.find((h) => h.state === "BUILDING")?.at ?? null;
    entered = { previous_gate_approved_at: prevApproved, building_at: building };
    if (building && (!prevApproved || Date.parse(building) < Date.parse(prevApproved))) hits.push({ stage, kind: "building-before-previous-gate-approved", ...entered });
  }
  return { stats: { state: s.state ?? s.status, transitions: hist.length, entered_building: entered }, hits, notes: observations.length ? [{ kind: "accepted-observation", detail: "reported as the accepted observation it is; approved history is not rewritten (D-241, D-243 Q13)", items: observations }] : [] };
}

// --------------------------------------------------------------------------------------------------- driver

export const CHECKS = Object.freeze([
  { id: "C1", name: "concurrency", requirement: "REQ-DLV-009", clause: "for each gate, overlapping run intervals in docs/delivery/runs/<DGx>/*/meta.json never exceed four (D-004)", fn: checkConcurrency },
  { id: "C2", name: "assignment-contract", requirement: "REQ-DLV-011", clause: "every run's meta.json records an assignment SHA-256 that matches an assignment file containing all ten contract elements", fn: checkAssignments },
  { id: "C3", name: "handback-sections", requirement: "REQ-DLV-012", clause: "every implementation task in a gate has a handback with the five sections", fn: checkHandbacks },
  { id: "C4", name: "file-ownership", requirement: "REQ-DLV-008", clause: "no two concurrently active assignments share a writable file", fn: checkOwnership },
  { id: "C5", name: "historical-first", requirement: "REQ-DLV-024", clause: "for each of P1-P7, test-evidence contains a passing --historical run for the previous gate, dated before the stage's first implementation run", fn: checkHistorical },
  { id: "C6", name: "progress-updates", requirement: "REQ-DLV-028; REQ-DLV-012", clause: "for each approved gate, progress.md has an update with all six elements and the candidate ID matching gates/DGx.json; any task whose handback lists open gaps is not reported as complete in progress.md", fn: checkProgress },
  { id: "C7", name: "three-failed-fixes", requirement: "REQ-DLV-018", clause: "any finding with three failed fix verifications has a blocker entry with a recovery plan in progress.md and stages.json", fn: checkFailedFixes },
  { id: "C8", name: "approval-claims", requirement: "REQ-DLV-027", clause: "no record claims a business, Finance, IT or production approval; no text equates product G6 with DG7 (CLAUDE.md)", fn: checkApprovalClaims, crossStage: true },
  { id: "C9", name: "stage-continuation", requirement: "REQ-DLV-027; REQ-DLV-040", clause: "each next stage enters BUILDING after the prior APPROVED gate; history in order (F-DG6-952 reported as its accepted observation)", fn: checkContinuation },
]);

export function makeContext(root, { git = true } = {}) {
  const g = makeGit(root, git);
  const cache = new Map();
  let pv = null;
  return {
    root,
    git: g,
    runs(stage) {
      if (!cache.has(stage)) cache.set(stage, loadRuns(root, stage));
      return cache.get(stage);
    },
    progressVersions() {
      if (!pv) pv = progressVersions({ root, git: g });
      return pv;
    },
    stages: loadStages(root),
    findings: loadFindings(root),
  };
}

/** Runs the audit; returns the report object. Throws Blocked when it cannot run at all. */
export function audit({ root, stages, git = true, only = null }) {
  if (!existsSync(join(root, "docs", "delivery"))) throw new Blocked(`no docs/delivery under ${root}`);
  const ctx = makeContext(root, { git });
  const checks = [];
  for (const c of CHECKS) {
    if (only && !only.includes(c.id)) continue;
    const per = c.crossStage ? [stages] : stages.map((s) => s);
    for (const st of per) {
      let r;
      try {
        r = c.fn(ctx, st);
      } catch (e) {
        r = { blocked: `${e.constructor.name}: ${e.message}` };
      }
      const status = r.blocked ? "BLOCKED" : r.hits.length ? "HIT" : "PASS";
      checks.push({ id: c.id, name: c.name, requirement: c.requirement, clause: c.clause, stage: Array.isArray(st) ? "all-selected" : st, status, ...(r.blocked ? { reason: r.blocked } : { stats: r.stats, hits: r.hits, notes: r.notes }) });
    }
  }
  const hitCount = checks.reduce((n, c) => n + (c.hits?.length ?? 0), 0);
  const blocked = checks.filter((c) => c.status === "BLOCKED").length;
  const verdict = hitCount ? "FAIL" : blocked ? "BLOCKED" : "PASS";
  return {
    tool: "tools/release/protocol-audit.mjs",
    version: TOOL_VERSION,
    head: ctx.git.head(),
    git_history_used: ctx.git.ok,
    stages,
    verdict,
    exit_code: verdict === "PASS" ? 0 : verdict === "FAIL" ? 1 : 2,
    totals: { checks: checks.length, pass: checks.filter((c) => c.status === "PASS").length, hit: checks.filter((c) => c.status === "HIT").length, blocked, hits: hitCount },
    checks,
  };
}

export function summary(report) {
  const lines = [`protocol-audit ${report.version} stages=${report.stages.join(",")} head=${report.head ?? "n/a"} git-history=${report.git_history_used}`];
  for (const c of report.checks) {
    const extra = c.status === "BLOCKED" ? ` (${c.reason})` : c.hits.length ? ` ${c.hits.length} hit(s): ${[...new Set(c.hits.map((h) => h.kind))].join(", ")}` : "";
    lines.push(`  ${c.id} ${c.name.padEnd(20)} ${String(c.stage).padEnd(12)} ${c.status}${extra}`);
  }
  lines.push(`${report.verdict} (exit ${report.exit_code}): ${report.totals.hits} hit(s) in ${report.totals.hit} check(s), ${report.totals.blocked} blocked, ${report.totals.pass} pass`);
  return lines.join("\n");
}

function parseArgs(argv) {
  const a = { root: null, stages: null, all: false, json: null, git: true, quiet: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--stage") a.stages = [...(a.stages ?? []), argv[++i]];
    else if (k === "--all") a.all = true;
    else if (k === "--root") a.root = argv[++i];
    else if (k === "--json") a.json = argv[++i];
    else if (k === "--no-git") a.git = false;
    else if (k === "--quiet") a.quiet = true;
    else if (k === "--only") a.only = String(argv[++i]).split(",");
    else throw new Blocked(`unknown argument ${k}`);
  }
  if (!a.all && !a.stages?.length) throw new Blocked("give --stage DGx (repeatable) or --all");
  for (const s of a.stages ?? []) if (!/^DG[0-7]$/.test(s ?? "")) throw new Blocked(`bad stage ${s}`);
  return a;
}

export function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
    const root = resolve(args.root ?? join(fileURLToPath(new URL(".", import.meta.url)), "..", ".."));
    const stages = args.all ? stageIds(root) : args.stages;
    if (!stages.length) throw new Blocked("no gate records under docs/delivery/runs");
    const report = audit({ root, stages, git: args.git, only: args.only });
    if (args.json) writeFileSync(args.json, `${JSON.stringify(report, null, 1)}\n`);
    if (!args.quiet) process.stdout.write(`${summary(report)}\n`);
    return report.exit_code;
  } catch (e) {
    if (e instanceof Blocked) {
      process.stderr.write(`BLOCKED (exit 2): ${e.message}\n`);
      return 2;
    }
    process.stderr.write(`BLOCKED (exit 2): ${e.stack ?? e}\n`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
