#!/usr/bin/env bash
# Invoke one project agent as a separate, real Claude Code process and preserve invocation evidence.
#
#   tools/agents/run-agent.sh --role <agent-name> --stage <DGx> --task <task-id> --assignment <file> [--cwd <dir>] [--model <id>]
#
# - Loads .claude/agents/<role>.md via `claude -p --agent <role>`.
# - Gives each run a unique --session-id (its invocation reference).
# - Applies the role write guard via --settings tools/agents/settings/<role>.settings.json. Frontmatter hooks
#   don't run in --agent main-session mode; this was verified in P0 and is recorded in docs/delivery/agents.md.
# - Passes the orchestrator's model explicitly, so `model: inherit` really means the orchestrator's model.
# - Keeps permission mode `auto` (the same classifier-gated controls as the orchestrator session; not weakened).
# - If the run stops only because the permission classifier returned no verdict repeatedly, it resumes the SAME
#   session (same invocation reference) after a pause, at most MTH_MAX_RESUMES times (default 6). An agent that is
#   stuck on repeated classifier refusals ends its turn with a final message whose first line is exactly
#   CLASSIFIER-BLOCKED; that is treated the same way.
# - Writes docs/delivery/runs/<stage>/<run-id>/{meta.json,result.json,transcript.jsonl.gz} in the main repository,
#   with SHA-256 hashes of the result and transcript recorded in meta.json.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROLE="" STAGE="" TASK="" ASSIGNMENT="" CWD="$REPO_ROOT" MODEL="${MTH_AGENT_MODEL:-claude-opus-5-5}"
MAX_RESUMES="${MTH_MAX_RESUMES:-6}" RESUME_PAUSE="${MTH_RESUME_PAUSE_SECONDS:-120}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --role) ROLE="$2"; shift 2 ;;
    --stage) STAGE="$2"; shift 2 ;;
    --task) TASK="$2"; shift 2 ;;
    --assignment) ASSIGNMENT="$2"; shift 2 ;;
    --cwd) CWD="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
