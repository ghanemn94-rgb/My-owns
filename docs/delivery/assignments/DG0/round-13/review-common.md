# DG0 review: common context (read together with your role-specific assignment)

- **Stage:** P0 "Discovery and execution setup" / gate DG0. The stage is REVIEWING.
- **Frozen candidate:** `sha256:c3364ac2f1c27b37bdaef6c07196d25b13016e94703449b9ff87524ff18afb79`, source commit `6c61f2e1aa07fa6acfc52f20a8ee9fbb554904ac`. The manifest is `docs/delivery/candidates/DG0/c3364ac2f1c27b37.manifest.json`.
  - Before reviewing, confirm that `git rev-parse HEAD` equals the commit, **or** that `node tools/gates/candidate.mjs --stage DG0` prints the candidate ID. Metadata-only commits may follow the freeze.
  - If the candidate doesn't match, stop and return BLOCKED.
- **Review round:** `13`. Write your record to `docs/delivery/reviews/DG0/round-13/<your-role>.json`.
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
- Put findings in `docs/delivery/reviews/DG0/round-13/<your-role>.findings.json` as `{"findings": [...]}`. Each finding object must conform to `tools/gates/schemas/findings.schema.json`: status `OPEN`, `reported_by` your role, `reported_in` your record path, and `owner` the responsible implementer (`transformation-analyst` or `delivery-orchestrator`). Use your ID block:
  - domain-reviewer: `F-DG0-001`…`099`;
  - code-security-reviewer: `F-DG0-101`…`199`;
  - qa-verifier: `F-DG0-201`…`299`.
  - In later rounds, continue within your block.
- List the same IDs in your review record's `findings` array.
- If you re-verify earlier findings in this round, write `<your-role>.verifications.json` as `{"verifications": [{"finding_id", "result": "PASS|FAIL", "status_after": "CLOSED_VERIFIED|REJECTED_INVALID|OPEN", "note", "evidence": []}]}`.
- Your review record must validate against `tools/gates/schemas/review.schema.json`. Self-check it with:
  `node -e "import('./tools/gates/lib/schema.mjs').then(m=>{const s=require('./tools/gates/schemas/review.schema.json');const r=require('./docs/delivery/reviews/DG0/round-13/<role>.json');const e=m.validate(s,r);console.log(e.length?e:'valid')})"`
- **Verdict:** PASS only if you found no Critical, High or Medium problems in your scope and every check you ran passed. FAIL if you have findings that must be fixed. BLOCKED if you couldn't perform required checks.
- Low cosmetic observations may coexist with PASS only if you record them as findings with `"severity":"Low"` and state in the finding that you'd accept them as an observation.
- Put every check in `checks_run`, with the exact command, environment, expected result, actual result, `exit_status` and result.
- Put the requirement IDs you actually verified in `requirements_checked`.
- **Independence:** form your verdict before reading any other round-13 review record.

## Evidence format (enforced by the validator)
Every entry in `evidence_paths`, in a verification's `evidence`, and in a check's `evidence` must be an **existing regular file inside the repository**, optionally followed by `#fragment`, for example `docs/delivery/requirements.csv#REQ-DLV-002` or `tools/gates/tests/validator.test.mjs#F-DG0-132`. Directories, globs, bare words and parenthetical annotations such as `file (REQ-X)` are rejected. Put annotations in the `#fragment` or in `note`.

## Round 13 specifics (re-review after repairs)

- **The candidate changed after round 12.** Review the new frozen candidate in full, not just the diff. Use `git diff 7f09967ad36dc1a0d2a7065ae93f11bded29ccce..6c61f2e1aa07fa6acfc52f20a8ee9fbb554904ac` to see what changed since the round-12 candidate (`7f09967ad36dc1a0d2a7065ae93f11bded29ccce`).
- **Verify your own earlier findings independently.** Each finding you raised in earlier rounds is listed in `docs/delivery/findings.json` with its `fix_revision` and `fix_summary`.
  - For each one, reproduce the original failure against the old commit if possible, then show whether it's fixed in the new candidate. Run the regression tests, and write your own reproduction where the existing tests are insufficient.
  - Record the result in `docs/delivery/reviews/DG0/round-13/<your-role>.verifications.json`, as `{"verifications": [{"finding_id", "result": "PASS|FAIL", "status_after": "CLOSED_VERIFIED|REJECTED_INVALID|OPEN", "note", "evidence": []}]}`.
  - Use `CLOSED_VERIFIED` only if the fix is complete and correct. If it isn't, keep the finding `OPEN` with result `FAIL`, and explain why.
  - You may only verify findings **you** reported. Findings from other reviewers are verified by their reporters.
