// Delivery gate rules (master prompt §0.4–§0.5). Pure checks over repository files; every check returns error strings.
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { join, resolve, sep } from "node:path";
import { validate } from "./schema.mjs";
import { parseCsv } from "./csv.mjs";
import { candidateId, manifestFromRef, manifestFromWorkingTree, diffManifests, specPolicyErrors, HASH_ALGORITHM, matchesAny } from "./candidate.mjs";

export const STAGE_ORDER = ["DG0", "DG1", "DG2", "DG3", "DG4", "DG5", "DG6", "DG7"];
export const REQUIRED_REVIEWERS = ["domain-reviewer", "code-security-reviewer", "qa-verifier"];
export const AUDITOR = "release-auditor";
export const REVIEW_ROLES = [...REQUIRED_REVIEWERS, AUDITOR];
export const TRANSITIONS = {
  PLANNED: ["BUILDING", "BLOCKED"],
  BUILDING: ["REVIEWING", "BLOCKED"],
  REVIEWING: ["FIXING", "VERIFYING", "BLOCKED"],
  FIXING: ["REVIEWING", "VERIFYING", "BLOCKED"],
  VERIFYING: ["APPROVED", "FIXING", "BLOCKED"],
  APPROVED: ["FIXING"], // reopening an approved scope keeps its history
  BLOCKED: ["PLANNED", "BUILDING", "REVIEWING", "FIXING", "VERIFYING"],
};
export const REGISTER_COLUMNS = [
  "req_id", "class", "title", "source_ref", "source_heading", "template_id", "input_fields", "procedure",
  "output", "owner_roles", "permissions", "automation", "screen_api", "acceptance", "increments",
  "final_gate", "status", "evidence", "notes",
];
const OPTIONAL_COLUMNS = new Set(["template_id", "evidence", "notes"]);
// VERIFIED is never self-declared in the register: verification is derived from PASS review records
// that list the requirement in requirements_checked (so recording verification cannot alter the candidate).
const STATUS_RANK = { PLANNED: 0, SPECIFIED: 1, IMPLEMENTED: 2, BLOCKED: -1 };
const TERMINAL_FINDING = new Set(["CLOSED_VERIFIED", "ACCEPTED_OBSERVATION", "REJECTED_INVALID"]);
// Fields a reviewer sets when raising a finding; the orchestrator may not alter them in findings.json.
const IMMUTABLE_FINDING_FIELDS = ["stage_id", "requirement", "severity", "mandatory_violation", "title", "reported_by"];

const here = new URL(".", import.meta.url).pathname;
const schemaCache = {};
export function schema(name) {
  if (!schemaCache[name]) schemaCache[name] = JSON.parse(readFileSync(join(here, "..", "schemas", `${name}.schema.json`), "utf8"));
  return schemaCache[name];
}

export function sha256File(abs) {
  return createHash("sha256").update(readFileSync(abs)).digest("hex");
}

/** True when `ref` (optionally with a #fragment) names an existing regular file strictly inside the repository. */
export function repoFile(repo, ref) {
  if (typeof ref !== "string") return false;
  const rel = ref.split("#")[0];
  if (!rel || rel.startsWith("/") || rel.includes("\0")) return false;
  const root = resolve(repo);
  const abs = resolve(root, rel);
  if (!abs.startsWith(root + sep)) return false;
  try {
    // Symlinks must resolve to a regular file that is itself inside the repository (F-DG0-205).
    const realRoot = realpathSync(root);
    const real = realpathSync(abs);
    return real.startsWith(realRoot + sep) && statSync(real).isFile();
  } catch {
    return false;
  }
}

export function readJson(repo, rel, errors, label = rel) {
  if (!repoFile(repo, rel)) {
    errors.push(`${label}: file not found (${rel})`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(join(repo, rel), "utf8"));
  } catch (e) {
    errors.push(`${label}: invalid JSON (${e.message})`);
    return null;
  }
}

function checkSchema(name, data, label, errors) {
  for (const e of validate(schema(name), data)) errors.push(`${label}: ${e}`);
}

export function stageIndex(id) {
  return STAGE_ORDER.indexOf(id);
}

function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], { maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] });
}

// ---------- stages.json ----------
export function loadStages(repo, errors) {
  const doc = readJson(repo, "docs/delivery/stages.json", errors, "stages.json");
  if (!doc) return null;
  const before = errors.length;
  checkSchema("stages", doc, "stages.json", errors);
  if (errors.length > before) return null;
  const ids = doc.stages.map((s) => s.id);
  if (JSON.stringify(ids) !== JSON.stringify(STAGE_ORDER)) errors.push(`stages.json: stages must be exactly ${STAGE_ORDER.join(",")} in order`);
  for (const s of doc.stages) {
    if (s.stage !== "P" + s.id.slice(2)) errors.push(`stages.json: ${s.id} must map to P${s.id.slice(2)}`);
    for (const e of specPolicyErrors(s.candidate_spec)) errors.push(`stages.json: ${s.id} candidate_spec ${e}`);
    const hist = s.history;
    if (hist[0].state !== "PLANNED") errors.push(`stages.json: ${s.id} history must start at PLANNED`);
    for (let i = 1; i < hist.length; i++) {
      const from = hist[i - 1].state;
      const to = hist[i].state;
      if (!TRANSITIONS[from].includes(to)) errors.push(`stages.json: ${s.id} illegal transition ${from} -> ${to}`);
    }
    if (hist[hist.length - 1].state !== s.state) errors.push(`stages.json: ${s.id} state ${s.state} differs from last history entry ${hist[hist.length - 1].state}`);
    for (const dep of s.depends_on) {
      if (stageIndex(dep) >= stageIndex(s.id)) errors.push(`stages.json: ${s.id} depends on later/same stage ${dep}`);
    }
  }
  return doc;
}

// ---------- requirement register ----------
function loadBlockIds(repo, rel, errors) {
  const data = readJson(repo, rel, errors);
  return new Set((data || []).map((b) => b.id));
}

function loadCsv(repo, rel, errors) {
  if (!repoFile(repo, rel)) {
    errors.push(`${rel}: file not found`);
    return null;
  }
  try {
    return parseCsv(readFileSync(join(repo, rel), "utf8"));
  } catch (e) {
    errors.push(`${rel}: ${e.message}`);
    return null;
  }
}

function splitList(v) {
  return (v || "").split(";").map((x) => x.trim()).filter(Boolean);
}

