// Delivery gate rules (master prompt §0.4–§0.5). Pure checks over repository files; every check returns error strings.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validate } from "./schema.mjs";
import { parseCsv } from "./csv.mjs";
import { candidateId, manifestFromRef, manifestFromWorkingTree, diffManifests } from "./candidate.mjs";

export const STAGE_ORDER = ["DG0", "DG1", "DG2", "DG3", "DG4", "DG5", "DG6", "DG7"];
export const REQUIRED_REVIEWERS = ["domain-reviewer", "code-security-reviewer", "qa-verifier"];
export const AUDITOR = "release-auditor";
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

const here = new URL(".", import.meta.url).pathname;
const schemaCache = {};
export function schema(name) {
  if (!schemaCache[name]) schemaCache[name] = JSON.parse(readFileSync(join(here, "..", "schemas", `${name}.schema.json`), "utf8"));
  return schemaCache[name];
}

export function readJson(repo, rel, errors, label = rel) {
  const p = join(repo, rel);
  if (!existsSync(p)) {
    errors.push(`${label}: file not found (${rel})`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(p, "utf8"));
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
  const p = join(repo, rel);
  if (!existsSync(p)) {
    errors.push(`${rel}: file not found`);
    return null;
  }
  try {
    return parseCsv(readFileSync(p, "utf8"));
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
    if (row.evidence.trim()) {
      for (const ev of splitList(row.evidence)) {
        if (ev.includes("/") && !existsSync(join(repo, ev.split("#")[0]))) errors.push(`${where}: evidence path not found: ${ev}`);
      }
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
export function checkInvocation(repo, stageId, ref, role, errors, label) {
  if (!ref) return errors.push(`${label}: missing invocation_reference`);
  const metaRel = `docs/delivery/runs/${stageId}/${ref.run_id}/meta.json`;
  const meta = readJson(repo, metaRel, errors, `${label} invocation`);
  if (!meta) return;
  if (meta.role !== role) errors.push(`${label}: invocation ${ref.run_id} was run as '${meta.role}', not '${role}'`);
  if (!meta.invocation_reference || meta.invocation_reference.session_id !== ref.session_id) {
    errors.push(`${label}: session_id does not match the recorded run ${ref.run_id}`);
  }
  if (meta.exit_code !== 0 || meta.is_error) errors.push(`${label}: invocation ${ref.run_id} did not complete successfully`);
}

// ---------- review records ----------
export function checkReview(repo, rel, { stage, role, candidate }, errors) {
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
    if (!existsSync(join(repo, ev.split("#")[0]))) errors.push(`${label}: evidence path not found: ${ev}`);
  }
  if (!existsSync(join(repo, rec.assignment))) errors.push(`${label}: assignment file not found: ${rec.assignment}`);
  checkInvocation(repo, stage.id, rec.invocation_reference, role, errors, label);
  return rec;
}

// ---------- findings ----------
export function checkFindings(repo, stageId, reviewRecords, gate, errors) {
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
  for (const rec of reviewRecords) {
    for (const fid of rec.findings) if (!byId.has(fid)) errors.push(`review ${rec.reviewer_role}: finding ${fid} not in findings.json`);
  }
  for (const f of doc.findings.filter((x) => x.stage_id === stageId)) {
    const where = `finding ${f.id} (${f.severity}${f.mandatory_violation ? ", mandatory" : ""})`;
    if (!TERMINAL_FINDING.has(f.status)) {
      errors.push(`${where}: unresolved (${f.status})`);
      continue;
    }
    if (f.status === "CLOSED_VERIFIED" || f.status === "REJECTED_INVALID") {
      const v = f.verification;
      if (!v) {
        errors.push(`${where}: ${f.status} without independent verification`);
        continue;
      }
      if (v.result !== "PASS") errors.push(`${where}: verification result ${v.result}`);
      if (v.by_role === f.owner) errors.push(`${where}: verified by its own owner (${f.owner})`);
      if (f.status === "CLOSED_VERIFIED" && !f.fix_revision) errors.push(`${where}: CLOSED_VERIFIED without fix_revision`);
      checkInvocation(repo, stageId, v.invocation_reference, v.by_role, errors, `${where} verification`);
    }
    if (f.status === "ACCEPTED_OBSERVATION") {
      if (f.severity !== "Low" || f.mandatory_violation) errors.push(`${where}: only Low, non-mandatory findings may be accepted as observations`);
      const acc = f.acceptance;
      if (!acc) errors.push(`${where}: accepted without acceptance record`);
      else {
        if (!acc.accepted_by.includes(AUDITOR)) errors.push(`${where}: acceptance lacks release-auditor agreement`);
        if (!acc.accepted_by.some((r) => REQUIRED_REVIEWERS.includes(r))) errors.push(`${where}: acceptance lacks a specialist reviewer's agreement`);
      }
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

// ---------- candidate ----------
export function checkCandidate(repo, stage, gate, mode, errors) {
  const manifest = readJson(repo, gate.manifest_path, errors, "candidate manifest");
  if (!manifest) return;
  if (manifest.stage_id !== stage.id) errors.push(`candidate manifest: stage_id ${manifest.stage_id} != ${stage.id}`);
  if (manifest.candidate_id !== gate.candidate_id) errors.push(`candidate manifest: id ${manifest.candidate_id} != gate ${gate.candidate_id}`);
  if (candidateId(manifest.entries) !== manifest.candidate_id) errors.push("candidate manifest: entries do not hash to its candidate_id (tampered)");
  if (manifest.source_commit !== gate.source_commit) errors.push("candidate manifest: source_commit differs from the gate record");
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
    const d = diffManifests(manifest.entries, recomputed);
    const sample = [...d.changed.map((p) => `~${p}`), ...d.added.map((p) => `+${p}`), ...d.removed.map((p) => `-${p}`)].slice(0, 12);
    errors.push(`candidate: ${mode} content hashes to ${id}, approval covers ${gate.candidate_id}; changed: ${sample.join(" ")}`);
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
  const audit = checkReview(repo, gate.release_audit, { stage, role: AUDITOR, candidate: gate.candidate_id }, errors);
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
    for (const ev of t.evidence) if (!existsSync(join(repo, ev.split("#")[0]))) errors.push(`gate ${stageId}: test evidence not found: ${ev}`);
  }
  checkFindings(repo, stageId, records, gate, errors);
  checkRegister(repo, stageId, errors, gate, records);
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
  if (active.candidate.manifest_path && existsSync(join(repo, active.candidate.manifest_path))) {
    const manifest = JSON.parse(readFileSync(join(repo, active.candidate.manifest_path), "utf8"));
    const now = manifestFromWorkingTree(repo, manifest.spec);
    const id = candidateId(now);
    const d = diffManifests(manifest.entries, now);
    report.push(`frozen candidate: ${manifest.candidate_id}`);
    report.push(`working tree:     ${id} (${id === manifest.candidate_id ? "matches" : `differs: ${d.changed.length} changed, ${d.added.length} added, ${d.removed.length} removed`})`);
    for (const r of active.review_rounds) {
      for (const [role, rel] of Object.entries(r.records)) {
        const rec = existsSync(join(repo, rel)) ? JSON.parse(readFileSync(join(repo, rel), "utf8")) : null;
        const stale = !rec || rec.candidate_id !== id;
        report.push(`round ${r.round} ${role}: ${rec ? rec.verdict : "missing"}${stale ? " (STALE for current content)" : " (current)"}`);
      }
    }
  } else {
    report.push("no frozen candidate yet");
  }
  return { errors, report };
}
