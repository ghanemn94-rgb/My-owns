# qa-verifier DG0 round 8: docs/delivery/agents.md claims vs raw T-DG0-LOAD evidence and the current runner/validator.
# Usage: python3 agents-md-vs-evidence.py <repo>
import sys, json, gzip, glob, re, os
repo = sys.argv[1]; err = 0
def ck(ok, msg):
    global err
    print(("ok   " if ok else "FAIL ") + msg); err += (not ok)
doc = open(f"{repo}/docs/delivery/agents.md").read()
sh = open(f"{repo}/tools/agents/run-agent.sh").read()
rules = open(f"{repo}/tools/gates/lib/rules.mjs").read()
rows = []
for d in sorted(glob.glob(f"{repo}/docs/delivery/runs/DG0/DG0-T-DG0-LOAD-*")):
    m = json.load(open(f"{d}/meta.json"))
    L = [json.loads(l) for l in gzip.open(f"{d}/transcript.jsonl.gz", "rt") if l.strip()]
    init = next(o for o in L if o.get("type") == "system" and o.get("subtype") == "init")
    rows.append((m["role"], m["invocation_reference"]["session_id"], init["model"], m.get("model_requested"), m.get("exit_code")))
    ck(init["session_id"] == m["invocation_reference"]["session_id"] and init["model"] == m.get("model_requested") and m.get("exit_code") == 0,
       f"{m['role']:26} {init['session_id']} {init['model']} req={m.get('model_requested')} exit {m.get('exit_code')}")
    ck(m["role"] in doc and m["invocation_reference"]["session_id"][:8] in doc, f"   agents.md lists {m['role']} with session {m['invocation_reference']['session_id'][:8]}")
ck(len(rows) == 10 and len({r[0] for r in rows}) == 10 and len({r[1] for r in rows}) == 10, f"10 LOAD runs, 10 roles, 10 sessions ({len(rows)})")
block = re.search(r"## Invocation mechanism.*?```\n(.*?)```", doc, re.S).group(1)
for flag in ["--input-format stream-json", "--replay-user-messages", "--output-format stream-json", "--verbose", "--permission-mode auto", "--session-id", "--settings", "--agent", "--model"]:
    ck(flag in block and flag in sh, f"command block and runner both carry {flag}")
ck(not re.search(r'--verbose\s+"', block), "command block no longer passes the prompt positionally")
ck("user_message" in block and "user_message" in sh, "command block shows the piped stream-json user message (runner user_message)")
ck("isReplay: true" in doc and "isReplay === true" in rules, "binding list: CLI-replayed prompt (doc) == validator check")
ck("F-DG0-133" in doc and "the replayed prompt names assignment" in rules, "binding list: assignment in prompt == meta (doc) == validator check")
ck("empty transcript fails" in doc and 'bad("transcript is empty")' in rules, "binding list: unconditional transcript checks (doc) == validator")
ck("The runner snapshots the tree" in doc and "the runner auto-commits" in doc, "runner (not validator) is the subject of snapshot/auto-commit sentences")
ck("exit 70" in doc and re.search(r"exit 70", sh) is not None, "exit 70 on failed auto-commit is in runner and doc")
mr = re.search(r'MAX_RESUMES="\$\{MTH_MAX_RESUMES:-(\d+)\}"', sh)
ck(mr and f"up to {mr.group(1)} times" in doc, "resume count in doc equals runner default")
print("errors", err); sys.exit(1 if err else 0)
