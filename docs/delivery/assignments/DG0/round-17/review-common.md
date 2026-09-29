# DG0 review: common context (read together with your role-specific assignment)

- **Stage:** P0 "Discovery and execution setup" / gate DG0. The stage is REVIEWING.
- **Frozen candidate:** `sha256:34b06b8a8245250ff15d4dc1ad6453a59de4d07950d6d24668b30233b1af314e`, source commit `f84eed411dfb93fbe3a72d3475ee8ff7eae68f94`. The manifest is `docs/delivery/candidates/DG0/34b06b8a8245250f.manifest.json`.
  - Before reviewing, confirm that `git rev-parse HEAD` equals the commit, **or** that `node tools/gates/candidate.mjs --stage DG0` prints the candidate ID. Metadata-only commits may follow the freeze.
  - If the candidate doesn't match, stop and return BLOCKED.
- **Review round:** `17`. Write your record to `docs/delivery/reviews/DG0/round-17/<your-role>.json`.
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
- Put findings in `docs/delivery/reviews/DG0/round-17/<your-role>.findings.json` as `{"findings": [...]}`. Each finding object must conform to `tools/gates/schemas/findings.schema.json`: status `OPEN`, `reported_by` your role, `reported_in` your record path, and `owner` the responsible implementer (`transformation-analyst` or `delivery-orchestrator`). Use your ID block:
  - domain-reviewer: `F-DG0-001`…`099`;
  - code-security-reviewer: `F-DG0-101`…`199`;
  - qa-verifier: `F-DG0-201`…`299`.
  - In later rounds, continue within your block.
- List the same IDs in your review record's `findings` array.
- If you re-verify earlier findings in this round, write `<your-role>.verifications.json` as `{"verifications": [{"finding_id", "result": "PASS|FAIL", "status_after": "CLOSED_VERIFIED|REJECTED_INVALID|OPEN", "note", "evidence": []}]}`.
- Your review record must validate against `tools/gates/schemas/review.schema.json`. Self-check it with:
  `node -e "import('./tools/gates/lib/schema.mjs').then(m=>{const s=require('./tools/gates/schemas/review.schema.json');const r=require('./docs/delivery/reviews/DG0/round-17/<role>.json');const e=m.validate(s,r);console.log(e.length?e:'valid')})"`
- **Verdict:** PASS only if you found no Critical, High or Medium problems in your scope and every check you ran passed. FAIL if you have findings that must be fixed. BLOCKED if you couldn't perform required checks.
- Low cosmetic observations may coexist with PASS only if you record them as findings with `"severity":"Low"` and state in the finding that you'd accept them as an observation.
- Put every check in `checks_run`, with the exact command, environment, expected result, actual result, `exit_status` and result.
- Put the requirement IDs you actually verified in `requirements_checked`.
- **Independence:** form your verdict before reading any other round-17 review record.

## Evidence format (enforced by the validator)
Every entry in `evidence_paths`, in a verification's `evidence`, and in a check's `evidence` must be an **existing regular file inside the repository**, optionally followed by `#fragment`, for example `docs/delivery/requirements.csv#REQ-DLV-002` or `tools/gates/tests/validator.test.mjs#F-DG0-132`. Directories, globs, bare words and parenthetical annotations such as `file (REQ-X)` are rejected. Put annotations in the `#fragment` or in `note`.

## Round 17 specifics (re-review after the round-16 repairs)