function checkCoverage(rel, csv, blockIds, reqs, errors) {
  if (!csv) return;
  const expectHeader = ["block_id", "disposition", "req_ids", "rationale"];
  if (JSON.stringify(csv.header) !== JSON.stringify(expectHeader)) {
    errors.push(`${rel}: header must be ${expectHeader.join(",")}`);
    return;
  }
  const seen = new Set();
  for (const row of csv.rows) {
    const id = row.block_id.trim();
    if (seen.has(id)) errors.push(`${rel}: duplicate row for ${id}`);
    seen.add(id);
    if (!blockIds.has(id)) errors.push(`${rel}: unknown block ${id}`);
    const disp = row.disposition.trim();
    if (!["REQUIREMENT", "CONTEXT", "NON-REQUIREMENT"].includes(disp)) errors.push(`${rel}: ${id} invalid disposition '${disp}'`);
    if (disp === "REQUIREMENT") {
      const ids = splitList(row.req_ids);
      if (!ids.length) errors.push(`${rel}: ${id} is REQUIREMENT but lists no req_ids`);
      for (const r of ids) {
        const req = reqs.get(r);
        if (!req) errors.push(`${rel}: ${id} references unknown requirement ${r}`);
        else if (!splitList(req.source_ref).includes(id)) errors.push(`${rel}: ${id} maps to ${r}, but ${r} does not cite ${id} in source_ref`);
      }
    } else if (!row.rationale.trim()) {
      errors.push(`${rel}: ${id} is ${disp} without rationale`);
    }
  }
  for (const id of blockIds) if (!seen.has(id)) errors.push(`${rel}: block ${id} has no disposition`);
}

export function checkRegister(repo, stageId, errors, gateRecord = null, reviewRecords = null) {
  const csv = loadCsv(repo, "docs/delivery/requirements.csv", errors);
  if (!csv) return null;
  if (JSON.stringify(csv.header) !== JSON.stringify(REGISTER_COLUMNS)) {
    errors.push(`requirements.csv: header must be exactly ${REGISTER_COLUMNS.join(",")}`);
    return null;
  }
  const bIds = loadBlockIds(repo, "docs/source/playbook.blocks.json", errors);
  const mIds = loadBlockIds(repo, "docs/source/master-prompt.blocks.json", errors);
  const reqs = new Map();
  const acceptanceSeen = new Set();
  const gateIdx = stageIndex(stageId);
  for (const row of csv.rows) {
    const id = row.req_id.trim();
    const where = `requirements.csv ${id || "(blank id)"}`;
    if (!/^REQ-(PB|DLV|S0[1-9]|S1[0-9]|S2[01])-[0-9]{3}$/.test(id)) errors.push(`${where}: invalid req_id`);
    if (reqs.has(id)) errors.push(`${where}: duplicate req_id`);
    reqs.set(id, row);
    for (const col of REGISTER_COLUMNS) {
      if (!OPTIONAL_COLUMNS.has(col) && !String(row[col] || "").trim()) errors.push(`${where}: empty ${col}`);
    }
    if (!["SOURCE", "USER", "ENGINEERING"].includes(row.class)) errors.push(`${where}: invalid class '${row.class}'`);
    const refs = splitList(row.source_ref);
    for (const r of refs) {
      if (/^B\d{4}$/.test(r)) {
        if (!bIds.has(r)) errors.push(`${where}: cites unknown playbook block ${r}`);
      } else if (/^M\d{4}$/.test(r)) {
        if (!mIds.has(r)) errors.push(`${where}: cites unknown master-prompt block ${r}`);
      } else errors.push(`${where}: source_ref entry '${r}' is not a block anchor`);
    }
    if (row.class === "SOURCE" && !refs.some((r) => r.startsWith("B"))) errors.push(`${where}: SOURCE requirement cites no playbook block`);
    if (row.class !== "SOURCE" && id.startsWith("REQ-PB-")) errors.push(`${where}: REQ-PB ids are reserved for SOURCE requirements`);
    const acc = (row.acceptance.match(/\bA(0[1-9]|1[0-9]|2[0-8])\b/g) || []);
    if (!acc.length) errors.push(`${where}: acceptance names no scenario A01-A28`);
    acc.forEach((a) => acceptanceSeen.add(a));
    const incs = splitList(row.increments);
    if (!incs.length || incs.some((p) => !/^P[0-7]$/.test(p))) errors.push(`${where}: invalid increments '${row.increments}'`);
    if (!STAGE_ORDER.includes(row.final_gate)) errors.push(`${where}: invalid final_gate '${row.final_gate}'`);
    else if (incs.length && Math.max(...incs.map((p) => Number(p.slice(1)))) > stageIndex(row.final_gate)) {
      errors.push(`${where}: final_gate ${row.final_gate} precedes its last increment`);
    }
    if (!(row.status in STATUS_RANK)) errors.push(`${where}: invalid status '${row.status}'`);
    const fg = stageIndex(row.final_gate);
    if (row.status === "BLOCKED" && !row.notes.trim()) errors.push(`${where}: BLOCKED without the missing dependency in notes`);
    if (STATUS_RANK[row.status] < 1) errors.push(`${where}: must be at least SPECIFIED (is ${row.status})`);
    if (fg >= 0 && fg <= gateIdx && row.status !== "IMPLEMENTED") {
      errors.push(`${where}: final gate ${row.final_gate} requires IMPLEMENTED at ${stageId} (is ${row.status})`);
    }
    if (fg >= 0 && fg <= gateIdx && !row.evidence.trim()) errors.push(`${where}: IMPLEMENTED for ${row.final_gate} without evidence`);
    for (const ev of splitList(row.evidence)) {
      if (!repoFile(repo, ev)) errors.push(`${where}: evidence is not an existing repository file: ${ev}`);
    }
  }
  for (let n = 1; n <= 28; n++) {
    const a = `A${String(n).padStart(2, "0")}`;
    if (!acceptanceSeen.has(a)) errors.push(`requirements.csv: acceptance scenario ${a} is not referenced by any requirement`);
  }
  checkCoverage("docs/analysis/source-coverage.csv", loadCsv(repo, "docs/analysis/source-coverage.csv", errors), bIds, reqs, errors);
  checkCoverage("docs/analysis/master-prompt-coverage.csv", loadCsv(repo, "docs/analysis/master-prompt-coverage.csv", errors), mIds, reqs, errors);
  if (reviewRecords) {
    // Derived verification: each requirement completing at this gate must be checked by QA and by at least
    // one of the domain or code-security reviewers, in PASS records for the gate candidate.
    const checkedBy = (role) => new Set((reviewRecords.find((r) => r.reviewer_role === role) || { requirements_checked: [] }).requirements_checked);
    const qa = checkedBy("qa-verifier");
    const dom = checkedBy("domain-reviewer");
    const sec = checkedBy("code-security-reviewer");
    for (const r of reqs.values()) {
      if (r.final_gate !== stageId) continue;
      if (!qa.has(r.req_id)) errors.push(`requirements.csv ${r.req_id}: completes at ${stageId} but qa-verifier did not check it`);
      if (!dom.has(r.req_id) && !sec.has(r.req_id)) errors.push(`requirements.csv ${r.req_id}: completes at ${stageId} but neither domain nor code-security reviewer checked it`);
    }
  }
  if (gateRecord) {
    const expected = [...reqs.values()].filter((r) => r.final_gate === stageId).map((r) => r.req_id).sort();
    const recorded = [...gateRecord.requirements.final_gate_ids].sort();
    if (JSON.stringify(expected) !== JSON.stringify(recorded)) {
      errors.push(`gate ${stageId}: requirements.final_gate_ids does not match the register (expected ${expected.length}, recorded ${recorded.length})`);
    }
  }
  return reqs;
}

// ---------- invocation provenance ----------
/** Files that make up a run's evidence (for history-immutability checks). */
export function runFiles(stageId, runId) {
  const base = `docs/delivery/runs/${stageId}/${runId}`;
  return [`${base}/meta.json`, `${base}/result.json`, `${base}/transcript.jsonl.gz`];
}

