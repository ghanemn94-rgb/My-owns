# DG0 review: common context (read together with your role-specific assignment)

- **Stage:** P0 "Discovery and execution setup" / gate DG0. The stage is REVIEWING.
- **Frozen candidate:** `sha256:7d00f8574a41648a4e9e9c7af97dc0e251db398a6251f6738a783c6fdcb5f270`, source commit `9e3c27ffe65787f2d510ae5dabf26d271aaae46f`. The manifest is `docs/delivery/candidates/DG0/7d00f8574a41648a.manifest.json`.
  - Before reviewing, confirm that `git rev-parse HEAD` equals the commit, **or** that `node tools/gates/candidate.mjs --stage DG0` prints the candidate ID. Metadata-only commits may follow the freeze.
  - If the candidate doesn't match, stop and return BLOCKED.
- **Review round:** `21`. Write your record to `docs/delivery/reviews/DG0/round-21/<your-role>.json`.
- **Implementation authors of the reviewed scope:** `transformation-analyst` (analysis, register, coverage, glossary, field inventory, journeys, permissions, acceptance map, stage plan) and `delivery-orchestrator` (agent definitions, runner, write guard, gate tooling and schemas, CI workflow, source extraction scripts, delivery records). Put both in `implementation_author`. Neither is you.

## DG0 approval conditions (master prompt §21, row P0)
> **Outputs:** full source extraction, field/template inventory, glossary, requirement IDs, user journeys, stage plan, agent definitions, gate schema/validator and assumptions.
> **Evidence required before approval:** all source items accounted for; the ten definitions validated and the required stage agents actually invoked; the review protocol and gate validator reject missing/invalid evidence; no invented source requirements.

Early-stage rule (§0.2): check the actual specifications, contracts, agent setup and feasibility. Don't claim that future runtime features have already passed tests. The product requirements (all areas other than DLV) are only required to be completely and correctly **SPECIFIED** at DG0.

## What's in the candidate (a map, not a claim of correctness)

**Sources**
- `docs/source/`: the playbook docx, `playbook.md` and `playbook.blocks.json` (B0001–B0165), the master prompt with its anchored blocks (M0001–M0423), and the extraction scripts in `tools/source/`.

**Analysis**
- `docs/analysis/`: `source-coverage.csv` and `master-prompt-coverage.csv`; `glossary.md`, `field-inventory.md`, `permissions-matrix.md`, `user-journeys.md`; `acceptance-map.md`, `stage-plan.md`; `parts/` (analyst part files merged into the register); plus `docs/delivery/requirements.csv` (the register) and `docs/delivery/requirements-spec.md` (its rules).

**Agents and tooling**
- `.claude/agents/*.md` (ten definitions); `tools/agents/` (runner, write guard and scopes, per-role settings, process sandbox `agent_sandbox.py`, `landlock_exec.py`, guard tests); `docs/delivery/agents.md`.
- `tools/gates/`: validator, candidate hashing, schemas, findings import, self-tests; `.github/workflows/delivery-gates.yml`.

**Delivery records**
- `docs/delivery/{environment,decisions,agent-protocol,threat-model}.md` and `CLAUDE.md`.

**Excluded from the candidate by design (delivery metadata, decision D-005)**
- `docs/delivery/{reviews,gates,test-evidence,runs,candidates,handbacks,assignments}/**`, `findings.json`, `progress.md`, `stages.json`. You may still inspect them as evidence; `docs/delivery/runs/DG0/*/meta.json` and `transcript.jsonl.gz` are the invocation evidence.

## Findings and output format
- Put findings in `docs/delivery/reviews/DG0/round-21/<your-role>.findings.json` as `{"findings": [...]}`. Each finding object must conform to `tools/gates/schemas/findings.schema.json`: status `OPEN`, `reported_by` your role, `reported_in` your record path, and `owner` the responsible implementer (`transformation-analyst` or `delivery-orchestrator`). Your ID block:
  - domain-reviewer: continue from `F-DG0-013`;
  - code-security-reviewer: continue from `F-DG0-158`;
  - qa-verifier: continue from `F-DG0-245`.
