import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
const base = "docs/delivery/runs/DG0";
const dirs = readdirSync(base).filter((d) => d.includes("-T-DG0-LOAD-")).sort();
const sessions = new Set(); let ok = true;
for (const d of dirs) {
  const meta = JSON.parse(readFileSync(`${base}/${d}/meta.json`));
  const lines = gunzipSync(readFileSync(`${base}/${d}/transcript.jsonl.gz`)).toString().trim().split("\n").map((l) => JSON.parse(l));
  const init = lines.find((l) => l.type === "system" && l.subtype === "init") || {};
  const res = lines.find((l) => l.type === "result") || {};
  const sids = new Set(lines.map((l) => l.session_id).filter(Boolean));
  const hookResp = lines.filter((l) => l.subtype === "hook_response");
  const blocked = hookResp.filter((h) => /BLOCKED by write guard/.test(JSON.stringify(h)));
  const probePaths = [...JSON.stringify(blocked).matchAll(/may not write '([^']+)'/g)].map((m) => m[1]);
  const resultJson = JSON.parse(readFileSync(`${base}/${d}/result.json`));
  const agentLine = (resultJson.result || "").match(/AGENT: (\S+)/);
  const modelUsage = Object.keys(res.modelUsage || {});
  const row = {
    dir: d, role: meta.role, init_agent: init.agent ?? init.agent_name ?? null, init_model: init.model, perm: init.permissionMode,
    session_meta: meta.invocation_reference.session_id, transcript_sessions: [...sids], result_session: res.session_id, result_subtype: res.subtype, is_error: res.is_error,
    result_models: modelUsage, reported_agent: agentLine && agentLine[1], blocked_writes: probePaths,
    hook_responses: hookResp.length,
  };
  const good = row.transcript_sessions.length === 1 && row.transcript_sessions[0] === row.session_meta && row.result_session === row.session_meta
    && row.init_model === "claude-opus-5-5" && row.reported_agent === meta.role && probePaths.length >= 1 && !res.is_error && !sessions.has(row.session_meta);
  sessions.add(row.session_meta);
  row.verdict = good ? "PASS" : "FAIL";
  if (!good) ok = false;
  console.log(JSON.stringify(row));
}
console.log(`runs: ${dirs.length}, distinct sessions: ${sessions.size}, overall: ${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