/**
 * A review/audit/verification must point at a real, completed run of the same role for this stage:
 * meta, result and transcript present with matching hashes; the transcript's init, prompt and result lines carry
 * the same session and role; and (when binding is given) the run executed the record's assignment after the freeze.
 */
export function checkInvocation(repo, stageId, ref, role, errors, label, binding = null) {
  if (!ref) return void errors.push(`${label}: missing invocation_reference`);
  const [metaRel, resultRel, transcriptRel] = runFiles(stageId, ref.run_id);
  const meta = readJson(repo, metaRel, errors, `${label} invocation`);
  if (!meta) return;
  const bad = (m) => errors.push(`${label}: invocation ${ref.run_id}: ${m}`);
  if (meta.run_id !== ref.run_id) bad(`meta.run_id is ${meta.run_id}`);
  if (meta.role !== role) bad(`was run as '${meta.role}', not '${role}'`);
  if (meta.stage !== stageId) bad(`belongs to stage ${meta.stage}, not ${stageId}`);
  if (!meta.invocation_reference || meta.invocation_reference.session_id !== ref.session_id) bad("session_id does not match the recorded run");
  if (meta.result_session_id !== ref.session_id) bad("result_session_id does not match the requested session");
  if (meta.exit_code !== 0 || meta.is_error) bad("did not complete successfully");
  for (const [rel, key] of [[resultRel, "result_sha256"], [transcriptRel, "transcript_sha256"]]) {
    if (!repoFile(repo, rel)) bad(`missing ${rel.split("/").pop()}`);
    else if (!meta[key] || sha256File(join(repo, rel)) !== meta[key]) bad(`${rel.split("/").pop()} does not match meta.${key}`);
  }
  let lines = [];
  if (repoFile(repo, transcriptRel)) {
    try {
      lines = gunzipSync(readFileSync(join(repo, transcriptRel))).toString("utf8").split("\n").filter(Boolean).map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return {};
        }
      });
    } catch (e) {
      bad(`transcript is not valid gzip (${e.message})`);
    }
  }
  // Every transcript check is unconditional: an empty or unparsable transcript fails them all (F-DG0-132).
  if (!lines.length) bad("transcript is empty");
  const init = lines.find((o) => o.type === "system" && o.subtype === "init");
  if (!init || init.session_id !== ref.session_id) bad("transcript has no init line for this session");
  else if (meta.model_requested && init.model !== meta.model_requested) bad(`transcript model ${init.model} != requested ${meta.model_requested}`);
  // The CLI replays the prompt it received (isReplay: true, D-022). Only a replayed user message whose content is
  // text counts; the same words inside a tool result (e.g. someone reading run-agent.sh) do not.
  const promptText = (o) => {
    const c = o && o.message && o.message.content;
    if (typeof c === "string") return c;
    return Array.isArray(c) && c.every((x) => x && x.type === "text") ? c.map((x) => x.text).join("") : null;
  };
  const prompt = lines.find((o) => o.type === "user" && o.isReplay === true && typeof promptText(o) === "string" &&
    promptText(o).startsWith(`You are invoked as project agent '${role}' for stage ${stageId}`));
  if (!prompt || !promptText(prompt).includes(`"run_id":"${ref.run_id}"`) || !promptText(prompt).includes(`"session_id":"${ref.session_id}"`)) {
    bad(`transcript does not contain the CLI-replayed runner prompt for '${role}' and run ${ref.run_id}`);
  } else {
    // The assignment the prompt named is the transcript-bound statement of what the run executed (F-DG0-133).
    const m = promptText(prompt).match(/Your complete assignment is in the file (.+?) \(sha256 ([0-9a-f]{64})\)/); // paths may contain spaces (F-DG0-223)
    if (!m) bad("the replayed prompt names no assignment file and sha256");
    else if (!m[1].endsWith(`/${meta.assignment}`) || m[2] !== meta.assignment_sha256) bad(`the replayed prompt names assignment ${m[1]} (sha256 ${m[2].slice(0, 12)}…), not meta's ${meta.assignment}`);
  }
  const results = lines.filter((o) => o.type === "result");
  const last = results[results.length - 1];
  if (!last || last.session_id !== ref.session_id || last.is_error) bad("transcript does not end in a successful result for this session");
  if (binding) {
    if (typeof binding.assignment !== "string" || !binding.assignment) bad("the record names no assignment to bind the run to");
    else if (meta.assignment !== binding.assignment) bad(`ran assignment ${meta.assignment}, record cites ${binding.assignment}`);
    else if (!repoFile(repo, binding.assignment) || sha256File(join(repo, binding.assignment)) !== meta.assignment_sha256) bad("assignment file changed since the run (sha256 mismatch)");
    if (binding.notBefore && !(meta.started_at >= binding.notBefore)) bad(`started ${meta.started_at}, before the candidate froze at ${binding.notBefore}`);
    if (binding.manifestPath) {
      // The run must have started from a commit that already contained the frozen manifest it reviewed (F-DG0-212).
      try {
        execFileSync("git", ["-C", repo, "cat-file", "-e", `${meta.head_commit_at_start}:${binding.manifestPath}`], { stdio: "ignore" });
      } catch {
        bad(`started from ${String(meta.head_commit_at_start).slice(0, 10)}, which does not contain ${binding.manifestPath}`);
      }
    }
    for (const rel of binding.outputs || []) {
      // The file must be exactly what this run wrote with its own file tools (D-021).
      if (!meta.outputs || typeof meta.outputs !== "object") {
        bad(`records no outputs, so ${rel} cannot be bound to it`);
        continue;
      }
      if (!repoFile(repo, rel)) bad(`output ${rel} is missing`);
      else if (meta.outputs[rel] !== sha256File(join(repo, rel))) bad(`${rel} differs from what the run wrote (edited after the run?)`);
      // tool_authored: paths whose final bytes equal the replay of this run's successful Write/Edit calls (F-DG0-119).
      const authored = meta.tool_authored && typeof meta.tool_authored === "object" ? meta.tool_authored : {};
      if (authored[rel] === undefined) bad(`${rel} was not written by this run's file tools`);
      else if (authored[rel] !== meta.outputs[rel]) bad(`${rel} does not equal the content of this run's own Write/Edit calls`);
      // Independently replay the hash-bound transcript rather than trusting meta.tool_authored (F-DG0-115).
      if (repoFile(repo, rel)) {
        const replayed = replayToolContent(lines, meta.cwd, rel);
        if (replayed === null) bad(`${rel} cannot be reconstructed from this run's own successful Write/Edit calls in its transcript`);
        else if (!Buffer.from(replayed, "utf8").equals(readFileSync(join(repo, rel)))) bad(`${rel} differs from the replay of this run's transcript`);
      }
    }
  }
}

