#!/usr/bin/env python3
"""Build a run's meta.json from its transcript and before/after tree snapshots (called by run-agent.sh).

Records, in docs/delivery/runs/<stage>/<run-id>/meta.json:
  outputs          every file the run window changed (path -> sha256); concurrent runs may overlap
  deleted          files that disappeared during the window
  written_by_tools paths the agent targeted with Write/Edit/MultiEdit/NotebookEdit
  tool_authored    paths whose final bytes equal a replay of the agent's own SUCCESSFUL Write/Edit/MultiEdit
                   calls (decision D-021, finding F-DG0-119); attempted/failed calls and shell edits don't count
  result_sha256 / transcript_sha256   hashes binding result.json and transcript.jsonl.gz to this meta

Usage: run_meta.py OUT RUN_ID ROLE STAGE TASK SESSION_ID MODEL CWD HEAD ASSIGNMENT ASSIGNMENT_SHA256
                   STARTED FINISHED EXIT_CODE RESUMES REPO_ROOT
"""
import gzip
import hashlib
import json
import os
import sys

FILE_TOOLS = ("Write", "Edit", "MultiEdit", "NotebookEdit")


def read_events(transcript_gz):
    """Yield every JSON object in the gzipped stream transcript, skipping unparsable or non-object lines."""
    with gzip.open(transcript_gz, "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                o = json.loads(line)
            except ValueError:
                continue
            if isinstance(o, dict):
                yield o


def message_content(event):
    """The content list of an assistant/user event, or [] (messages can be strings or absent)."""
    msg = event.get("message")
    content = msg.get("content") if isinstance(msg, dict) else None
    return [c for c in content if isinstance(c, dict)] if isinstance(content, list) else []


def rel_path(fp, cwd, repo_root):
    if not isinstance(fp, str) or not fp:
        return None
    ap = os.path.realpath(fp if os.path.isabs(fp) else os.path.join(cwd, fp))
    for base in (repo_root, os.path.realpath(cwd)):
        if ap.startswith(base + os.sep):
            return os.path.relpath(ap, base).replace(os.sep, "/")
    return None


def replay_tool_writes(events, cwd, repo_root):
    """Returns (written_by_tools, replayed) where replayed maps path -> final text, or None if not reconstructible."""
    uses, failed = [], set()
    for o in events:
        for c in message_content(o):
            if o.get("type") == "assistant" and c.get("type") == "tool_use" and c.get("name") in FILE_TOOLS:
                uses.append(c)
            elif o.get("type") == "user" and c.get("type") == "tool_result" and c.get("is_error"):
                failed.add(c.get("tool_use_id"))
    written, state = set(), {}
    for c in uses:
        inp = c.get("input") if isinstance(c.get("input"), dict) else {}
        rp = rel_path(inp.get("file_path") or inp.get("notebook_path"), cwd, repo_root)
        if not rp:
            continue
        written.add(rp)
        if c.get("id") in failed:
            continue
        name = c.get("name")
        if name == "Write":
            content = inp.get("content", "")
            state[rp] = content if isinstance(content, str) else None
        elif name in ("Edit", "MultiEdit") and isinstance(state.get(rp), str):
            edits = [inp] if name == "Edit" else [e for e in (inp.get("edits") or []) if isinstance(e, dict)]
            cur = state[rp]
            for e in edits:
                old, new = e.get("old_string", ""), e.get("new_string", "")
                if not isinstance(old, str) or not isinstance(new, str) or old == "" or old not in cur:
                    cur = None
                    break
                cur = cur.replace(old, new) if e.get("replace_all") else cur.replace(old, new, 1)
            state[rp] = cur
        else:
            state[rp] = None  # cannot be reconstructed from this run's own calls
    return written, state


def build_meta(argv):
    (out, run_id, role, stage, task, sid, model, cwd, head, arel, asha, started, finished, code, resumes,
     repo_root_arg) = argv
    repo_root = os.path.realpath(repo_root_arg)
    transcript = f"{out}/transcript.jsonl.gz"
    events = list(read_events(transcript))
    result = None
    for o in events:
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
            "models_used": sorted((result.get("modelUsage") or {}).keys()) if isinstance(result.get("modelUsage"), dict) else [],
            "total_cost_usd": result.get("total_cost_usd"),
        })
    else:
        meta["is_error"] = True
        meta["subtype"] = "no-result-line"
    with open(f"{out}/.pre-snapshot.json", encoding="utf-8") as f:
        pre = json.load(f)
    with open(f"{out}/.post-snapshot.json", encoding="utf-8") as f:
        post = json.load(f)
    written, replayed = replay_tool_writes(events, cwd, repo_root)
    tool_authored = {}
    for rp, text in replayed.items():
        if isinstance(text, str):
            digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
            if post.get(rp) == digest:
                tool_authored[rp] = digest
    meta["outputs"] = dict(sorted((p, h) for p, h in post.items() if pre.get(p) != h))
    meta["deleted"] = sorted(p for p in pre if p not in post)
    meta["written_by_tools"] = sorted(written)
    meta["tool_authored"] = dict(sorted(tool_authored.items()))
    with open(f"{out}/result.json", "w", encoding="utf-8") as f:
        json.dump({"result": (result or {}).get("result")}, f, ensure_ascii=False, indent=1)
    for name, key in (("result.json", "result_sha256"), ("transcript.jsonl.gz", "transcript_sha256")):
        with open(f"{out}/{name}", "rb") as f:
            meta[key] = hashlib.sha256(f.read()).hexdigest()
    with open(f"{out}/meta.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=1)
    # Snapshots are removed only after meta.json exists, so a failure here leaves them for diagnosis.
    os.remove(f"{out}/.pre-snapshot.json")
    os.remove(f"{out}/.post-snapshot.json")
    return meta


def main():
    meta = build_meta(sys.argv[1:])
    keys = ("run_id", "role", "exit_code", "is_error", "subtype", "num_turns", "classifier_outage_resumes")
    print(json.dumps({k: meta[k] for k in keys if k in meta}))


if __name__ == "__main__":
    main()