- **New findings** continue in your ID block:
  - domain-reviewer: from `F-DG0-012`;
  - code-security-reviewer: from `F-DG0-141`;
  - qa-verifier: from `F-DG0-233`.
  - Every new finding must have `stage_id` `DG0`. The validator rejects relabelled, dropped or altered findings.
- **Rule changes since round 1.** The validator now binds each review to its run: complete, hash-consistent run evidence, the exact assignment file and SHA-256 you were given, and a start after the freeze. Don't edit your assignment file. Your `invocation_reference` is the one in your prompt.
- **Infrastructure note.** If your shell is refused because the permission classifier returned no verdict, wait and retry. The runner now resumes your session automatically after such an outage. Record anything you ultimately couldn't run as BLOCKED.
- **Round-13 rules (see `docs/delivery/decisions.md` D-016 to D-026, and `docs/delivery/threat-model.md`).**
  - **Main change since round 12: D-026, the orchestrator never executes agent-writable code, or imports from agent-writable paths, outside a sandbox.**
    - The runner's Python helpers run as `python3 -I -B` from `/` (F-DG0-140).
    - `tools/gates/sandbox-run.sh` runs a command in a fresh clone of a committed revision under bubblewrap: read-only root, private `/tmp`, no network, clean environment.
    - `tools/gates/prefreeze.sh` runs every check that executes candidate code through it (F-DG0-229).
    - The validator requires the sandbox deny list to name the run's own working directory (F-DG0-230).
    - The docs now say `$TMPDIR`, not `/tmp` (F-DG0-231).
    - The runner's config scan ignores zero-length, untracked, non-symlink files. These are the sandbox's own stubs, and they orphaned the round-12 domain run (`docs/delivery/test-evidence/DG0/round-12-orphaned/`). Judge whether this rule can hide a real configuration change.
    - CI installs bubblewrap. That step hasn't yet been observed on a hosted runner; `docs/delivery/environment.md` says so.
    - The register rows about these controls were updated by the analyst (F-DG0-232, tasks T-DG0-AN-11 and T-DG0-AN-12).
    - Following the AN-11 handback, the runner's stub rule now has tests in both directions (`tools/agents/tests/runner.test.mjs`).
    - The pre-freeze now also checks that the register and coverage matrix equal the merge of `docs/analysis/parts/`.
  - **Your own shell runs in the D-025 OS sandbox.**
    - Bash writes are refused outside `docs/delivery/test-evidence/**`, plus `tests/qa/**` and `e2e/**` for qa-verifier, `$TMPDIR` and your working directory's new files. Protected paths are always refused.
    - `/tmp` itself is read-only, and the shell has **no network**.
    - Make disposable copies with `git clone <repo> "$TMPDIR/<name>"`, not `git worktree add`.
    - Nested bubblewrap works inside your sandbox (the orchestrator checked this), so `tools/gates/sandbox-run.sh`, its tests and `tools/gates/prefreeze.sh` can run in a fresh clone.
  - **Judge findings about the delivery tooling against `docs/delivery/threat-model.md`.** A way to break a *mechanically prevented* control is a finding. Restating a *disclosed residual* is Low unless it shows the residual is larger than stated.
  - **Your earlier closures stand wherever they bind.** A closure binds only if it comes from a run that completed successfully.
    - code-security-reviewer verifies F-DG0-140.
    - qa-verifier verifies F-DG0-229, 230, 231 and 232, **and re-verifies F-DG0-226, 227 and 228**. Your round-12 run ended with exit 1 (`is_error`: the account session limit was reached as it finished). The validator therefore rejects its closures ("did not complete successfully"), and those three findings need a fresh verification entry from this round.
    - domain-reviewer: your round-12 run (PASS) was orphaned by the runner's stub false positive, so this round is a full domain review.
  - **Evidence entries** must be existing repository files, optionally followed by `#fragment`. **Write your record and sidecars only with the Write/Edit tools.**
  - **Run `tools/gates/prefreeze.sh DG0`** in a fresh clone of the candidate commit.