// ---------- review records ----------
export function checkReview(repo, rel, { stage, role, candidate, extraOutputs = [] }, errors) {
  const label = `review ${role} (${rel})`;
  const rec = readJson(repo, rel, errors, label);
  if (!rec) return null;
  const before = errors.length;
  checkSchema("review", rec, label, errors);
  if (errors.length > before) return null;
  if (rec.stage_id !== stage.id) errors.push(`${label}: stage_id ${rec.stage_id} != ${stage.id}`);
  if (rec.reviewer_role !== role) errors.push(`${label}: reviewer_role ${rec.reviewer_role} != ${role}`);
  if (rec.candidate_id !== candidate) errors.push(`${label}: reviewed candidate ${rec.candidate_id} != gate candidate ${candidate}`);
  if (rec.verdict !== "PASS") errors.push(`${label}: verdict is ${rec.verdict}`);
  if (rec.independence_declaration.reviewer_authored_reviewed_scope) errors.push(`${label}: reviewer declares authorship of the reviewed scope`);
  if (rec.implementation_author.includes(role)) errors.push(`${label}: reviewer is listed as an implementation author`);
  if (stage.implementation_owners.includes(role)) errors.push(`${label}: reviewer is an implementation owner of ${stage.id}`);
  for (const c of rec.checks_run) {
    if (c.result !== "PASS") errors.push(`${label}: check ${c.id} is ${c.result}`);
  }
  for (const ev of rec.evidence_paths) {
    if (!repoFile(repo, ev)) errors.push(`${label}: evidence path is not an existing repository file: ${ev}`);
  }
  if (!repoFile(repo, rec.assignment)) errors.push(`${label}: assignment file not found: ${rec.assignment}`);
  const sidecar = rel.replace(/\.json$/, ".findings.json");
  checkInvocation(repo, stage.id, rec.invocation_reference, role, errors, label, {
    assignment: rec.assignment,
    notBefore: stage.candidate.frozen_at,
    manifestPath: manifestPathFor(stage.id, candidate),
    outputs: [rel, ...(repoFile(repo, sidecar) ? [sidecar] : []), ...(extraOutputs || [])],
  });
  return rec;
}

// ---------- findings ----------
/** Every finding raised in any review round of the stage, from the reviewer-authored sidecars and records. */
export function collectRaisedFindings(repo, stageId, errors) {
  const raised = new Map(); // id -> { finding, round, file }
  const referenced = new Map(); // id -> record path
  const dir = join(repo, "docs/delivery/reviews", stageId);
  if (!existsSync(dir)) return { raised, referenced };
  const rounds = readdirSync(dir).filter((d) => /^round-\d+$/.test(d)).sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
  for (const round of rounds) {
    for (const file of readdirSync(join(dir, round)).sort()) {
      const rel = `docs/delivery/reviews/${stageId}/${round}/${file}`;
      const sidecar = file.match(/^(.+)\.findings\.json$/);
      if (sidecar) {
        const data = readJson(repo, rel, errors, "findings sidecar");
        for (const f of (data && data.findings) || []) {
          if (f.stage_id !== stageId) errors.push(`${rel}: finding ${f.id} is labelled ${f.stage_id} but was raised in ${stageId}`);
          if (!String(f.id).startsWith(`F-${stageId}-`)) errors.push(`${rel}: finding id ${f.id} does not belong to ${stageId}`);
          if (f.reported_by !== sidecar[1]) errors.push(`${rel}: finding ${f.id} reported_by ${f.reported_by} but the sidecar belongs to ${sidecar[1]}`);
          raised.set(f.id, { finding: f, round, file: rel }); // later rounds supersede earlier versions
        }
      } else if (/^[a-z-]+\.json$/.test(file) && REVIEW_ROLES.includes(file.slice(0, -5))) {
        const rec = readJson(repo, rel, errors, "review record");
        for (const id of (rec && rec.findings) || []) referenced.set(id, rel);
      }
    }
  }
  return { raised, referenced };
}

export function checkFindings(repo, stage, reviewRecords, gate, errors) {
  const stageId = stage.id;
  const doc = readJson(repo, "docs/delivery/findings.json", errors, "findings.json");
  if (!doc) return;
  const before = errors.length;
  checkSchema("findings", doc, "findings.json", errors);
  if (errors.length > before) return;
  const byId = new Map();
  for (const f of doc.findings) {
    if (byId.has(f.id)) errors.push(`findings.json: duplicate id ${f.id}`);
    byId.set(f.id, f);
  }
  const { raised, referenced } = collectRaisedFindings(repo, stageId, errors);
  const verifications = collectVerifications(repo, stage, errors);
  for (const [id, where] of referenced) {
    if (!byId.has(id)) errors.push(`${where}: lists finding ${id}, which is not in findings.json`);
    else if (!raised.has(id)) errors.push(`${where}: lists finding ${id}, which no reviewer sidecar raised`);
  }
  for (const rec of reviewRecords) {
    for (const fid of rec.findings) if (!byId.has(fid)) errors.push(`review ${rec.reviewer_role}: finding ${fid} not in findings.json`);
  }
  for (const [id, { finding, file }] of raised) {
    const f = byId.get(id);
    if (!f) {
      errors.push(`finding ${id} raised in ${file} is missing from findings.json (dropped)`);
      continue;
    }
    for (const k of IMMUTABLE_FINDING_FIELDS) {
      if (JSON.stringify(f[k]) !== JSON.stringify(finding[k])) errors.push(`finding ${id}: ${k} in findings.json (${JSON.stringify(f[k])}) differs from the reviewer's (${JSON.stringify(finding[k])})`);
    }
  }
  for (const f of doc.findings) {
    if (f.id.startsWith(`F-${stageId}-`) && f.stage_id !== stageId) errors.push(`finding ${f.id}: relabelled to ${f.stage_id}; findings stay with the stage that raised them`);
    if (f.stage_id === stageId && !raised.has(f.id)) errors.push(`finding ${f.id}: no reviewer sidecar raised it`);
  }
  for (const f of doc.findings.filter((x) => x.stage_id === stageId || x.id.startsWith(`F-${stageId}-`))) {
    const where = `finding ${f.id} (${f.severity}${f.mandatory_violation ? ", mandatory" : ""})`;
    if (!TERMINAL_FINDING.has(f.status)) {
      errors.push(`${where}: unresolved (${f.status})`);
      continue;
    }
    if (f.status === "CLOSED_VERIFIED" || f.status === "REJECTED_INVALID") {
      checkClosure(repo, stage, gate, f, verifications.get(f.id), where, errors);
    }
    if (f.status === "ACCEPTED_OBSERVATION") {
      if (f.severity !== "Low" || f.mandatory_violation) errors.push(`${where}: only Low, non-mandatory findings may be accepted as observations`);
      // Acceptance is read from reviewer-authored sidecars (status_after ACCEPTED_OBSERVATION), latest entry per role.
      const latestByRole = new Map();
      for (const e of (verifications.all && verifications.all.get(f.id)) || []) {
        const prev = latestByRole.get(e.role);
        if (!prev || e.round > prev.round) latestByRole.set(e.role, e);
      }
      const accepting = [...latestByRole.values()].filter((e) => e.result === "PASS" && e.status_after === "ACCEPTED_OBSERVATION");
      for (const e of accepting) {
        const round = roundEntry(stage, e.roundDir);
        checkInvocation(repo, stage.id, e.record.invocation_reference, e.role, errors, `${where} acceptance by ${e.role}`, {
          assignment: e.record.assignment, notBefore: round && round.frozen_at, outputs: [e.recordPath, e.sidecar],
          manifestPath: round && manifestPathFor(stage.id, round.candidate_id),
        });
      }
      const roles = accepting.map((e) => e.role).sort();
      if (!roles.includes(AUDITOR)) errors.push(`${where}: no release-auditor sidecar accepts it`);
      if (!roles.some((r) => REQUIRED_REVIEWERS.includes(r))) errors.push(`${where}: no specialist reviewer sidecar accepts it`);
      if (!f.acceptance || JSON.stringify([...f.acceptance.accepted_by].sort()) !== JSON.stringify(roles)) errors.push(`${where}: findings.json accepted_by does not mirror the accepting sidecars (${roles.join(", ") || "none"})`);
      if (gate && !gate.accepted_observations.includes(f.id)) errors.push(`${where}: not listed in the gate's accepted_observations`);
    }
  }
  if (gate) {
    for (const id of gate.accepted_observations) {
      const f = byId.get(id);
      if (!f || f.status !== "ACCEPTED_OBSERVATION") errors.push(`gate: accepted observation ${id} is not an ACCEPTED_OBSERVATION finding`);
    }
  }
}