- **The candidate changed after round 16.** Review the new frozen candidate in full, not just the diff. Use `git diff 4fd56d4d701ffe02586edaf2c0cc3966e6ff68a0..f84eed411dfb93fbe3a72d3475ee8ff7eae68f94` to see what changed since the round-16 candidate (`4fd56d4d701ffe02586edaf2c0cc3966e6ff68a0`).
- **Verify your own earlier findings independently.** Each finding you raised is in `docs/delivery/findings.json` with its `fix_revision` and `fix_summary`. Reproduce the original failure against the old commit where possible, then show whether it is fixed. Record each in `docs/delivery/reviews/DG0/round-17/<your-role>.verifications.json` as `{"verifications": [{"finding_id", "result": "PASS|FAIL", "status_after": "CLOSED_VERIFIED|REJECTED_INVALID|ACCEPTED_OBSERVATION|OPEN", "note", "evidence": []}]}`. Use `CLOSED_VERIFIED` only if the fix is complete. You may only verify findings **you** reported.
- **New findings** continue in your ID block: domain-reviewer from `F-DG0-013`; code-security-reviewer from `F-DG0-150`; qa-verifier from `F-DG0-238`. Every finding must have `stage_id` `DG0`.
- **Rule changes since round 1.** The validator binds each review to its run. Don't edit your assignment file. Your `invocation_reference` is the one in your prompt. If the classifier returns no verdict, wait and retry; the runner resumes automatically. Record anything you ultimately couldn't run as BLOCKED.
- **Round-17 rules (see `docs/delivery/decisions.md` D-016 to D-031, and `docs/delivery/threat-model.md`).**
  - **Main change since round 16: D-031, repairs to the process sandbox** (`tools/agents/agent_sandbox.py`):
    - `finish()` copy-back is now bound to a **staging seed** captured at `prepare`, not the live real directory, so a record another concurrently running review commits between this run's prepare and finish is never mis-flagged as a discard (the round-16 exit-73 false positive). A file removed from the throwaway staging copy is ignored; the real file is never deleted.
    - the process sandbox now creates its own **IPC namespace** (`--unshare-ipc`, F-DG0-148), closing the SysV-IPC / POSIX-message-queue cross-run vector of threat-model residual 8 at no cost to the reviewers' nested bubblewrap; `sandbox.json` records `unshare: ["ipc"]` and the validator requires it.
  - The D-030 process sandbox around your whole run is otherwise unchanged: read-only root, host-bind procfs, no PID namespace, only `CAP_SETFCAP`, `no_new_privs`; you write only your own areas (shell or file tools); review/gate/register writes are staged and copied back for your own files only.
  - **Your shell** has no network; make disposable copies with `git clone <repo> "$TMPDIR/<name>"`. A reproduction must stay inside your own `$TMPDIR` and evidence directory. Nested bubblewrap works, so `tools/gates/sandbox-run.sh`, the process-sandbox tests and `tools/gates/prefreeze.sh` run in a fresh clone.
  - **Judge findings about the delivery tooling against `docs/delivery/threat-model.md`.** A way to break a *mechanically prevented* control is a finding. Restating a *disclosed residual* is Low unless it shows the residual is larger than stated.
  - **Verify your `FIXED_PENDING_VERIFICATION` findings and act on your round-16 observations:**
    - code-security-reviewer verifies **F-DG0-148** (the `--unshare-ipc` / residual-8 fix), and confirms the **D-031 copy-back concurrency fix** (compare against the staging seed) holds. For your round-16 Low observations **F-DG0-147** (copy-back accept pattern not round-pinned; fail-closed) and **F-DG0-149** (residual 7 confirmed as disclosed): if you still agree each is Low, non-mandatory and within the disclosed residual, record it as `{"result":"PASS","status_after":"ACCEPTED_OBSERVATION","note":"..."}` in your round-17 verifications sidecar (the auditor must concur for acceptance). If you now think either is more than an observation, keep it OPEN with `result: FAIL` and explain.
    - qa-verifier verifies **F-DG0-236** and **F-DG0-237**.
    - domain-reviewer has no finding pending verification.
    - F-DG0-145 (High) and F-DG0-146 are already CLOSED_VERIFIED from round 16 and need no re-verification (their fixes are in this candidate's lineage).
  - **Evidence entries** must be existing repository files, optionally followed by `#fragment`. **Write your record and sidecars only with the Write/Edit tools.**
  - **Run `tools/gates/prefreeze.sh DG0`** in a fresh clone of the candidate commit.
