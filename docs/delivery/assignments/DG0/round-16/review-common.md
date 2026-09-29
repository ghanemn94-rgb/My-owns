# DG0 review: common context (read together with your role-specific assignment)

- **Stage:** P0 "Discovery and execution setup" / gate DG0. The stage is REVIEWING.
- **Frozen candidate:** `sha256:3013023aa21da2f42b3bb279bd094fa0a1879a2bb1c65fd4b1e4e0c050d84db9`, source commit `4fd56d4d701ffe02586edaf2c0cc3966e6ff68a0`. The manifest is `docs/delivery/candidates/DG0/3013023aa21da2f4.manifest.json`.
  - Before reviewing, confirm that `git rev-parse HEAD` equals the commit, **or** that `node tools/gates/candidate.mjs --stage DG0` prints the candidate ID. Metadata-only commits may follow the freeze.
  - If the candidate doesn't match, stop and return BLOCKED.
- **Review round:** `16`. Write your record to `docs/delivery/reviews/DG0/round-16/<your-role>.json`.
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
- Put findings in `docs/delivery/reviews/DG0/round-16/<your-role>.findings.json` as `{"findings": [...]}`. Each finding object must conform to `tools/gates/schemas/findings.schema.json`: status `OPEN`, `reported_by` your role, `reported_in` your record path, and `owner` the responsible implementer (`transformation-analyst` or `delivery-orchestrator`). Use your ID block:
  - domain-reviewer: `F-DG0-001`…`099`;
  - code-security-reviewer: `F-DG0-101`…`199`;
  - qa-verifier: `F-DG0-201`…`299`.
  - In later rounds, continue within your block.
- List the same IDs in your review record's `findings` array.
- If you re-verify earlier findings in this round, write `<your-role>.verifications.json` as `{"verifications": [{"finding_id", "result": "PASS|FAIL", "status_after": "CLOSED_VERIFIED|REJECTED_INVALID|OPEN", "note", "evidence": []}]}`.
- Your review record must validate against `tools/gates/schemas/review.schema.json`. Self-check it with:
  `node -e "import('./tools/gates/lib/schema.mjs').then(m=>{const s=require('./tools/gates/schemas/review.schema.json');const r=require('./docs/delivery/reviews/DG0/round-16/<role>.json');const e=m.validate(s,r);console.log(e.length?e:'valid')})"`
- **Verdict:** PASS only if you found no Critical, High or Medium problems in your scope and every check you ran passed. FAIL if you have findings that must be fixed. BLOCKED if you couldn't perform required checks.
- Low cosmetic observations may coexist with PASS only if you record them as findings with `"severity":"Low"` and state in the finding that you'd accept them as an observation.
- Put every check in `checks_run`, with the exact command, environment, expected result, actual result, `exit_status` and result.
- Put the requirement IDs you actually verified in `requirements_checked`.
- **Independence:** form your verdict before reading any other round-16 review record.

## Evidence format (enforced by the validator)
Every entry in `evidence_paths`, in a verification's `evidence`, and in a check's `evidence` must be an **existing regular file inside the repository**, optionally followed by `#fragment`, for example `docs/delivery/requirements.csv#REQ-DLV-002` or `tools/gates/tests/validator.test.mjs#F-DG0-132`. Directories, globs, bare words and parenthetical annotations such as `file (REQ-X)` are rejected. Put annotations in the `#fragment` or in `note`.

## Round 16 specifics (re-review after repairs)

- **The candidate changed after round 15.** Review the new frozen candidate in full, not just the diff. Use `git diff 7fab49c5c6764721bbe2982aa621a34ea31cfdea..4fd56d4d701ffe02586edaf2c0cc3966e6ff68a0` to see what changed since the round-15 candidate (`7fab49c5c6764721bbe2982aa621a34ea31cfdea`).
- **Verify your own earlier findings independently.** Each finding you raised in earlier rounds is listed in `docs/delivery/findings.json` with its `fix_revision` and `fix_summary`.
  - For each one, reproduce the original failure against the old commit if possible, then show whether it's fixed in the new candidate. Run the regression tests, and write your own reproduction where the existing tests are insufficient.
  - Record the result in `docs/delivery/reviews/DG0/round-16/<your-role>.verifications.json`, as `{"verifications": [{"finding_id", "result": "PASS|FAIL", "status_after": "CLOSED_VERIFIED|REJECTED_INVALID|OPEN", "note", "evidence": []}]}`.
  - Use `CLOSED_VERIFIED` only if the fix is complete and correct. If it isn't, keep the finding `OPEN` with result `FAIL`, and explain why.
  - You may only verify findings **you** reported. Findings from other reviewers are verified by their reporters.
