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
gzip -n "$OUT/transcript.jsonl"

python3 - "$OUT" "$RUN_ID" "$ROLE" "$STAGE" "$TASK" "$SESSION_ID" "$MODEL" "$CWD" "$HEAD_COMMIT" "$ASSIGN_REL" "$ASSIGN_SHA" "$STARTED" "$FINISHED" "$EXIT" "$ATTEMPTS" <<'PY'
import gzip, hashlib, json, sys
out, run_id, role, stage, task, sid, model, cwd, head, arel, asha, started, finished, code, resumes = sys.argv[1:]
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
with open(f"{out}/result.json", "w", encoding="utf-8") as f:
    json.dump({"result": (result or {}).get("result")}, f, ensure_ascii=False, indent=1)
for name, key in (("result.json", "result_sha256"), ("transcript.jsonl.gz", "transcript_sha256")):
    with open(f"{out}/{name}", "rb") as f:
        meta[key] = hashlib.sha256(f.read()).hexdigest()
with open(f"{out}/meta.json", "w", encoding="utf-8") as f:
    json.dump(meta, f, indent=1)
print(json.dumps(meta))
PY
exit "$EXIT"
