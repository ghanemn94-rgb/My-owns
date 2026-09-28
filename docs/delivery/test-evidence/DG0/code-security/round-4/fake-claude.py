#!/usr/bin/env python3
# Stub `claude` CLI for exercising tools/agents/run-agent.sh in a disposable clone (code-security round 4).
# It emits a stream-json transcript like `claude -p --output-format stream-json`, and simulates tool effects:
#   FAKE_MODE=honest    : the agent "Writes" REC with content A (the file really gets A).
#   FAKE_MODE=denied    : the agent's Write of REC is denied by the hook (tool_result is_error), but another writer
#                         (simulated here, e.g. a concurrent orchestrator shell) puts content B there during the window.
#   FAKE_MODE=glob      : the agent Writes a file literally named 'x*' next to REC; an unrelated tracked file 'xy.md'
#                         in the same directory was modified by someone else during the window.
#   FAKE_EXIT=<n>       : process exit status.
import json, os, sys
args = sys.argv[1:]
sid = args[args.index("--session-id") + 1] if "--session-id" in args else args[args.index("--resume") + 1]
role = args[args.index("--agent") + 1]
model = args[args.index("--model") + 1]
prompt = args[-1]
cwd = os.getcwd()
mode = os.environ.get("FAKE_MODE", "honest")
rec = os.environ["FAKE_REC"]  # repo-relative path of the review record
def out(o):
    print(json.dumps(o), flush=True)
out({"type": "system", "subtype": "init", "session_id": sid, "model": model, "tools": ["Read", "Write", "Bash"]})
out({"type": "user", "message": {"role": "user", "content": prompt}, "session_id": sid})
path = os.path.join(cwd, rec)
os.makedirs(os.path.dirname(path), exist_ok=True)
if mode == "honest":
    out({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "t1", "name": "Write", "input": {"file_path": path, "content": "A\n"}}]}, "session_id": sid})
    open(path, "w").write("A\n")
    out({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "t1", "content": "ok"}]}, "session_id": sid})
elif mode == "denied":
    out({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "t1", "name": "Write", "input": {"file_path": path, "content": "A\n"}}]}, "session_id": sid})
    out({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "t1", "is_error": True, "content": "PreToolUse hook denied: blocked"}]}, "session_id": sid})
    open(path, "w").write("B written by someone else\n")
elif mode == "glob":
    d = os.path.dirname(path)
    star = os.path.join(d, "x*")
    out({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": "t1", "name": "Write", "input": {"file_path": star, "content": "star\n"}}]}, "session_id": sid})
    open(star, "w").write("star\n")
    open(os.path.join(d, "xy.md"), "a").write("modified by someone else\n")
out({"type": "result", "subtype": "success", "is_error": False, "session_id": sid, "result": "done", "num_turns": 1})
sys.exit(int(os.environ.get("FAKE_EXIT", "0")))
