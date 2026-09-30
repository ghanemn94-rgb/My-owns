# DG0 review: common context (read together with your role-specific assignment)

- **Stage:** P0 "Discovery and execution setup" / gate DG0. The stage is REVIEWING.
- **Frozen candidate:** `sha256:09072ce5f5cb64417bb0c417a10252b4101679dd0332d6b4016296404c6b5600`, source commit `480cd3ff2b1048439bafebf0bf40151a11d84ea7`. The manifest is `docs/delivery/candidates/DG0/09072ce5f5cb6441.manifest.json`.
  - Before reviewing, confirm `git rev-parse HEAD` equals the commit, **or** that `node tools/gates/candidate.mjs --stage DG0` prints the candidate ID. Metadata-only commits may follow the freeze.
  - **This repository must be a COMPLETE clone** (not shallow): `git rev-parse --is-shallow-repository` must print `false`. If it prints `true`, run `git fetch --unshallow` (or re-clone with `fetch-depth: 0`) before validating — the D-038 gate validator refuses a shallow clone (F-DG0-160). If the candidate doesn't match, return BLOCKED.
- **Review round:** `22`. Write your record to `docs/delivery/reviews/DG0/round-22/<your-role>.json`.
- **Implementation authors of the reviewed scope:** `transformation-analyst` and `delivery-orchestrator`. Put both in `implementation_author`. Neither is you.

## DG0 approval conditions (master prompt §21, row P0)
> **Outputs:** full source extraction, field/template inventory, glossary, requirement IDs, user journeys, stage plan, agent definitions, gate schema/validator and assumptions.
> **Evidence required before approval:** all source items accounted for; the ten definitions validated and the required stage agents actually invoked; the review protocol and gate validator reject missing/invalid evidence; no invented source requirements.

Early-stage rule (§0.2): check the actual specifications, contracts, agent setup and feasibility. The product requirements (all areas other than DLV) are only required to be completely and correctly **SPECIFIED** at DG0.

## What's in the candidate (a map, not a claim of correctness)
- **Sources** `docs/source/`: playbook docx, `playbook.md`, `playbook.blocks.json` (B0001–B0165), master prompt + anchored blocks (M0001–M0423), extraction scripts in `tools/source/`.
- **Analysis** `docs/analysis/`: `source-coverage.csv`, `master-prompt-coverage.csv`, `glossary.md`, `field-inventory.md`, `permissions-matrix.md`, `user-journeys.md`, `acceptance-map.md`, `stage-plan.md`, `parts/`; plus `docs/delivery/requirements.csv` and `docs/delivery/requirements-spec.md`.
- **Agents and tooling** `.claude/agents/*.md`; `tools/agents/` (runner, guard, per-role settings, `agent_sandbox.py`, `landlock_exec.py`, tests); `docs/delivery/agents.md`; `tools/gates/` (validator, candidate hashing, schemas, findings import, self-tests); `.github/workflows/delivery-gates.yml`.
- **Delivery records** `docs/delivery/{environment,decisions,agent-protocol,threat-model}.md` and `CLAUDE.md`.
- **Excluded from the candidate (D-005):** `docs/delivery/{reviews,gates,test-evidence,runs,candidates,handbacks,assignments}/**`, `findings.json`, `progress.md`, `stages.json` (inspectable as evidence).

## Findings and output format
- Findings in `docs/delivery/reviews/DG0/round-22/<your-role>.findings.json` as `{"findings":[...]}` conforming to `tools/gates/schemas/findings.schema.json`: status `OPEN`, `reported_by` your role, `reported_in` your record path, `owner` the responsible implementer. ID block: domain continue from `F-DG0-013`; code-security from `F-DG0-164`; qa from `F-DG0-246`.
- Re-verifications in `<your-role>.verifications.json`: `{"verifications":[{"finding_id","result":"PASS|FAIL","status_after":"CLOSED_VERIFIED|REJECTED_INVALID|ACCEPTED_OBSERVATION|OPEN","note","evidence":[]}]}`. You may only verify findings **you** reported.
- Validate your record against `tools/gates/schemas/review.schema.json`.
- **Verdict:** PASS only if no Critical/High/Medium problems and every check passed. FAIL if findings must be fixed. BLOCKED if you couldn't perform required checks. Low observations may coexist with PASS if recorded as `"severity":"Low"` findings.
- Put every check in `checks_run` (exact command, environment, expected, actual, `exit_status`, result). Put the requirement IDs you verified in `requirements_checked`.
- **Independence:** form your verdict before reading any other round-22 review record.