- List the same IDs in your review record's `findings` array.
- If you re-verify earlier findings in this round, write `<your-role>.verifications.json` as `{"verifications": [{"finding_id", "result": "PASS|FAIL", "status_after": "CLOSED_VERIFIED|REJECTED_INVALID|ACCEPTED_OBSERVATION|OPEN", "note", "evidence": []}]}`. You may only verify findings **you** reported.
- Your review record must validate against `tools/gates/schemas/review.schema.json`. Self-check it with:
  `node -e "import('./tools/gates/lib/schema.mjs').then(m=>{const s=require('./tools/gates/schemas/review.schema.json');const r=require('./docs/delivery/reviews/DG0/round-21/<role>.json');const e=m.validate(s,r);console.log(e.length?e:'valid')})"`
- **Verdict:** PASS only if you found no Critical, High or Medium problems in your scope and every check you ran passed. FAIL if you have findings that must be fixed. BLOCKED if you couldn't perform required checks.
- Low cosmetic observations may coexist with PASS only if you record them as findings with `"severity":"Low"` and state in the finding that you'd accept them as an observation.
- Put every check in `checks_run`, with the exact command, environment, expected result, actual result, `exit_status` and result.
- Put the requirement IDs you actually verified in `requirements_checked`.
- **Independence:** form your verdict before reading any other round-21 review record.

## Evidence format (enforced by the validator)
Every entry in `evidence_paths`, in a verification's `evidence`, and in a check's `evidence` must be an **existing regular file inside the repository**, optionally followed by `#fragment`, for example `docs/delivery/requirements.csv#REQ-DLV-002` or `tools/gates/tests/validator.test.mjs#F-DG0-242`. Directories, globs, bare words and parenthetical annotations such as `file (REQ-X)` are rejected. Put annotations in the `#fragment` or in `note`.

## Round 21 specifics (re-review after the round-20 D-037 repairs — this is the GATE round)

