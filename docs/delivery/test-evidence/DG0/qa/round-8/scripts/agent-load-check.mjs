// Round 7: copied unchanged from round 6 and re-run on candidate e11b5f0 / dee0316d (qa-verifier, T-DG0-REV-QA-R7).
// Round 6: copied unchanged from round 5 and re-run on candidate a059b55 (qa-verifier, T-DG0-REV-QA-R6).
// Independent check of the T-DG0-LOAD run evidence (qa-verifier, DG0 round 2).
// Reads runs/DG0/DG0-T-DG0-LOAD-*/{meta.json,result.json,transcript.jsonl.gz} and .claude/agents/*.md.
// Usage: node agent-load-check.mjs <repo-root>
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";

const repo = resolve(process.argv[2] || ".");
const errors = [];
const defs = readdirSync(join(repo, ".claude/agents")).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort();
console.log(`definitions (${defs.length}): ${defs.join(", ")}`);
for (const d of defs) {
  const txt = readFileSync(join(repo, ".claude/agents", d + ".md"), "utf8");
  const fm = txt.match(/^---\n([\s\S]*?)\n---/);
  if (!fm) errors.push(`${d}: no frontmatter`);
  else {
    const name = (fm[1].match(/^name:\s*(.+)$/m) || [])[1];
    const desc = (fm[1].match(/^description:\s*(.+)$/m) || [])[1];
    if (name?.trim() !== d) errors.push(`${d}: frontmatter name '${name}'`);
    if (!desc) errors.push(`${d}: no description`);
    if (!/agent-protocol\.md/.test(txt)) errors.push(`${d}: does not reference agent-protocol.md`);
  }
}
const base = join(repo, "docs/delivery/runs/DG0");
const runs = readdirSync(base).filter((d) => d.startsWith("DG0-T-DG0-LOAD-")).sort();
const orch = "claude-opus-5-5";
const sessions = new Set();
const roles = new Set();
const sha = (b) => createHash("sha256").update(b).digest("hex");
const loadSha = sha(readFileSync(join(repo, "docs/delivery/assignments/DG0/T-DG0-LOAD.md")));
console.log(`T-DG0-LOAD.md sha256 now: ${loadSha}`);
for (const r of runs) {
  const dir = join(base, r);
  const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8"));
  const res = JSON.parse(readFileSync(join(dir, "result.json"), "utf8"));
  const lines = gunzipSync(readFileSync(join(dir, "transcript.jsonl.gz"))).toString("utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const init = lines.find((l) => l.type === "system" && l.subtype === "init");
  const results = lines.filter((l) => l.type === "result");
  const last = results.at(-1);
  // tool_use Write/Edit attempts and their tool_result
  const uses = new Map();
  for (const l of lines) {
    for (const c of (l.message?.content && Array.isArray(l.message.content) ? l.message.content : [])) {
      if (c.type === "tool_use" && ["Write", "Edit"].includes(c.name)) uses.set(c.id, { path: c.input?.file_path, name: c.name });
      if (c.type === "tool_result" && uses.has(c.tool_use_id)) {
        const u = uses.get(c.tool_use_id);
        const text = typeof c.content === "string" ? c.content : JSON.stringify(c.content);
        u.blocked = /BLOCKED by write guard/.test(text);
        u.error = !!c.is_error;
      }
    }
  }
  const writes = [...uses.values()];
  const oos = writes.filter((w) => /docs\/source\//.test(w.path || ""));
  const ins = writes.filter((w) => !/docs\/source\//.test(w.path || ""));
  const probeLeft = oos.some((w) => existsSync(w.path));
  const ok = {
    role_matches_dir: r.includes(meta.role),
    session_init: init?.session_id === meta.invocation_reference.session_id,
    session_result: last?.session_id === meta.invocation_reference.session_id && meta.result_session_id === meta.invocation_reference.session_id,
    model_init: init?.model === orch && meta.model_requested === orch,
    agent_loaded: init?.agent === meta.role || JSON.stringify(init || {}).includes(meta.role),
    success: meta.exit_code === 0 && !meta.is_error && last && !last.is_error,
    oos_blocked: oos.length > 0 && oos.every((w) => w.blocked),
    in_scope_ok: ins.length > 0 && ins.some((w) => !w.blocked && !w.error),
    no_probe_left: !probeLeft,
    guard_settings: meta.guard_settings === `tools/agents/settings/${meta.role}.settings.json`,
    assignment_sha: meta.assignment_sha256 === loadSha,
  };
  if (sessions.has(meta.invocation_reference.session_id)) errors.push(`${r}: duplicate session`);
  sessions.add(meta.invocation_reference.session_id);
  roles.add(meta.role);
  for (const [k, v] of Object.entries(ok)) if (!v) errors.push(`${r}: ${k} false`);
  console.log(`${meta.role.padEnd(26)} session ${meta.invocation_reference.session_id} init.model=${init?.model} init.agent=${init?.agent ?? "(n/a)"} models_used=${(meta.models_used || []).join("+")} writes: oos=${oos.map((w) => `${w.path?.replace(repo + "/", "")}:${w.blocked ? "BLOCKED" : "ALLOWED"}`).join(",")} in=${ins.map((w) => `${w.path?.replace(repo + "/", "")}:${w.blocked ? "BLOCKED" : w.error ? "ERROR" : "OK"}`).join(",")} checks=${Object.values(ok).every(Boolean) ? "all ok" : JSON.stringify(ok)}`);
}
console.log(`runs: ${runs.length}; distinct sessions: ${sessions.size}; distinct roles: ${roles.size}; roles == definitions: ${JSON.stringify([...roles].sort()) === JSON.stringify(defs)}`);
if (runs.length !== 10 || sessions.size !== 10 || JSON.stringify([...roles].sort()) !== JSON.stringify(defs)) errors.push("not exactly ten distinct runs covering the ten definitions");
const probes = readdirSync(join(repo, "docs/source")).filter((f) => /PROBE/i.test(f));
console.log(`probe files under docs/source: ${probes.length ? probes.join(",") : "none"}`);
if (probes.length) errors.push("probe files exist under docs/source");
for (const e of errors) console.log(`ERROR ${e}`);
console.log(`errors: ${errors.length}`);
process.exit(errors.length ? 1 : 0);