/** The review round entry (stages.json) for a round directory name such as "round-2". */
function roundEntry(stage, roundDir) {
  return stage.review_rounds.find((r) => `round-${r.round}` === roundDir);
}

function isAncestor(repo, maybeAncestor, commit) {
  try {
    execFileSync("git", ["-C", repo, "merge-base", "--is-ancestor", maybeAncestor, commit], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Reviewer-authored verification sidecars (<role>.verifications.json) are the source of truth for closing findings.
 * Returns finding id -> the latest verification (highest round; a FAIL in the same round wins), with the
 * provenance of the reviewer's own record for that round.
 */
export function collectVerifications(repo, stage, errors) {
  const out = new Map();
  const dir = join(repo, "docs/delivery/reviews", stage.id);
  if (!existsSync(dir)) return out;
  const rounds = readdirSync(dir).filter((d) => /^round-\d+$/.test(d)).sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)));
  for (const round of rounds) {
    for (const file of readdirSync(join(dir, round)).sort()) {
      const m = file.match(/^(.+)\.verifications\.json$/);
      if (!m) continue;
      const role = m[1];
      const rel = `docs/delivery/reviews/${stage.id}/${round}/${file}`;
      const entryForRound = roundEntry(stage, round);
      const recRel = entryForRound && entryForRound.records[role];
      if (!recRel || recRel !== `docs/delivery/reviews/${stage.id}/${round}/${role}.json`) {
        errors.push(`${rel}: ${role}'s record for ${round} is not listed in stages.json review_rounds`);
        continue;
      }
      const data = readJson(repo, rel, errors, "verifications sidecar");
      const rec = readJson(repo, recRel, errors, `verifications sidecar ${rel} record`);
      if (!data || !rec) continue;
      const schemaErrors = validate(schema("review"), rec);
      if (schemaErrors.length) {
        errors.push(`${rel}: its record ${recRel} is not a valid review record (${schemaErrors[0]})`);
        continue;
      }
      if (!REVIEW_ROLES.includes(role) || rec.reviewer_role !== role || rec.round !== Number(round.slice(6))) {
        errors.push(`${rel}: sidecar role/round does not match its record`);
        continue;
      }
      for (const v of data.verifications || []) {
        const entry = { ...v, role, round: Number(round.slice(6)), roundDir: round, record: rec, recordPath: recRel, sidecar: rel };
        const prev = out.get(v.finding_id);
        if (!prev || entry.round > prev.round || (entry.round === prev.round && v.result === "FAIL")) out.set(v.finding_id, entry);
        const all = out.all || (out.all = new Map());
        if (!all.has(v.finding_id)) all.set(v.finding_id, []);
        all.get(v.finding_id).push(entry);
      }
    }
  }
  return out;
}

/** A closed finding must be closed by the latest reviewer verification, bound to a post-freeze run that saw the fix. */
function checkClosure(repo, stage, gate, f, v, where, errors) {
  if (!v) return void errors.push(`${where}: ${f.status} but no reviewer verifications sidecar verifies it`);
  if (v.result !== "PASS") errors.push(`${where}: latest reviewer verification (${v.sidecar}) is ${v.result}`);
  if (v.status_after !== f.status) errors.push(`${where}: findings.json status ${f.status} differs from the reviewer's status_after ${v.status_after}`);
  if (v.role === f.owner) errors.push(`${where}: verified by its own owner (${f.owner})`);
  const recorded = f.verification;
  if (!recorded) errors.push(`${where}: findings.json has no verification record`);
  else {
    if (recorded.by_role !== v.role) errors.push(`${where}: findings.json verification by ${recorded.by_role}, sidecar by ${v.role}`);
    if (recorded.result !== v.result) errors.push(`${where}: findings.json verification result differs from the reviewer's sidecar`);
    if (JSON.stringify(recorded.invocation_reference) !== JSON.stringify(v.record.invocation_reference)) {
      errors.push(`${where}: verification invocation is not the verifying reviewer's own run for ${v.roundDir}`);
    }
    if (JSON.stringify(recorded.evidence || []) !== JSON.stringify(v.evidence || [])) errors.push(`${where}: findings.json verification evidence differs from the sidecar`);
  }
  for (const ev of v.evidence || []) if (!repoFile(repo, ev)) errors.push(`${where}: verification evidence is not an existing repository file: ${ev}`);
  const round = roundEntry(stage, v.roundDir);
  if (!round) return void errors.push(`${where}: verification round ${v.roundDir} is not recorded in stages.json review_rounds`);
  if (v.record.candidate_id !== round.candidate_id) errors.push(`${where}: verifying record reviewed ${v.record.candidate_id}, not the ${v.roundDir} candidate`);
  checkInvocation(repo, stage.id, v.record.invocation_reference, v.role, errors, `${where} verification`, {
    assignment: v.record.assignment,
    notBefore: round.frozen_at,
    manifestPath: manifestPathFor(stage.id, round.candidate_id),
    outputs: [v.recordPath, v.sidecar],
  });
  if (f.status === "CLOSED_VERIFIED") {
    if (!f.fix_revision || !/^[0-9a-f]{40}$/.test(f.fix_revision)) errors.push(`${where}: CLOSED_VERIFIED needs a full fix_revision commit id`);
    else {
      if (!isAncestor(repo, f.fix_revision, round.source_commit)) errors.push(`${where}: fix ${f.fix_revision.slice(0, 10)} is not in the verified ${v.roundDir} candidate (${round.source_commit.slice(0, 10)})`);
      if (gate && !isAncestor(repo, f.fix_revision, gate.source_commit)) errors.push(`${where}: fix ${f.fix_revision.slice(0, 10)} is not in the gate candidate`);
    }
  }
}

/**
 * Every review round recorded in stages.json must still exist with its records and sidecars, every round directory
 * must be recorded, and nothing under the stage's reviews/ or runs/ may ever have been deleted from git history.
 */