done
[[ -n "$ROLE" && -n "$STAGE" && -n "$TASK" && -n "$ASSIGNMENT" ]] || { echo "usage: $0 --role R --stage DGx --task T --assignment FILE [--cwd DIR] [--model ID]" >&2; exit 64; }
[[ "$STAGE" =~ ^DG[0-7]$ ]] || { echo "invalid --stage '$STAGE' (expected DG0-DG7)" >&2; exit 64; }
[[ "$TASK" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "invalid --task '$TASK' (allowed: A-Z a-z 0-9 . _ -)" >&2; exit 64; }
[[ "$ROLE" =~ ^[a-z][a-z-]*$ ]] || { echo "invalid --role '$ROLE'" >&2; exit 64; }
[[ "$MODEL" =~ ^[A-Za-z0-9._:-]+$ ]] || { echo "invalid --model '$MODEL'" >&2; exit 64; }
[[ -f "$REPO_ROOT/.claude/agents/$ROLE.md" ]] || { echo "no agent definition for $ROLE" >&2; exit 65; }
SETTINGS="$REPO_ROOT/tools/agents/settings/$ROLE.settings.json"
[[ -f "$SETTINGS" ]] || { echo "no guard settings for $ROLE" >&2; exit 65; }
ASSIGNMENT_ABS="$(cd "$(dirname "$ASSIGNMENT")" && pwd)/$(basename "$ASSIGNMENT")"
[[ -f "$ASSIGNMENT_ABS" ]] || { echo "assignment not found: $ASSIGNMENT" >&2; exit 66; }
[[ "$ASSIGNMENT_ABS" == "$REPO_ROOT/"* ]] || { echo "assignment must live inside the repository" >&2; exit 66; }

SESSION_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RUN_ID="${STAGE}-${TASK}-${ROLE}-$(date -u +%Y%m%dT%H%M%SZ)-${SESSION_ID:0:8}"
OUT="$REPO_ROOT/docs/delivery/runs/$STAGE/$RUN_ID"
mkdir -p "$REPO_ROOT/docs/delivery/runs/$STAGE"
mkdir "$OUT" # fails if the directory exists: evidence is never overwritten
HEAD_COMMIT="$(git -C "$CWD" rev-parse HEAD 2>/dev/null || echo unknown)"
ASSIGN_SHA="$(sha256sum "$ASSIGNMENT_ABS" | cut -d' ' -f1)"
ASSIGN_REL="${ASSIGNMENT_ABS#"$REPO_ROOT"/}"

PROMPT="You are invoked as project agent '${ROLE}' for stage ${STAGE}, task ${TASK}. Your invocation_reference is: {\"kind\":\"claude-code-cli-session\",\"run_id\":\"${RUN_ID}\",\"session_id\":\"${SESSION_ID}\"}. Your complete assignment is in the file ${ASSIGNMENT_ABS} (sha256 ${ASSIGN_SHA}). Read it first, then read CLAUDE.md and docs/delivery/agent-protocol.md, and execute the assignment exactly. Your working directory is ${CWD}."
RESUME_PROMPT="Your previous turn in this session was interrupted because the permission classifier returned no safety verdict repeatedly (a transient infrastructure outage, not a judgement about your actions). Continue your assignment from where you stopped. Re-run any check whose result you did not obtain. Do not assume anything that was not actually executed."

classifier_outage() {
  # True when the last result line reports the classifier-outage stop.
  python3 - "$1" <<'PY'
import json, sys
last = None
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    try:
        o = json.loads(line)
    except ValueError:
        continue
    if o.get("type") == "result":
        last = o
blob = json.dumps(last or {})
stopped = bool(last) and last.get("is_error") and "no safety verdict" in blob
marked = bool(last) and str(last.get("result") or "").lstrip().startswith("CLASSIFIER-BLOCKED")
sys.exit(0 if stopped or marked else 1)
PY
}

# Snapshot of every non-ignored file (path -> sha256) before the run; the diff after the run is the run's outputs.
snapshot() {
  python3 - "$REPO_ROOT" <<'PY'
import hashlib, json, os, subprocess, sys
root = sys.argv[1]
paths = subprocess.run(["git", "-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                       capture_output=True, check=True).stdout.decode().split("\0")
out = {}
for p in paths:
    if not p or p.startswith("docs/delivery/runs/"):
        continue
    full = os.path.join(root, p)
    if os.path.islink(full):
        out[p] = "symlink:" + os.readlink(full)
    elif os.path.isfile(full):
        with open(full, "rb") as f:
            out[p] = hashlib.sha256(f.read()).hexdigest()
json.dump(out, sys.stdout)
PY
}
snapshot > "$OUT/.pre-snapshot.json"

ATTEMPTS=0
set +e
( cd "$CWD" && claude -p --agent "$ROLE" --model "$MODEL" --permission-mode auto \
    --session-id "$SESSION_ID" --settings "$SETTINGS" \
    --output-format stream-json --verbose "$PROMPT" < /dev/null ) > "$OUT/transcript.jsonl" 2> "$OUT/stderr.log"
EXIT=$?
while [[ $ATTEMPTS -lt $MAX_RESUMES ]] && classifier_outage "$OUT/transcript.jsonl"; do
  ATTEMPTS=$((ATTEMPTS + 1))
  echo "classifier outage detected; resuming session $SESSION_ID (attempt $ATTEMPTS) after ${RESUME_PAUSE}s" >> "$OUT/stderr.log"
  sleep "$RESUME_PAUSE"
  ( cd "$CWD" && claude -p --agent "$ROLE" --model "$MODEL" --permission-mode auto \
      --resume "$SESSION_ID" --settings "$SETTINGS" \
      --output-format stream-json --verbose "$RESUME_PROMPT" < /dev/null ) >> "$OUT/transcript.jsonl" 2>> "$OUT/stderr.log"
  EXIT=$?
done
set -e
FINISHED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
snapshot > "$OUT/.post-snapshot.json"
gzip -n "$OUT/transcript.jsonl"

python3 - "$OUT" "$RUN_ID" "$ROLE" "$STAGE" "$TASK" "$SESSION_ID" "$MODEL" "$CWD" "$HEAD_COMMIT" "$ASSIGN_REL" "$ASSIGN_SHA" "$STARTED" "$FINISHED" "$EXIT" "$ATTEMPTS" "$REPO_ROOT" <<'PY'
import gzip, hashlib, json, sys
out, run_id, role, stage, task, sid, model, cwd, head, arel, asha, started, finished, code, resumes, repo_root_arg = sys.argv[1:]
result = None
with gzip.open(f"{out}/transcript.jsonl.gz", "rt", encoding="utf-8", errors="replace") as f:
    for line in f:
        try:
            o = json.loads(line)
        except ValueError:
            continue
        if o.get("type") == "result":
            result = o
meta = {
    "run_id": run_id, "role": role, "stage": stage, "task": task,
    "invocation_reference": {"kind": "claude-code-cli-session", "run_id": run_id, "session_id": sid},
    "model_requested": model, "permission_mode": "auto",
    "guard_settings": f"tools/agents/settings/{role}.settings.json",
    "cwd": cwd, "head_commit_at_start": head,
    "assignment": arel, "assignment_sha256": asha,
    "started_at": started, "finished_at": finished, "exit_code": int(code),
    "classifier_outage_resumes": int(resumes),
}
if result:
    meta.update({
        "result_session_id": result.get("session_id"),
        "is_error": result.get("is_error"), "subtype": result.get("subtype"),
        "num_turns": result.get("num_turns"), "duration_ms": result.get("duration_ms"),
        "models_used": sorted((result.get("modelUsage") or {}).keys()),
        "total_cost_usd": result.get("total_cost_usd"),
    })
else:
    meta["is_error"] = True
    meta["subtype"] = "no-result-line"
# Files created, changed or deleted in the tree during the run window (concurrent runs may overlap), and the
# repository paths this agent itself wrote through its file tools (Write/Edit/MultiEdit/NotebookEdit).
import os
pre = json.load(open(f"{out}/.pre-snapshot.json"))
post = json.load(open(f"{out}/.post-snapshot.json"))
os.remove(f"{out}/.pre-snapshot.json")
os.remove(f"{out}/.post-snapshot.json")
outputs = {p: h for p, h in post.items() if pre.get(p) != h}
deleted = sorted(p for p in pre if p not in post)
repo_root = os.path.realpath(repo_root_arg)

def rel_path(fp):
    ap = os.path.realpath(fp if os.path.isabs(fp) else os.path.join(cwd, fp))
    for base in (repo_root, os.path.realpath(cwd)):
        if ap.startswith(base + os.sep):
            return os.path.relpath(ap, base).replace(os.sep, "/")
    return None

# Replay the agent's SUCCESSFUL file-tool calls in order (F-DG0-119): Write sets the content, Edit/MultiEdit apply
# their replacements. A path whose final bytes equal the replay is "tool_authored"; attempted or failed calls,
# later shell edits and other writers do not count.
uses, failed = [], set()
with gzip.open(f"{out}/transcript.jsonl.gz", "rt", encoding="utf-8", errors="replace") as f:
    for line in f:
        try:
            o = json.loads(line)
        except ValueError:
            continue
        content = (o.get("message") or {}).get("content")
        if not isinstance(content, list):
            continue
        for c in content:
            if not isinstance(c, dict):
                continue
            if o.get("type") == "assistant" and c.get("type") == "tool_use" and c.get("name") in ("Write", "Edit", "MultiEdit", "NotebookEdit"):
                uses.append(c)
            elif o.get("type") == "user" and c.get("type") == "tool_result" and c.get("is_error"):
                failed.add(c.get("tool_use_id"))
written, state = set(), {}
for c in uses:
    inp = c.get("input") or {}
    rp = rel_path(inp.get("file_path") or inp.get("notebook_path") or "")
    if not rp:
        continue
    written.add(rp)
    if c.get("id") in failed:
        continue
    name = c.get("name")
    if name == "Write":
        state[rp] = inp.get("content", "")
    elif name in ("Edit", "MultiEdit") and isinstance(state.get(rp), str):
        edits = [inp] if name == "Edit" else (inp.get("edits") or [])
        cur = state[rp]
        for e in edits:
            old, new = e.get("old_string", ""), e.get("new_string", "")
            if old == "" or old not in cur:
                cur = None
                break
            cur = cur.replace(old, new) if e.get("replace_all") else cur.replace(old, new, 1)
        state[rp] = cur
    else:
        state[rp] = None  # cannot be reconstructed from this run's own calls
tool_authored = {}
for rp, text in state.items():
    if isinstance(text, str):
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        if post.get(rp) == digest:
            tool_authored[rp] = digest
meta["outputs"] = dict(sorted(outputs.items()))
meta["deleted"] = deleted
meta["written_by_tools"] = sorted(written)
meta["tool_authored"] = dict(sorted(tool_authored.items()))
with open(f"{out}/result.json", "w", encoding="utf-8") as f:
    json.dump({"result": (result or {}).get("result")}, f, ensure_ascii=False, indent=1)
for name, key in (("result.json", "result_sha256"), ("transcript.jsonl.gz", "transcript_sha256")):
    with open(f"{out}/{name}", "rb") as f:
        meta[key] = hashlib.sha256(f.read()).hexdigest()
with open(f"{out}/meta.json", "w", encoding="utf-8") as f:
    json.dump(meta, f, indent=1)
print(json.dumps({k: meta[k] for k in ("run_id", "role", "exit_code", "is_error", "subtype", "num_turns", "classifier_outage_resumes") if k in meta}))
PY

# Review roles: commit the run evidence and the reviewer-authored files immediately, so they are write-once in git
# history from the moment the run ends (D-021). Implementer output is integrated by the orchestrator instead.
case "$ROLE" in
  domain-reviewer|code-security-reviewer|qa-verifier|release-auditor)
    LIST="$REPO_ROOT/.git/mth-commit-list-$RUN_ID"
    python3 - "$OUT/meta.json" "$REPO_ROOT" "docs/delivery/runs/$STAGE/$RUN_ID" > "$LIST" <<'PY'
import json, os, sys
meta = json.load(open(sys.argv[1]))
root, run_dir = sys.argv[2], sys.argv[3]
paths = [run_dir] + [p for p in sorted(meta.get("tool_authored", {})) if os.path.exists(os.path.join(root, p))]
sys.stdout.write("\0".join(paths) + "\0")
PY
    COMMIT_RC=0
    (
      flock 9
      export GIT_LITERAL_PATHSPECS=1
      git -C "$REPO_ROOT" add --pathspec-from-file="$LIST" --pathspec-file-nul || exit $?
      msg="$(git -C "$REPO_ROOT" commit -q -m "run: $RUN_ID (review evidence, auto-committed by run-agent.sh)" \
        --pathspec-from-file="$LIST" --pathspec-file-nul 2>&1)" && exit 0
      rc=$?
      case "$msg" in
        *"nothing to commit"*|*"no changes added"*) echo "auto-commit: nothing to commit for $RUN_ID" >&2; exit 0 ;;
        *) echo "$msg" >&2; exit "$rc" ;;
      esac
    ) 9> "$REPO_ROOT/.git/mth-commit.lock" || COMMIT_RC=$?
    rm -f "$LIST"
    if [[ $COMMIT_RC -ne 0 ]]; then
      echo "run-agent: FAILED to auto-commit review evidence for $RUN_ID (git exit $COMMIT_RC); the evidence is NOT write-once yet" >&2
      exit 70
    fi
    ;;
esac
exit "$EXIT"
