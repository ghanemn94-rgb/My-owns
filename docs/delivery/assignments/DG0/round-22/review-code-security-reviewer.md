# DG0 assignment: code-security-reviewer (round 22)

Read `docs/delivery/assignments/DG0/round-22/review-common.md` first. Task ID: `T-DG0-REV-SEC-R22`.

## Your scope: correctness and security of the delivery-control code and configuration

Directly review the source (full files) of `tools/gates/**`, `tools/agents/**`, `tools/source/**`, `.github/workflows/delivery-gates.yml`, `.claude/agents/*.md`.

Look for:
1. **Gate bypasses.** Ways to make `validate.mjs` pass a gate that should fail: schema gaps, glob semantics, exclusions hiding deliverables, `candidate_spec` manipulation, historical mode trusting forged data, provenance satisfiable with fabricated runs, findings escaping the terminal-state rule, register dodges, pipeline loopholes, exit codes.
2. **The D-038 changes (this round's delta) — verify they hold and did not over-correct.** Read `git diff 9e3c27ffe65787f2d510ae5dabf26d271aaae46f..480cd3ff2b1048439bafebf0bf40151a11d84ea7 -- tools/gates/lib/rules.mjs tools/gates/lib/schema.mjs`:
   - **Shallow refusal** (`isShallow`, F-DG0-160): `validateGate` errors on a shallow clone. Confirm on a `git clone --depth=1` of HEAD, and that a complete clone is accepted. Confirm the premise: `git rev-parse --is-shallow-repository` is `false` here and the pruned-era commits are real ancestors of HEAD.
   - **Scoped commit tolerance** (`checkInvocation`/`checkClosure`, F-DG0-245/159): tolerance requires a well-formed 40-hex value AND `binding.roundSourceCommit` absent (a genuinely-superseded round), never the gate round. Try to defeat it: a missing/`unknown`/`HEAD`/non-hex `head_commit_at_start`, or an all-zero/typo'd `fix_revision` on a retained or gate-round closure, must all be rejected. A **present** fix not in the candidate is still caught. Confirm the round-21 fail-open (QA21-C3/C4/C5) is closed.
   - **Record-less finding integrity** (`collectRaisedFindings`/`checkFindings`, F-DG0-158): confirm a finding deleted from `findings.json` whose raising sidecar is record-less is now reported "dropped"; that a record-less **verifications** sidecar still cannot close anything; and that F-DG0-238 is imported rather than exempted.
   - **schema.mjs** (F-DG0-163): `additionalProperties:false` rejects `constructor`/`toString`/`__proto__`/`hasOwnProperty` keys (`Object.hasOwn`).
   Reproduce in a disposable clone; save scripts/outputs under `docs/delivery/test-evidence/DG0/code-security/round-22/`.
3. **Write-guard bypasses**; **runner/process sandbox (D-030–D-033)** — assess residuals 7 (now: the agent **shell** writes host-global `/proc/sys` directly, F-DG0-162) and 8; **CSV/JSON robustness**; **CI least privilege**; **secrets** (`.claude/settings.json` auto-allows only `Bash(bwrap:*)`); **candidate hash determinism**.

Run `node --test tools/gates/tests/*.test.mjs tools/agents/tests/*.test.mjs` and write your own reproduction attempts. Every finding needs file:line, a concrete failure scenario, severity and `mandatory_violation`.

## Re-verify F-DG0-150/151 (F-DG0-161)
You reported F-DG0-150/151 (the `finish()` write-once-collision crash). Re-verify them against **this** candidate: their fix (`421c922`, byte-identical `agent_sandbox.py finish()`) is an ancestor of HEAD, and their closure no longer depends on the orphaned round-18 commit. Record `{"finding_id":"F-DG0-150","result":"PASS","status_after":"CLOSED_VERIFIED","note":"...","evidence":[...]}` (and F-DG0-151) in your `code-security-reviewer.verifications.json` if the fix holds.

## Requirements to check (record exactly these in `requirements_checked`)
Gate round — check **all 19** DG0-final requirements against the code/config that implements them, each completely and correctly IMPLEMENTED with existing evidence:
`REQ-DLV-001,002,003,004,006,007,013,015,016,017,019,020,022,023,026,029,032`, `REQ-S20-024`, `REQ-S20-025`. List every one you checked.