- **New findings** continue in your ID block:
  - domain-reviewer: from `F-DG0-013`;
  - code-security-reviewer: from `F-DG0-147`;
  - qa-verifier: from `F-DG0-238`.
  - Every new finding must have `stage_id` `DG0`. The validator rejects relabelled, dropped or altered findings.
- **Rule changes since round 1.** The validator binds each review to its run: complete, hash-consistent run evidence, the exact assignment file and SHA-256 you were given, and a start after the freeze. Don't edit your assignment file. Your `invocation_reference` is the one in your prompt.
- **Infrastructure note.** If your shell is refused because the permission classifier returned no verdict, wait and retry. The runner resumes your session automatically after such an outage. Record anything you ultimately couldn't run as BLOCKED.
- **Round-16 rules (see `docs/delivery/decisions.md` D-016 to D-030, and `docs/delivery/threat-model.md`).**
  - **Main change since round 15: D-030. Your whole agent process runs in a kernel-enforced process sandbox** (`tools/agents/agent_sandbox.py`, started by `tools/agents/run-agent.sh`). It is the user-chosen repair of F-DG0-145 (the write guard was check-then-use).
    - The root filesystem is read-only. `/tmp` and `/var/tmp` are private to your run, and only your own `$TMPDIR` (`/var/tmp/mth-run.*`) is writable scratch. `HOME` is read-only.
    - You can write only your own evidence directory (`docs/delivery/test-evidence/DG0/<key>/`; plus `tests/qa/**` and `e2e/**` for qa-verifier), **with the shell or with file tools**. Everything else fails with "Read-only file system".
    - The repository's top level is a throwaway layer: anything created there vanishes when your run ends.
    - Your review files are written to a **private staging copy** of `docs/delivery/reviews/DG0/`. After your run the runner copies back only your own new `round-16/<your-role>.*` files. Anything else written there is discarded and listed in your run's `sandbox.json`, and a run with discarded writes is not committed. You don't see other reviewers' round-16 records during your run.
    - The process keeps only `CAP_SETFCAP`, and `no_new_privs` is set. The Claude Code Bash sandbox (D-025) is nested inside, and the write guard still runs as defence in depth.
    - The validator now accepts gate records only from runs whose `sandbox.json` shows a confined process that discarded nothing.
  - **Also since round 15: D-029** (F-DG0-146, F-DG0-236, F-DG0-237):
    - the working-tree candidate ignores only the sandbox's mount stubs (untracked, zero-length, mode 0444 regular files);
    - the runner pre-creates the stage's evidence and gate-record directories;
    - the threat model states where confined shells could create new files. D-030 has since removed that possibility for confined roles.
  - **Your own shell** has no network. Make disposable copies with `git clone <repo> "$TMPDIR/<name>"`. **A reproduction must stay inside your own `$TMPDIR` and evidence directory. It must never scan, read-modify or target other agents' files.** Nested bubblewrap works inside your sandbox, so `tools/gates/sandbox-run.sh`, the process-sandbox tests and `tools/gates/prefreeze.sh` can run in a fresh clone.
  - **Judge findings about the delivery tooling against `docs/delivery/threat-model.md`.** A way to break a *mechanically prevented* control is a finding. Restating a *disclosed residual* is Low unless it shows the residual is larger than stated.
  - **Verify your `FIXED_PENDING_VERIFICATION` findings:**
    - code-security-reviewer verifies F-DG0-145 (High) and F-DG0-146;
    - qa-verifier verifies F-DG0-236 and F-DG0-237;
    - domain-reviewer has no finding pending verification.
  - **Evidence entries** must be existing repository files, optionally followed by `#fragment`. **Write your record and sidecars only with the Write/Edit tools.**
  - **Run `tools/gates/prefreeze.sh DG0`** in a fresh clone of the candidate commit.
