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

# The prompt is sent as a stream-json user message and replayed by the CLI into the transcript (isReplay: true),
# so the transcript itself records what this run was asked to do (D-022).
user_message() {
  python3 -c 'import json,sys; print(json.dumps({"type": "user", "message": {"role": "user", "content": sys.argv[1]}}))' "$1"
}

ATTEMPTS=0
set +e
( cd "$CWD" && user_message "$PROMPT" | claude -p --agent "$ROLE" --model "$MODEL" --permission-mode auto \
    --session-id "$SESSION_ID" --settings "$SETTINGS" \
    --input-format stream-json --replay-user-messages \
    --output-format stream-json --verbose ) > "$OUT/transcript.jsonl" 2> "$OUT/stderr.log"
EXIT=$?
while [[ $ATTEMPTS -lt $MAX_RESUMES ]] && classifier_outage "$OUT/transcript.jsonl"; do
  ATTEMPTS=$((ATTEMPTS + 1))
  echo "classifier outage detected; resuming session $SESSION_ID (attempt $ATTEMPTS) after ${RESUME_PAUSE}s" >> "$OUT/stderr.log"
  sleep "$RESUME_PAUSE"
  ( cd "$CWD" && user_message "$RESUME_PROMPT" | claude -p --agent "$ROLE" --model "$MODEL" --permission-mode auto \
      --resume "$SESSION_ID" --settings "$SETTINGS" \
      --input-format stream-json --replay-user-messages \
      --output-format stream-json --verbose ) >> "$OUT/transcript.jsonl" 2>> "$OUT/stderr.log"
  EXIT=$?
done
set -e
FINISHED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
snapshot > "$OUT/.post-snapshot.json"
gzip -n "$OUT/transcript.jsonl"

python3 "$REPO_ROOT/tools/agents/run_meta.py" "$OUT" "$RUN_ID" "$ROLE" "$STAGE" "$TASK" "$SESSION_ID" "$MODEL" "$CWD" "$HEAD_COMMIT" "$ASSIGN_REL" "$ASSIGN_SHA" "$STARTED" "$FINISHED" "$EXIT" "$ATTEMPTS" "$REPO_ROOT"

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
