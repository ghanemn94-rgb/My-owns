# DG0 review: common context (read together with your role-specific assignment)

- **Stage:** P0 "Discovery and execution setup" / gate DG0. The stage is REVIEWING.
- **Frozen candidate:** `sha256:ef3ec3f205ffdac3609c6f100cfb9900afb72f0e5bb381fbc5409eb1a8a8ddaf`, source commit `a23c4d411cd4185e56a3f12cf7c1973f7964440b`. The manifest is `docs/delivery/candidates/DG0/ef3ec3f205ffdac3.manifest.json`.
  - Before reviewing, confirm that `git rev-parse HEAD` equals the commit, **or** that `node tools/gates/candidate.mjs --stage DG0` prints the candidate ID. Metadata-only commits may follow the freeze.
  - If the candidate doesn't match, stop and return BLOCKED.
- **Review round:** `20`. Write your record to `docs/delivery/reviews/DG0/round-20/<your-role>.json`.
- **Implementation authors of the reviewed scope:** `transformation-analyst` (analysis, register, coverage, glossary, field inventory, journeys, permissions, acceptance map, stage plan) and `delivery-orchestrator` (agent definitions, runner, write guard, gate tooling and schemas, CI workflow, source extraction scripts, delivery records). Put both in `implementation_author`. Neither is you.

## DG0 approval conditions (master prompt §21, row P0)
> **Outputs:** full source extraction, field/template inventory, glossary, requirement IDs, user journeys, stage plan, agent definitions, gate schema/validator and assumptions.
> **Evidence required before approval:** all source items accounted for; the ten definitions validated and the required stage agents actually invoked; the review protocol and gate validator reject missing/invalid evidence; no invented source requirements.

Early-stage rule (§0.2): check the actual specifications, contracts, agent setup and feasibility. Don't claim that future runtime features have already passed tests. The product requirements (all areas other than DLV) are only required to be completely and correctly **SPECIFIED** at DG0.

## What's in the candidate (a map, not a claim of correctness)

**Sources**
- `docs/source/`: the playbook docx, `playbook.md` and `playbook.blocks.json` (B0001–B0165), the master prompt with its anchored blocks (M0001–M0423), and the extraction scripts in `tools/source/`.

**Analysis**
- `docs/analysis/`:
  - `source-coverage.csv` and `master-prompt-coverage.csv`;
  - `glossary.md`, `field-inventory.md`, `permissions-matrix.md`, `user-journeys.md`;
  - `acceptance-map.md`, `stage-plan.md`;
  - `parts/`: the analyst part files merged into the register.
- `docs/delivery/requirements.csv` (the register) and `docs/delivery/requirements-spec.md` (its rules).

**Agents and tooling**
- `.claude/agents/*.md` (ten definitions); `tools/agents/` (runner, write guard and scopes, per-role settings, guard tests); `docs/delivery/agents.md` (the invocation mechanism and load-check evidence).
- `tools/gates/`: validator, candidate hashing, schemas, findings import, self-tests. Also `.github/workflows/delivery-gates.yml`.

**Delivery records**
- `docs/delivery/{environment,decisions,agent-protocol}.md` and `CLAUDE.md`.

**Excluded from the candidate by design (delivery metadata, decision D-005)**
- `docs/delivery/{reviews,gates,test-evidence,runs,candidates,handbacks,assignments}/**`, `findings.json`, `progress.md`, `stages.json`. You may still inspect them as evidence; for example, `docs/delivery/runs/DG0/*/meta.json` and `transcript.jsonl.gz` are the invocation evidence.

## Findings and output format
- Put findings in `docs/delivery/reviews/DG0/round-20/<your-role>.findings.json` as `{"findings": [...]}`. Each finding object must conform to `tools/gates/schemas/findings.schema.json`: status `OPEN`, `reported_by` your role, `reported_in` your record path, and `owner` the responsible implementer (`transformation-analyst` or `delivery-orchestrator`). Use your ID block:
  - domain-reviewer: `F-DG0-001`…`099`;
  - code-security-reviewer: `F-DG0-101`…`199`;
  - qa-verifier: `F-DG0-201`…`299`.
  - In later rounds, continue within your block.
- List the same IDs in your review record's `findings` array.
- If you re-verify earlier findings in this round, write `<your-role>.verifications.json` as `{"verifications": [{"finding_id", "result": "PASS|FAIL", "status_after": "CLOSED_VERIFIED|REJECTED_INVALID|OPEN", "note", "evidence": []}]}`.
- Your review record must validate against `tools/gates/schemas/review.schema.json`. Self-check it with:
  `node -e "import('./tools/gates/lib/schema.mjs').then(m=>{const s=require('./tools/gates/schemas/review.schema.json');const r=require('./docs/delivery/reviews/DG0/round-20/<role>.json');const e=m.validate(s,r);console.log(e.length?e:'valid')})"`
- **Verdict:** PASS only if you found no Critical, High or Medium problems in your scope and every check you ran passed. FAIL if you have findings that must be fixed. BLOCKED if you couldn't perform required checks.
- Low cosmetic observations may coexist with PASS only if you record them as findings with `"severity":"Low"` and state in the finding that you'd accept them as an observation.
- Put every check in `checks_run`, with the exact command, environment, expected result, actual result, `exit_status` and result.
- Put the requirement IDs you actually verified in `requirements_checked`.
- **Independence:** form your verdict before reading any other round-20 review record.

## Evidence format (enforced by the validator)
Every entry in `evidence_paths`, in a verification's `evidence`, and in a check's `evidence` must be an **existing regular file inside the repository**, optionally followed by `#fragment`, for example `docs/delivery/requirements.csv#REQ-DLV-002` or `tools/gates/tests/validator.test.mjs#F-DG0-132`. Directories, globs, bare words and parenthetical annotations such as `file (REQ-X)` are rejected. Put annotations in the `#fragment` or in `note`.