export function checkReviewRounds(repo, stage, errors) {
  const dir = join(repo, "docs/delivery/reviews", stage.id);
  const onDisk = existsSync(dir) ? readdirSync(dir).filter((d) => /^round-\d+$/.test(d)) : [];
  const recorded = new Set(stage.review_rounds.map((r) => `round-${r.round}`));
  for (const d of onDisk) if (!recorded.has(d)) errors.push(`review rounds: ${stage.id}/${d} exists but is not recorded in stages.json`);
  for (const r of stage.review_rounds) {
    const manifest = findManifest(repo, stage.id, r.candidate_id, errors, `review rounds: ${stage.id} round ${r.round}`);
    if (manifest && (manifest.frozen_at !== r.frozen_at || manifest.source_commit !== r.source_commit)) {
      errors.push(`review rounds: ${stage.id} round ${r.round} frozen_at/source_commit differ from its committed manifest`);
    }
    for (const [role, rel] of Object.entries(r.records)) {
      const label = `review rounds: ${stage.id} round ${r.round} ${role}`;
      if (rel !== `docs/delivery/reviews/${stage.id}/round-${r.round}/${role}.json`) errors.push(`${label}: record path must be docs/delivery/reviews/${stage.id}/round-${r.round}/${role}.json`);
      const rec = readJson(repo, rel, errors, label);
      if (!rec) continue;
      for (const e of validate(schema("review"), rec)) errors.push(`${label}: ${e}`);
      if (rec.reviewer_role !== role || rec.round !== r.round || rec.stage_id !== stage.id) errors.push(`${label}: record does not match its round entry`);
      if (rec.candidate_id !== r.candidate_id) errors.push(`${label}: record reviewed ${rec.candidate_id}, round candidate is ${r.candidate_id}`);
      if (rec.findings && rec.findings.length && !repoFile(repo, rel.replace(/\.json$/, ".findings.json"))) {
        errors.push(`${label}: record lists findings but its .findings.json sidecar is missing`);
      }
    }
  }
  checkWriteOnce(repo, stage.id, errors);
}

/** Paths whose committed files are write-once: reviewer output, run evidence, frozen manifests, round assignments. */
export function writeOncePaths(stageId) {
  return [`docs/delivery/reviews/${stageId}`, `docs/delivery/runs/${stageId}`, `docs/delivery/candidates/${stageId}`, `docs/delivery/assignments/${stageId}/round-*`];
}

/**
 * Once committed, files under the write-once paths may never change (F-DG0-115, F-DG0-118). Design:
 * - every add/modify/type-change event of a write-once path, against EVERY parent (merges included, `-m --raw`),
 *   must carry one and the same blob, and no modify, type-change or delete event may exist at all, so neither
 *   diff ordering nor committer dates can pick a "first" version (F-DG0-115 residual);
 * - HEAD and the on-disk bytes (hashed directly, so skip-worktree cannot hide edits) must equal that blob;
 * - no commit in HEAD's history may carry a committer date earlier than one of its parents (back-dating).
 */
export function checkWriteOnce(repo, stageId, errors) {
  const specs = writeOncePaths(stageId).map((p) => `:(glob)${p}/**`);
  try {
    const raw = git(repo, ["log", "-m", "--full-history", "--no-renames", "--raw", "--no-abbrev", "--format=@%H", "--", ...specs]).toString();
    const blobs = new Map(); // path -> Set of blobs introduced
    let commit = null;
    for (const line of raw.split("\n")) {
      if (line.startsWith("@")) {
        commit = line.slice(1);
        continue;
      }
      const m = line.match(/^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*\t(.+)$/);
      if (!m) continue;
      const [, , , , newBlob, status, path] = m;
      if (status !== "A") errors.push(`write-once: ${path} has a ${status} event in ${commit.slice(0, 10)} (review evidence is append-only)`);
      if (status === "D") continue;
      if (!blobs.has(path)) blobs.set(path, new Set());
      blobs.get(path).add(newBlob);
    }
    const head = new Map();
    const globs = writeOncePaths(stageId).map((p) => `${p}/**`);
    for (const line of git(repo, ["ls-tree", "-r", "--full-tree", "HEAD"]).toString().split("\n").filter(Boolean)) {
      const [meta, path] = line.split("\t");
      if (matchesAny(path, globs)) head.set(path, meta.split(" ")[2]);
    }
    const paths = [...blobs.keys()];
    const onDisk = paths.filter((p) => repoFile(repo, p));
    const diskBlobs = onDisk.length
      ? execFileSync("git", ["-C", repo, "hash-object", "--no-filters", "--stdin-paths"], { input: onDisk.join("\n") + "\n" }).toString().split("\n")
      : [];
    const diskBlob = new Map(onDisk.map((p, i) => [p, diskBlobs[i]]));
    for (const path of paths) {
      const set = blobs.get(path);
      if (set.size !== 1) {
        errors.push(`write-once: ${path} was committed with ${set.size} different contents (review evidence is append-only)`);
        continue;
      }
      const [only] = set;
      if (!head.has(path)) errors.push(`write-once: ${path} was removed after it was committed (review evidence is append-only)`);
      else if (head.get(path) !== only) errors.push(`write-once: ${path} in HEAD differs from its committed content (review evidence is append-only)`);
      if (!diskBlob.has(path)) errors.push(`write-once: ${path} is missing from the working tree`);
      else if (diskBlob.get(path) !== only) errors.push(`write-once: working-tree ${path} differs from its committed content (edited locally, or hidden by skip-worktree/assume-unchanged)`);
    }
    const history = git(repo, ["log", "--format=%H %ct %P"]).toString().split("\n").filter(Boolean);
    const time = new Map(history.map((l) => [l.split(" ")[0], Number(l.split(" ")[1])]));
    for (const l of history) {
      const [c, t, ...parents] = l.split(" ");
      for (const p of parents) if (time.has(p) && Number(t) < time.get(p)) errors.push(`history: commit ${c.slice(0, 10)} is back-dated before its parent ${p.slice(0, 10)}`);
    }
  } catch (e) {
    errors.push(`write-once: cannot inspect git history (${e.message.split("\n")[0]})`);
  }
}

/**
 * Defence in depth (F-DG0-115): recompute what a run's own SUCCESSFUL Write/Edit/MultiEdit calls produced for a path
 * by replaying the hash-bound transcript, instead of trusting meta.tool_authored. Returns the text or null.
 */