- **The candidate changed after round 20.** Review the new frozen candidate in full. `git diff a23c4d411cd4185e56a3f12cf7c1973f7964440b..9e3c27ffe65787f2d510ae5dabf26d271aaae46f` shows everything that changed since the round-20 candidate baseline; it is the D-037 repairs below. Note: the candidate content changed only in `tools/gates/lib/rules.mjs`, `tools/gates/tests/validator.test.mjs`, `docs/delivery/decisions.md`, `docs/delivery/threat-model.md` and `tools/agents/agent_sandbox.py` (a comment). The reviewer test evidence and `findings.json` are metadata, excluded from the candidate.
- **Verify your own earlier findings independently.** Each finding you raised is in `docs/delivery/findings.json` with its `fix_revision`/`fix_summary`. Reproduce the original problem where possible, then show whether it is fixed. Record each in your `<your-role>.verifications.json`. Use `CLOSED_VERIFIED` only if the fix is complete.
- **New findings** continue in your ID block (domain `F-DG0-013`; code-security `F-DG0-158`; qa `F-DG0-245`). Every finding has `stage_id` `DG0`.
- **The validator binds each review to its run.** Don't edit your assignment file. Your `invocation_reference` is in your prompt. If the classifier returns no verdict, wait and retry; the runner resumes automatically. Record anything you couldn't run as BLOCKED.
- **Round-20 → round-21 changes are all in decision D-037** (read `docs/delivery/decisions.md` D-016 to D-037 and `docs/delivery/threat-model.md`):
  - **D-037 / F-DG0-242 (High, qa): complete the pruned-commit tolerance.** `checkClosure` and `checkInvocation` (`tools/gates/lib/rules.mjs`) now tolerate a **genuinely absent** commit (new `commitPresent()` helper, `git cat-file -e <sha>^{commit}`) — a `fix_revision`, round `source_commit` or run `head_commit_at_start` pruned by the pre-round-12 truncation or the D-034 rewrite — while still running the check whenever the commit **is** present. This is the same principle D-035 applied to `findManifest`. **Verify:** run the real-repo dry-run gate `node docs/delivery/test-evidence/DG0/qa/tests/real-repo-gate-blockers.mjs <a fresh clone of HEAD>` and confirm 0 PRUNED / 0 RECORD-LESS / 0 DROPPED errors and that only "round not finished" artifacts remain; check the unit tests "D-037 / F-DG0-242 …" in `validator.test.mjs` (present-but-not-in-candidate still caught; pruned tolerated; short/non-hex rejected). Confirm a **present** fix that is not in the candidate is still caught (the tolerance is not a blanket skip).
  - **D-037 / F-DG0-243 (High, qa): record-less interrupted-run sidecars match import-findings.** `collectVerifications` skips a verifications sidecar whose `<role>.json` record does not exist (import-findings never imports such verifications); `collectRaisedFindings` still processes a record-less **findings** sidecar (so an imported-and-closed finding like F-DG0-239, raised in the interrupted round-18 qa run, is not falsely "un-raised"), but a finding raised **only** by a record-less sidecar and absent from `findings.json` (F-DG0-238, a duplicate of CLOSED_VERIFIED F-DG0-150) is not a "dropped" finding. A sidecar whose record file **exists** but is unlisted is still an error. **Verify:** the same dry-run (F-DG0-238/239 clear); the unit test "D-037 / F-DG0-243 …".
  - **D-037 / F-DG0-241 (Low, qa): gate `source_commit` must be a branch-reachable commit object.** `checkCandidate` now requires the object type to be `commit` (`git cat-file -t`, new `objectType()` helper) **and** an ancestor of HEAD (`isAncestor`), rejecting an off-branch commit (QA20-S7) and an annotated tag that peels to the frozen commit (QA20-S8). **Verify:** the unit test "D-037 / F-DG0-241 …" and that the retained D-036 missing-commit test still passes.
  - **D-037 / F-DG0-244 (Medium, qa): delivery metadata.** The round-19 (and round-20) reviewer test evidence is now committed, so the verification evidence of F-DG0-152/236/237/239 exists in clones; every CLOSED_VERIFIED finding carries a **full** 40-hex `fix_revision`; F-DG0-150/151 were re-pointed from the off-branch pre-D-034 commit `cb76260…` to the retained, byte-identical `421c922…` (an ancestor of HEAD). **Verify:** `git ls-files docs/delivery/test-evidence/DG0/*/round-19 | wc -l` is non-zero; every `fix_revision` in `findings.json` matches `^[0-9a-f]{40}$`; F-DG0-150/151's `fix_revision` (`421c922…`) is an ancestor of HEAD and its `agent_sandbox.py` is byte-identical to the pre-rewrite commit.
  - **D-037 / F-DG0-157 (Low, code-security): leftover wording.** The `agent_sandbox.py` comment and threat-model residual 7 now state the host-global `/proc/sys` framing with no cross-run amplification distinct from the own-process write. **code-security: verify** the wording is accurate and consistent with residual 8 and D-033.
  - **Already CLOSED_VERIFIED (do not re-verify):** F-DG0-145 (High), 146, 148, 150, 151, 152 (High), 153, 154, 155, 156, 236, 237, 239, 240. F-DG0-147 and F-DG0-149 are accepted observations (residual 7 at its host-global scope) awaiting the auditor's concurrence in the gate.
  - The process sandbox (D-030 to D-033) is unchanged: read-only root, host-bind rw procfs, shared host PID namespace, private IPC namespace, only `CAP_SETFCAP`, `no_new_privs`, per-run Landlock domain.
  - **Your shell** has no network; make disposable copies with `git clone <repo> "$TMPDIR/<name>"`. Nested bubblewrap works, so `tools/gates/sandbox-run.sh`, the process-sandbox tests and `tools/gates/prefreeze.sh` run in a fresh clone.
  - **Judge findings about the delivery tooling against `docs/delivery/threat-model.md`.** A way to break a *mechanically prevented* control is a finding. Restating a *disclosed residual* is Low unless it shows the residual is larger than stated.
  - **Evidence entries** must be existing repository files, optionally with `#fragment`. **Write your record and sidecars only with the Write/Edit tools.**
  - **Run `tools/gates/prefreeze.sh DG0`** in a fresh clone of the candidate commit.
