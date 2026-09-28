# Round 7: copied from round 6; REQ-DLV-023 prefreeze marker re-targeted to the candidate-ID comparison (round-6 repair); D-022/replay markers added for REQ-DLV-006/013/026 (qa-verifier, T-DG0-REV-QA-R7).
# Round 6: copied from round 5; REQ-DLV-013/023/026 markers re-targeted to tools/agents/run_meta.py, test_run_meta.py and prefreeze.sh (the replay moved out of run-agent.sh) and re-run on candidate a059b55 (qa-verifier, T-DG0-REV-QA-R6).
# qa-verifier DG0 round 5 (copied from round 4; DLV-026 marker extended to tool_authored): for each DG0 row, open its evidence and check that concrete implementation markers exist.
# Usage: python3 dg0-evidence-content.py <repo>
import csv, os, re, sys
repo = sys.argv[1]
M = {  # req -> list of (file, regex) that must match
 "REQ-DLV-001": [("docs/delivery/decisions.md", r"D-002.*English edition v2\.0"), ("docs/source/master-prompt.anchored.md", r"M0423")],
 "REQ-DLV-002": [("CLAUDE.md", r"G6 never implies DG7"), ("docs/delivery/agent-protocol.md", r"never grant a real business"), ("tools/gates/schemas/gate.schema.json", r"DG\[0-7\]|DG0")],
 "REQ-DLV-003": [("docs/delivery/environment.md", r"(?i)node"), ("docs/delivery/environment.md", r"(?i)limitation|not available|blocked")],
 "REQ-DLV-004": [(".claude/agents/qa-verifier.md", r"^name: qa-verifier"), (".claude/agents/release-auditor.md", r"^model: inherit"), ("docs/delivery/agents.md", r"run-agent\.sh")],
 "REQ-DLV-006": [("tools/agents/run-agent.sh", r"claude -p --agent \"\$ROLE\" --model \"\$MODEL\""), ("tools/agents/run-agent.sh", r"--session-id"), ("tools/agents/run-agent.sh", r"--input-format stream-json --replay-user-messages")],
 "REQ-DLV-007": [("tools/agents/guard-write.mjs", r"protected path"), ("tools/agents/write-scopes.json", r"tests/qa/\*\*"), ("tools/agents/settings/qa-verifier.settings.json", r"guard-write\.mjs")],
 "REQ-DLV-013": [("tools/gates/lib/rules.mjs", r"export function checkInvocation"), ("tools/gates/lib/rules.mjs", r"differs from what the run wrote"), ("tools/gates/schemas/review.schema.json", r"invocation_reference"), ("tools/agents/run_meta.py", r"def replay_tool_writes"), ("tools/gates/lib/rules.mjs", r"o\.isReplay === true")],
 "REQ-DLV-015": [("tools/gates/lib/rules.mjs", r"illegal transition"), ("tools/gates/schemas/stages.schema.json", r"VERIFYING")],
 "REQ-DLV-016": [("tools/gates/lib/rules.mjs", r"missing \$\{role\} review"), ("tools/gates/lib/rules.mjs", r"is \$\{t\.result\}"), ("tools/gates/validate.mjs", r"process\.exit\(1\)")],
 "REQ-DLV-017": [("tools/gates/schemas/findings.schema.json", r"mandatory_violation"), ("tools/gates/import-findings.mjs", r"verifications"), ("tools/gates/tests/validator.test.mjs", r"owners cannot verify their own")],
 "REQ-DLV-019": [("docs/delivery/progress.md", r"(?i)next"), ("docs/delivery/stages.json", r"review_rounds")],
 "REQ-DLV-020": [("tools/gates/lib/rules.mjs", r"does not cite \$\{id\} in source_ref"), ("tools/source/merge_register.py", r"requirements\.csv"), ("docs/delivery/requirements-spec.md", r"(?i)VERIFIED")],
 "REQ-DLV-022": [("tools/gates/lib/candidate.mjs", r"\$\{e\.sha256\}  \$\{e\.mode\}  \$\{e\.path\}"), ("tools/gates/candidate.mjs", r"already exists"), ("docs/delivery/decisions.md", r"mth-candidate-v2")],
 "REQ-DLV-023": [(".github/workflows/delivery-gates.yml", r"validate\.mjs"), (".github/workflows/delivery-gates.yml", r"node --test"), (".github/workflows/delivery-gates.yml", r"unittest discover"), ("tools/gates/prefreeze.sh", r"working-tree candidate equals HEAD")],
 "REQ-DLV-026": [("tools/agents/run-agent.sh", r"transcript\.jsonl"), ("tools/agents/run-agent.sh", r"tools/agents/run_meta\.py"), ("tools/agents/run_meta.py", r"written_by_tools"), ("tools/agents/run_meta.py", r"tool_authored\[rp\] = digest"), ("tools/agents/tests/test_run_meta.py", r"test_string_messages_and_non_object_lines_are_tolerated"), ("tools/gates/lib/rules.mjs", r"does not equal the content of this run.s own Write/Edit calls"), ("tools/gates/lib/rules.mjs", r"transcript_sha256"), ("tools/gates/lib/rules.mjs", r"differs from the replay of this run.s transcript")],
 "REQ-DLV-029": [("docs/delivery/progress.md", r"(?i)candidate"), ("tools/gates/validate.mjs", r"--reconcile")],
 "REQ-DLV-032": [("tools/source/check_extraction.sh", r"sha256"), ("docs/analysis/stage-plan.md", r"(?i)P7"), ("docs/analysis/acceptance-map.md", r"A28")],
 "REQ-S20-024": [("tools/gates/tests/validator.test.mjs", r"A24: a missing specialist reviewer fails the gate"), (".github/workflows/delivery-gates.yml", r"tools/gates/tests")],
 "REQ-S20-025": [("tools/gates/tests/validator.test.mjs", r"A25: a tampered manifest"), ("tools/gates/lib/candidate.mjs", r"META_EXCLUDES")],
}
err = 0
rows = {r["req_id"]: r for r in csv.DictReader(open(os.path.join(repo, "docs/delivery/requirements.csv"), encoding="utf-8"))}
dg0 = [r for r in rows.values() if r["final_gate"] == "DG0"]
for r in dg0:
    ev = [e.strip() for e in r["evidence"].split(";") if e.strip()]
    checks = M.get(r["req_id"])
    if checks is None:
        print("NOCHECK", r["req_id"]); err += 1; continue
    for f, rx in checks:
        inev = f in ev
        p = os.path.join(repo, f)
        ok = os.path.isfile(p) and re.search(rx, open(p, encoding="utf-8", errors="replace").read(), re.M)
        print(("ok  " if ok and inev else "FAIL"), r["req_id"], f, ("" if inev else "(not cited as evidence)"), "/" + rx + "/")
        if not (ok and inev): err += 1
print("DG0 rows:", len(dg0), "errors:", err)
sys.exit(1 if err else 0)