## Round 20 specifics (re-review after the round-19 repairs, D-036)

- **The candidate changed after round 19.** Review the new frozen candidate in full. Use `git diff 0a652018bdf4975f83e580796d0775141a3dae9a..a23c4d411cd4185e56a3f12cf7c1973f7964440b` to see everything that changed since the round-19 candidate baseline (`0a652018bdf4975f83e580796d0775141a3dae9a`); it is the D-036 repairs below.
- **Verify your own earlier findings independently.** Each finding you raised is in `docs/delivery/findings.json` with its `fix_revision`/`fix_summary`. Reproduce the original problem where possible, then show whether it is fixed. Record each in `docs/delivery/reviews/DG0/round-20/<your-role>.verifications.json` (`{"verifications":[{"finding_id","result":"PASS|FAIL","status_after":"CLOSED_VERIFIED|REJECTED_INVALID|ACCEPTED_OBSERVATION|OPEN","note","evidence":[]}]}`). Use `CLOSED_VERIFIED` only if the fix is complete. You may only verify findings **you** reported.
- **New findings** continue in your ID block: domain-reviewer from `F-DG0-013`; code-security-reviewer from `F-DG0-157`; qa-verifier from `F-DG0-241`. Every finding has `stage_id` `DG0`.
- **Rule changes since round 1.** The validator binds each review to its run. Don't edit your assignment file. Your `invocation_reference` is in your prompt. If the classifier returns no verdict, wait and retry; the runner resumes automatically. Record anything you couldn't run as BLOCKED.
- **Round-20 rules (read `docs/delivery/decisions.md` D-016 to D-036 and `docs/delivery/threat-model.md`). The changes since round 19 are all in D-036:**
  - **D-036 / F-DG0-240 (Medium, qa) + F-DG0-155 (Low): the gate's `source_commit` must exist, in every mode.** `checkCandidate` (`tools/gates/lib/rules.mjs`) now requires `gate.source_commit` to resolve to a real commit (`git cat-file -e <sha>^{commit}`) in **both** current and historical mode, so current-mode validation no longer accepts an APPROVED gate whose `source_commit` is missing — closing the hole the D-035 `findManifest` tolerance had opened for the gate round. **qa/code-security: verify** by pointing a copy's `gate.source_commit` (and its manifest/stages copies) at a non-existent SHA and confirming `node tools/gates/validate.mjs --stage DG0` now rejects it in current mode; the unit test is `tools/gates/tests/validator.test.mjs` "D-036: a gate whose source_commit does not exist is rejected in current mode too". Confirm the D-035 tolerance still holds for genuinely pruned **non-gate** rounds (rounds 1–12, 18).
  - **D-036 / F-DG0-154 (Medium, code-security) + F-DG0-149: threat-model residual 7 scope corrected.** Residual 7 now states that `/proc/sys` is **host-global** kernel state (a uid-0 DAC-writable tunable a file tool could reach affects the whole host, not just the writing run), and **withdraws** the unverified claim that `/proc/sys` is read-only for the agent's shell. **code-security: verify** the wording is now accurate (uid 0, only `CAP_SETFCAP`, `no_new_privs`; most `/proc/sys` need `CAP_SYS_ADMIN`; the residual is the uid-0 DAC-writable subset, host-global). **Then re-assess F-DG0-149 at this corrected scope:** it is a host availability / kernel-tunable residual, not repository, reviewer-artefact or gate-record integrity (those are read-only binds / private tmpfs), and is inherent to option A (a read-only `/proc/sys` submount breaks the reviewers' nested bwrap). If you accept it, record `{"finding_id":"F-DG0-149","result":"PASS","status_after":"ACCEPTED_OBSERVATION","note":"..."}` (the auditor must concur). If you judge the host-global residual unacceptable under option A, keep it OPEN with `result: FAIL` and say so — that reopens the option-A trade for the user, and the gate stays BLOCKED.
  - **D-036 / F-DG0-156 (Low): the git allow-rules were removed from `.claude/settings.json`** (needed only for the one-time D-034 rewrite); it is back to `Bash(bwrap:*)` only. **code-security: verify** the candidate's `.claude/settings.json` no longer auto-allows `git push`/`filter-branch`/`branch`/`update-ref`.
  - **Already CLOSED_VERIFIED (do not re-verify):** F-DG0-145 (High), 146, 148, 150, 151, 152 (High), 153, 236, 237, 239. F-DG0-147 is an accepted observation. The D-034 write-once history repair was confirmed sound in round 19 (`checkWriteOnce` = 0; round-17 qa sidecars present at their original blobs).
  - The process sandbox (D-030 to D-033) is unchanged: read-only root, host-bind rw procfs, shared host PID namespace, private IPC namespace, only `CAP_SETFCAP`, `no_new_privs`, per-run Landlock domain. `sandbox.json` records `procfs: host-bind`, `unshare: ["ipc"]`, and the `landlock` block.
  - **Your shell** has no network; make disposable copies with `git clone <repo> "$TMPDIR/<name>"`. Nested bubblewrap works, so `tools/gates/sandbox-run.sh`, the process-sandbox tests and `tools/gates/prefreeze.sh` run in a fresh clone.
  - **Judge findings about the delivery tooling against `docs/delivery/threat-model.md`.** A way to break a *mechanically prevented* control is a finding. Restating a *disclosed residual* is Low unless it shows the residual is larger than stated.
  - **Evidence entries** must be existing repository files, optionally with `#fragment`. **Write your record and sidecars only with the Write/Edit tools.**
  - **Run `tools/gates/prefreeze.sh DG0`** in a fresh clone of the candidate commit.