export function replayToolContent(lines, runCwd, rel) {
  const failed = new Set();
  const uses = [];
  for (const o of lines) {
    const content = o && typeof o.message === "object" && o.message && Array.isArray(o.message.content) ? o.message.content : [];
    for (const c of content) {
      if (!c || typeof c !== "object") continue;
      if (o.type === "assistant" && c.type === "tool_use" && ["Write", "Edit", "MultiEdit", "NotebookEdit"].includes(c.name)) uses.push(c);
      if (o.type === "user" && c.type === "tool_result" && c.is_error) failed.add(c.tool_use_id);
    }
  }
  const toRel = (fp) => {
    if (typeof fp !== "string" || !fp) return null;
    if (!fp.startsWith("/")) return fp.replace(/^\.\//, "");
    return fp.startsWith(runCwd + "/") ? fp.slice(runCwd.length + 1) : null;
  };
  let state;
  for (const c of uses) {
    const inp = c.input && typeof c.input === "object" ? c.input : {};
    if (toRel(inp.file_path || inp.notebook_path) !== rel || failed.has(c.id)) continue;
    if (c.name === "Write") state = typeof inp.content === "string" ? inp.content : null;
    else if ((c.name === "Edit" || c.name === "MultiEdit") && typeof state === "string") {
      const edits = c.name === "Edit" ? [inp] : Array.isArray(inp.edits) ? inp.edits : [];
      for (const e of edits) {
        const oldS = e && e.old_string;
        const newS = e && e.new_string;
        if (typeof oldS !== "string" || typeof newS !== "string" || oldS === "" || !state.includes(oldS)) {
          state = null;
          break;
        }
        state = e.replace_all ? state.split(oldS).join(newS) : state.replace(oldS, () => newS);
      }
    } else state = null;
  }
  return typeof state === "string" ? state : null;
}

/** The committed, write-once manifest of a frozen candidate. */
export function manifestPathFor(stageId, cid) {
  return `docs/delivery/candidates/${stageId}/${String(cid).slice(7, 23)}.manifest.json`;
}

export function findManifest(repo, stageId, cid, errors, label) {
  const rel = manifestPathFor(stageId, cid);
  const m = readJson(repo, rel, errors, `${label} manifest`);
  if (!m) return null;
  let id = null;
  try {
    id = candidateId(m.entries || [], m.hash_algorithm || "mth-candidate-v1");
  } catch (e) {
    errors.push(`${label} manifest: ${e.message}`);
  }
  if (m.candidate_id !== cid || id !== cid || m.stage_id !== stageId) errors.push(`${label} manifest ${rel} does not hash to ${cid}`);
  try {
    const fromCommit = candidateId(manifestFromRef(repo, m.source_commit, m.spec), m.hash_algorithm || "mth-candidate-v1");
    if (fromCommit !== cid) errors.push(`${label} manifest ${rel} does not describe its source_commit ${String(m.source_commit).slice(0, 10)} (recomputes to ${fromCommit})`);
  } catch (e) {
    errors.push(`${label} manifest ${rel}: cannot recompute from its source_commit (${e.message.split("\n")[0]})`);
  }
  return m;
}

// ---------- candidate ----------
export function checkCandidate(repo, stage, gate, mode, errors) {
  if (gate.manifest_path !== manifestPathFor(stage.id, gate.candidate_id)) errors.push(`candidate manifest: path must be ${manifestPathFor(stage.id, gate.candidate_id)}`);
  const manifest = readJson(repo, gate.manifest_path, errors, "candidate manifest");
  if (!manifest) return;
  if (manifest.stage_id !== stage.id) errors.push(`candidate manifest: stage_id ${manifest.stage_id} != ${stage.id}`);
  if (manifest.candidate_id !== gate.candidate_id) errors.push(`candidate manifest: id ${manifest.candidate_id} != gate ${gate.candidate_id}`);
  if (manifest.hash_algorithm !== HASH_ALGORITHM) errors.push(`candidate manifest: a gate candidate must use ${HASH_ALGORITHM}`);
  let manifestHash = null;
  try {
    manifestHash = Array.isArray(manifest.entries) ? candidateId(manifest.entries) : null;
  } catch (e) {
    errors.push(`candidate manifest: ${e.message}`);
  }
  if (manifestHash !== manifest.candidate_id) errors.push("candidate manifest: entries do not hash to its candidate_id (tampered)");
  if (manifest.source_commit !== gate.source_commit) errors.push("candidate manifest: source_commit differs from the gate record");
  if (JSON.stringify(manifest.spec) !== JSON.stringify(stage.candidate_spec)) errors.push("candidate manifest: spec differs from the stage's candidate_spec");
  for (const e of specPolicyErrors(manifest.spec)) errors.push(`candidate manifest: spec ${e}`);
  if (stage.candidate.candidate_id !== gate.candidate_id) errors.push(`stages.json: ${stage.id} candidate ${stage.candidate.candidate_id} != gate ${gate.candidate_id}`);
  let recomputed;
  try {
    recomputed = mode === "historical"
      ? manifestFromRef(repo, gate.source_commit, manifest.spec)
      : manifestFromWorkingTree(repo, manifest.spec);
  } catch (e) {
    errors.push(`candidate: cannot recompute from ${mode === "historical" ? gate.source_commit : "working tree"} (${e.message.split("\n")[0]})`);
    return;
  }
  const id = candidateId(recomputed);
  if (id !== gate.candidate_id) {
    const d = diffManifests(manifest.entries || [], recomputed);
    const sample = [...d.changed.map((p) => `~${p}`), ...d.added.map((p) => `+${p}`), ...d.removed.map((p) => `-${p}`)].slice(0, 12);
    errors.push(`candidate: ${mode} content hashes to ${id}, approval covers ${gate.candidate_id}; changed: ${sample.join(" ")}`);
  }
}

// ---------- approval immutability (historical mode) ----------
/**
 * After a gate is approved, its decision record and every evidence file it relies on must stay byte-identical in
 * git history. The approval commit is the first commit in which the gate file records APPROVED; no later commit
 * and no working-tree edit may change those files. Rewriting this requires rewriting published git history.
 */
export function checkApprovalImmutable(repo, gateRel, evidenceRels, stageId, errors) {
  let commits;
  try {
    commits = git(repo, ["log", "--reverse", "--format=%H", "--", gateRel]).toString().split("\n").filter(Boolean);
  } catch (e) {
    return void errors.push(`history: cannot read git history of ${gateRel} (${e.message.split("\n")[0]})`);
  }
  let approval = null;
  for (const c of commits) {
    try {
      if (JSON.parse(git(repo, ["show", `${c}:${gateRel}`]).toString()).decision === "APPROVED") {
        approval = c;
        break;
      }
    } catch {
      /* file absent or unparsable in that commit */
    }
  }
  if (!approval) return void errors.push(`history: ${gateRel} has never been committed with decision APPROVED`);
  const files = [gateRel, ...evidenceRels];
  for (const rel of files) {
    let atApproval;
    try {
      atApproval = git(repo, ["show", `${approval}:${rel}`]);
    } catch {
      errors.push(`history: ${rel} was not committed at the approval commit ${approval.slice(0, 10)}`);
      continue;
    }
    const later = git(repo, ["log", "--format=%h", `${approval}..HEAD`, "--", rel]).toString().split("\n").filter(Boolean);
    if (later.length) errors.push(`history: ${rel} changed after approval (commits ${later.join(",")})`);
    if (!repoFile(repo, rel) || !readFileSync(join(repo, rel)).equals(atApproval)) errors.push(`history: working-tree ${rel} differs from the approved version`);
  }
  // Findings of this stage are frozen at approval as well.
  try {
    const then = JSON.parse(git(repo, ["show", `${approval}:docs/delivery/findings.json`]).toString()).findings.filter((f) => f.stage_id === stageId);
    const now = JSON.parse(readFileSync(join(repo, "docs/delivery/findings.json"), "utf8")).findings.filter((f) => f.stage_id === stageId);
    if (JSON.stringify(then) !== JSON.stringify(now)) errors.push(`history: ${stageId} findings changed after approval`);
  } catch (e) {
    errors.push(`history: cannot compare ${stageId} findings with the approval commit (${e.message.split("\n")[0]})`);
  }
}

// ---------- whole gate ----------
export function validateGate(repo, stageId, { mode = "current", stagesDoc = null } = {}) {
  const errors = [];
  const doc = stagesDoc || loadStages(repo, errors);
  if (!doc) return errors;
  const stage = doc.stages.find((s) => s.id === stageId);
  if (!stage) return [`stages.json: unknown stage ${stageId}`];
  const gate = readJson(repo, stage.gate_record, errors, `gate ${stageId}`);
  if (!gate) return errors;
  const before = errors.length;
  checkSchema("gate", gate, `gate ${stageId}`, errors);
  if (errors.length > before) return errors;
  if (gate.stage_id !== stageId) errors.push(`gate ${stageId}: stage_id is ${gate.stage_id}`);
  if (gate.decision !== "APPROVED") errors.push(`gate ${stageId}: decision is ${gate.decision}`);
  if (gate.blocking_conditions.length) errors.push(`gate ${stageId}: blocking conditions recorded: ${gate.blocking_conditions.join("; ")}`);
  const allowedStates = mode === "historical" ? ["APPROVED"] : ["VERIFYING", "APPROVED"];
  if (!allowedStates.includes(stage.state)) errors.push(`stages.json: ${stageId} state ${stage.state} not in ${allowedStates.join("/")}`);
  const idx = stageIndex(stageId);
  const expectedPrev = idx === 0 ? null : STAGE_ORDER[idx - 1];
  if (gate.previous_gate !== expectedPrev) errors.push(`gate ${stageId}: previous_gate must be ${expectedPrev}`);
  for (const dep of stage.depends_on) {
    const depStage = doc.stages.find((s) => s.id === dep);
    const depGate = depStage && readJson(repo, depStage.gate_record, [], dep);
    if (!depGate || depGate.decision !== "APPROVED" || depStage.state !== "APPROVED") errors.push(`gate ${stageId}: dependency ${dep} is not APPROVED`);
  }
  checkCandidate(repo, stage, gate, mode, errors);
  const records = [];
  const sessions = new Map();
  for (const role of REQUIRED_REVIEWERS) {
    const rel = gate.reviews[role];
    if (!rel) {
      errors.push(`gate ${stageId}: missing ${role} review`);
      continue;
    }
    const rec = checkReview(repo, rel, { stage, role, candidate: gate.candidate_id }, errors);
    if (rec) records.push(rec);
  }
  const audit = checkReview(repo, gate.release_audit, { stage, role: AUDITOR, candidate: gate.candidate_id, extraOutputs: [stage.gate_record] }, errors);
  if (audit) {
    records.push(audit);
    if (JSON.stringify(audit.invocation_reference) !== JSON.stringify(gate.invocation_reference)) {
      errors.push(`gate ${stageId}: gate record was not written by the audited release-auditor invocation`);
    }
  }
  for (const rec of records) {
    const sid = rec.invocation_reference.session_id;
    if (sessions.has(sid)) errors.push(`independence: ${rec.reviewer_role} and ${sessions.get(sid)} share invocation ${sid}`);
    sessions.set(sid, rec.reviewer_role);
  }
  for (const t of gate.tests) {
    if (t.result !== "PASS") errors.push(`gate ${stageId}: test '${t.name}' is ${t.result}`);
    for (const ev of t.evidence) if (!repoFile(repo, ev)) errors.push(`gate ${stageId}: test evidence is not an existing repository file: ${ev}`);
  }
  checkReviewRounds(repo, stage, errors);
  checkFindings(repo, stage, records, gate, errors);
  checkRegister(repo, stageId, errors, gate, records);
  if (mode === "historical") {
    const evidence = [gate.manifest_path, ...REQUIRED_REVIEWERS.map((r) => gate.reviews[r]).filter(Boolean), gate.release_audit];
    for (const rec of records) evidence.push(...runFiles(stageId, rec.invocation_reference.run_id));
    const reviewDir = join(repo, "docs/delivery/reviews", stageId);
    const walk = (abs, rel) => {
      for (const name of readdirSync(abs)) {
        const a = join(abs, name);
        const r = `${rel}/${name}`;
        if (statSync(a).isDirectory()) walk(a, r);
        else evidence.push(r);
      }
    };
    if (existsSync(reviewDir)) walk(reviewDir, `docs/delivery/reviews/${stageId}`);
    checkApprovalImmutable(repo, stage.gate_record, [...new Set(evidence)], stageId, errors);
  }
  return errors;
}

// ---------- pipeline (cannot advance past a failed gate) ----------
export function validatePipeline(repo) {
  const errors = [];
  const doc = loadStages(repo, errors);
  if (!doc) return { errors, current: null };
  let current = null;
  for (const s of doc.stages) {
    if (current === null && s.state !== "APPROVED") {
      current = s;
      for (const dep of s.depends_on) {
        if (doc.stages.find((x) => x.id === dep).state !== "APPROVED") errors.push(`pipeline: ${s.id} is active but dependency ${dep} is not APPROVED`);
      }
      continue;
    }
    if (current === null) {
      for (const e of validateGate(repo, s.id, { mode: "historical", stagesDoc: doc })) errors.push(`${s.id}: ${e}`);
    } else if (s.state !== "PLANNED") {
      errors.push(`pipeline: ${s.id} is ${s.state} while earlier gate ${current.id} is not APPROVED`);
    }
  }
  return { errors, current };
}

// ---------- reconciliation on resumption (A27) ----------
export function reconcile(repo) {
  const errors = [];
  const doc = loadStages(repo, errors);
  if (!doc) return { errors, report: [] };
  const report = [];
  const active = doc.stages.find((s) => s.state !== "APPROVED");
  if (!active) return { errors, report: ["all stages APPROVED"] };
  report.push(`active stage: ${active.id} (${active.state})`);
  if (active.candidate.manifest_path && repoFile(repo, active.candidate.manifest_path)) {
    const manifest = JSON.parse(readFileSync(join(repo, active.candidate.manifest_path), "utf8"));
    const now = manifestFromWorkingTree(repo, manifest.spec);
    const id = candidateId(now);
    const d = diffManifests(manifest.entries, now);
    report.push(`frozen candidate: ${manifest.candidate_id}`);
    report.push(`working tree:     ${id} (${id === manifest.candidate_id ? "matches" : `differs: ${d.changed.length} changed, ${d.added.length} added, ${d.removed.length} removed`})`);
    for (const r of active.review_rounds) {
      for (const [role, rel] of Object.entries(r.records)) {
        const rec = repoFile(repo, rel) ? JSON.parse(readFileSync(join(repo, rel), "utf8")) : null;
        const stale = !rec || rec.candidate_id !== id;
        report.push(`round ${r.round} ${role}: ${rec ? rec.verdict : "missing"}${stale ? " (STALE for current content)" : " (current)"}`);
      }
    }
  } else {
    report.push("no frozen candidate yet");
  }
  return { errors, report };
}
