#!/usr/bin/env python3
# Stub `claude` CLI for exercising tools/agents/run-agent.sh in a disposable clone (code-security round 7; fake-claude-r6.py adapted to
# --input-format stream-json --replay-user-messages: the prompt is read from stdin and echoed with isReplay:true, as the real CLI does, D-022).
# Emits a stream-json transcript like `claude -p --output-format stream-json --verbose` and simulates tool effects.
#   FAKE_MODE=honest    : Write REC = "A\n" (success)                                       -> REC tool_authored
#   FAKE_MODE=denied    : Write REC denied (is_error); another writer puts B there           -> NOT tool_authored
#   FAKE_MODE=glob      : Write '<dir>/x*'; unrelated tracked '<dir>/xy.md' modified by someone else -> xy.md NOT committed
#   FAKE_MODE=edit      : Write REC "A\nfoo\n", then Edit foo->bar (success)                 -> tool_authored "A\nbar\n"
#   FAKE_MODE=shelledit : Write REC "A\n", then a Bash call appends "C\n"                    -> NOT tool_authored
#   FAKE_MODE=space     : Write '<dir>/with space.json'                                      -> committed literally
#   FAKE_MODE=editonly  : Edit a pre-existing tracked file (no Write in this run)            -> NOT tool_authored
#   FAKE_MODE=strmsg    : round-5 crash input: events whose "message" is a plain string, plus honest Write -> meta built, REC tool_authored
#   FAKE_MODE=outage    : 1st call ends with an is_error result "no safety verdict"; the --resume call Writes REC -> resumes=1, same session
#   FAKE_MODE=multiedit : Write "A\nfoo\nbaz\n" then MultiEdit foo->bar, baz->qux                -> tool_authored "A\nbar\nqux\n"
#   FAKE_MODE=symlink   : Write through an in-tree symlink dir pointing at the round dir            -> recorded under the real path
#   FAKE_EXIT=<n>       : process exit status.
import json, os, sys
args = sys.argv[1:]
sid = args[args.index("--session-id") + 1] if "--session-id" in args else args[args.index("--resume") + 1]
model = args[args.index("--model") + 1]
if "--input-format" in args and args[args.index("--input-format") + 1] == "stream-json":
    first = sys.stdin.readline()
    msg = json.loads(first)["message"]
    prompt = msg["content"]
else:
    prompt = args[-1]
cwd = os.getcwd()
mode = os.environ.get("FAKE_MODE", "honest")
rec = os.environ["FAKE_REC"]
def out(o): print(json.dumps(o), flush=True)
n = [0]
def tool(name, inp, effect=None, error=None):
    n[0] += 1; tid = f"t{n[0]}"
    out({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": tid, "name": name, "input": inp}]}, "session_id": sid})
    if effect: effect()
    r = {"type": "tool_result", "tool_use_id": tid, "content": error or "ok"}
    if error: r["is_error"] = True
    out({"type": "user", "message": {"content": [r]}, "session_id": sid})
out({"type": "system", "subtype": "init", "session_id": sid, "model": model, "tools": ["Read", "Write", "Edit", "Bash"]})
replayed = {"type": "user", "message": {"role": "user", "content": prompt}, "session_id": sid}
if "--replay-user-messages" in args: replayed["isReplay"] = True
out(replayed)
path = os.path.join(cwd, rec); d = os.path.dirname(path)
os.makedirs(d, exist_ok=True)
def w(p, s, a="w"):
    return lambda: open(p, a).write(s)
if mode == "honest":
    tool("Write", {"file_path": path, "content": "A\n"}, w(path, "A\n"))
elif mode == "denied":
    tool("Write", {"file_path": path, "content": "A\n"}, None, "PreToolUse hook denied: blocked")
    open(path, "w").write("B written by someone else\n")
elif mode == "glob":
    star = os.path.join(d, "x*")
    tool("Write", {"file_path": star, "content": "star\n"}, w(star, "star\n"))
    open(os.path.join(d, "xy.md"), "a").write("modified by someone else\n")
elif mode == "edit":
    tool("Write", {"file_path": path, "content": "A\nfoo\n"}, w(path, "A\nfoo\n"))
    tool("Edit", {"file_path": path, "old_string": "foo", "new_string": "bar"}, w(path, "A\nbar\n"))
elif mode == "shelledit":
    tool("Write", {"file_path": path, "content": "A\n"}, w(path, "A\n"))
    tool("Bash", {"command": f"echo C >> {path}"}, w(path, "C\n", "a"))
elif mode == "space":
    sp = os.path.join(d, "with space.json")
    tool("Write", {"file_path": sp, "content": "{}\n"}, w(sp, "{}\n"))
elif mode == "editonly":
    tr = os.path.join(d, "xy.md")
    old = open(tr).read()
    tool("Edit", {"file_path": tr, "old_string": "seed", "new_string": "SEED"}, w(tr, old.replace("seed", "SEED", 1)))
elif mode == "strmsg":
    out({"type": "user", "message": "plain string message (round-5 crash shape)", "session_id": sid})
    out({"type": "assistant", "message": None, "session_id": sid})
    out({"type": "assistant", "message": {"content": "string content"}, "session_id": sid})
    print("not json at all", flush=True)
    tool("Write", {"file_path": path, "content": "A\n"}, w(path, "A\n"))
elif mode == "outage":
    if "--resume" not in args:
        out({"type": "result", "subtype": "error_during_execution", "is_error": True, "session_id": sid, "result": "Classifier gave no safety verdict"})
        sys.exit(1)
    tool("Write", {"file_path": path, "content": "A\n"}, w(path, "A\n"))
elif mode == "multiedit":
    tool("Write", {"file_path": path, "content": "A\nfoo\nbaz\n"}, w(path, "A\nfoo\nbaz\n"))
    tool("MultiEdit", {"file_path": path, "edits": [{"old_string": "foo", "new_string": "bar"}, {"old_string": "baz", "new_string": "qux"}]}, w(path, "A\nbar\nqux\n"))
elif mode == "symlink":
    ln = os.path.join(cwd, "docs/delivery/test-evidence/lnk")
    os.makedirs(os.path.dirname(ln), exist_ok=True)
    if not os.path.islink(ln): os.symlink(d, ln)
    tool("Write", {"file_path": os.path.join(ln, os.path.basename(path)), "content": "L\n"}, w(os.path.join(ln, os.path.basename(path)), "L\n"))
out({"type": "result", "subtype": "success", "is_error": False, "session_id": sid, "result": "done", "num_turns": 1})
sys.exit(int(os.environ.get("FAKE_EXIT", "0")))