## Evidence format (enforced by the validator)
Every `evidence_paths` / verification `evidence` / check `evidence` entry must be an existing repository file, optionally `#fragment`. Directories, globs and parenthetical annotations are rejected. **Write your record and sidecars only with the Write/Edit tools.**

## Round 22 specifics (re-review after the round-21 D-038 repairs — this is the GATE round)
- **The candidate changed only in the delivery tooling and docs.** `git diff 9e3c27ffe65787f2d510ae5dabf26d271aaae46f..480cd3ff2b1048439bafebf0bf40151a11d84ea7` shows everything since the round-21 candidate baseline: `tools/gates/lib/rules.mjs`, `tools/gates/lib/schema.mjs`, `tools/gates/tests/validator.test.mjs`, `docs/delivery/decisions.md` (D-038), `docs/delivery/threat-model.md`, `tools/agents/agent_sandbox.py`. `findings.json` and test-evidence are metadata, excluded from the candidate.
- **The big correction (read D-038 in `docs/delivery/decisions.md`):** the pre-round-12 "history damage" D-035/D-037 worked around was a **shallow clone**, not truncation. In a complete clone every pre-round-12 commit is a real ancestor of HEAD, so the ancestry checks pass on their own. Confirm this yourself: `git rev-parse --is-shallow-repository` is `false` here; sample a pruned-era fix commit and confirm it is an ancestor of HEAD.
- **Verify your own earlier findings independently** (reproduce, then show fixed). Use `CLOSED_VERIFIED` only if complete.
- **New findings** continue in your ID block. Every finding `stage_id` `DG0`.
- **D-038 changes to verify (all in `tools/gates/lib/rules.mjs` + `schema.mjs`):**
  - **F-DG0-160 (Med):** `validateGate` refuses a shallow repository (`isShallow()`). **Verify:** on a `git clone --depth=1` of HEAD, `node tools/gates/validate.mjs --stage DG0` reports the shallow error; on a complete clone it does not.
  - **F-DG0-245/159 (Med/Low):** the `commitPresent()` tolerance in `checkClosure`/`checkInvocation` is scoped — a well-formed 40-hex value AND a round whose own `source_commit` is absent, never a missing/malformed value, never a retained or gate round. **Verify:** unit tests "D-038 / F-DG0-245" and "D-038 / F-DG0-159"; and that setting a gate-round run's `head_commit_at_start` to `unknown`/missing/all-zeros, or a retained closure's `fix_revision` to all-zeros, is now rejected (round-21 QA21-C3/C4/C5 no longer pass).
  - **F-DG0-158 (Med, mandatory):** the record-less drop exemption is withdrawn — every sidecar-raised finding must be in `findings.json`. F-DG0-238 is imported (OPEN) for qa to close. **Verify:** deleting a finding from `findings.json` whose raising sidecar is record-less is now caught as "dropped".
  - **F-DG0-161 (Med):** F-DG0-150/151 are re-verified this round against the current candidate (code-security), and the `backup/` branch is gone so `450c756` is uniformly absent. **Verify:** the real-repo dry-run (`docs/delivery/test-evidence/DG0/qa/tests/real-repo-gate-blockers.mjs`) reports 0 in the PRUNED/RECORD-LESS/DROPPED buckets.
  - **F-DG0-162 (Low):** threat-model residual 7 and the `agent_sandbox.py` comment now say the agent **shell** writes host-global `/proc/sys` directly, and attribute the reviewer-sandbox read-only `/proc/sys` to `sandbox-run.sh`'s explicit `--ro-bind`. **code-security: verify** the wording is accurate.
  - **F-DG0-163 (Low):** `schema.mjs` uses `Object.hasOwn`, rejecting extra keys named after `Object.prototype` members. **Verify:** unit test "D-038 / F-DG0-163".
  - **Already CLOSED_VERIFIED (do not re-verify unless re-pointed):** F-DG0-145/146/148/152/153/154/155/156/157/236/237/239/240/241/242/243/244. F-DG0-147/149 are accepted observations awaiting the auditor's concurrence.
- **Your shell** has no network; clone with `git clone <repo> "$TMPDIR/<name>"`. Nested bubblewrap works. **Run `tools/gates/prefreeze.sh DG0`** in a fresh clone.
- Judge delivery-tooling findings against `docs/delivery/threat-model.md`: breaking a *mechanically-prevented* control is a finding; restating a *disclosed residual* is Low unless it shows the residual is larger than stated.
