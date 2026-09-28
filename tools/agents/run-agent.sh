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
# - Writes docs/delivery/runs/<stage>/<run-id>/{meta.json,result.json,transcript.jsonl.gz} in the main repository.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROLE="" STAGE="" TASK="" ASSIGNMENT="" CWD="$REPO_ROOT" MODEL="${MTH_AGENT_MODEL:-claude-opus-5-5}"
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
[[ -f "$REPO_ROOT/.claude/agents/$ROLE.md" ]] || { echo "no agent definition for $ROLE" >&2; exit 65; }
SETTINGS="$REPO_ROOT/tools/agents/settings/$ROLE.settings.json"
[[ -f "$SETTINGS" ]] || { echo "no guard settings for $ROLE" >&2; exit 65; }
ASSIGNMENT_ABS="$(cd "$(dirname "$ASSIGNMENT")" && pwd)/$(basename "$ASSIGNMENT")"
[[ -f "$ASSIGNMENT_ABS" ]] || { echo "assignment not found: $ASSIGNMENT" >&2; exit 66; }

SESSION_ID="$(python3 -c 'import uuid; print(uuid.uuid4())')"
STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RUN_ID="${STAGE}-${TASK}-${ROLE}-$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$REPO_ROOT/docs/delivery/runs/$STAGE/$RUN_ID"
mkdir -p "$OUT"
HEAD_COMMIT="$(git -C "$CWD" rev-parse HEAD 2>/dev/null || echo unknown)"
ASSIGN_SHA="$(sha256sum "$ASSIGNMENT_ABS" | cut -d' ' -f1)"
ASSIGN_REL="${ASSIGNMENT_ABS#"$REPO_ROOT"/}"

PROMPT="You are invoked as project agent '${ROLE}' for stage ${STAGE}, task ${TASK}. Your invocation_reference is: {\"kind\":\"claude-code-cli-session\",\"run_id\":\"${RUN_ID}\",\"session_id\":\"${SESSION_ID}\"}. Your complete assignment is in the file ${ASSIGNMENT_ABS} (sha256 ${ASSIGN_SHA}). Read it first, then read CLAUDE.md and docs/delivery/agent-protocol.md, and execute the assignment exactly. Your working directory is ${CWD}."

set +e
( cd "$CWD" && claude -p --agent "$ROLE" --model "$MODEL" --permission-mode auto \
    --session-id "$SESSION_ID" --settings "$SETTINGS" \
    --output-format stream-json --verbose "$PROMPT" < /dev/null ) > "$OUT/transcript.jsonl" 2> "$OUT/stderr.log"
EXIT=$?
set -e
FINISHED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

python3 - "$OUT" "$RUN_ID" "$ROLE" "$STAGE" "$TASK" "$SESSION_ID" "$MODEL" "$CWD" "$HEAD_COMMIT" "$ASSIGN_REL" "$ASSIGN_SHA" "$STARTED" "$FINISHED" "$EXIT" <<'PY'
import json, sys
out, run_id, role, stage, task, sid, model, cwd, head, arel, asha, started, finished, code = sys.argv[1:]
result = None
with open(f"{out}/transcript.jsonl", encoding="utf-8", errors="replace") as f:
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
}
if result:
    meta.update({
        "result_session_id": result.get("session_id"),
        "is_error": result.get("is_error"), "subtype": result.get("subtype"),
        "num_turns": result.get("num_turns"), "duration_ms": result.get("duration_ms"),
        "models_used": sorted((result.get("modelUsage") or {}).keys()),
        "total_cost_usd": result.get("total_cost_usd"),
    })
    with open(f"{out}/result.json", "w", encoding="utf-8") as f:
        json.dump({"result": result.get("result")}, f, ensure_ascii=False, indent=1)
else:
    meta["is_error"] = True
    meta["subtype"] = "no-result-line"
with open(f"{out}/meta.json", "w", encoding="utf-8") as f:
    json.dump(meta, f, indent=1)
print(json.dumps(meta))
PY
gzip -f "$OUT/transcript.jsonl"
exit "$EXIT"
