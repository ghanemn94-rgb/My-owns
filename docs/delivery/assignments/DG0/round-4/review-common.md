# DG0 review: common context (read together with your role-specific assignment)

- **Stage:** P0 "Discovery and execution setup" / gate DG0. The stage is REVIEWING.
- **Frozen candidate:** `sha256:0be571eaa84438604b9b4095b7a2bb26086a340b1a34ab2b56aba3a148d3a3b7`, source commit `53f5d176dfaa913baa61b34c0aa4fe5fd9a788b5`. The manifest is `docs/delivery/candidates/DG0/0be571eaa8443860.manifest.json`.
  - Before reviewing, confirm that `git rev-parse HEAD` equals the commit, **or** that `node tools/gates/candidate.mjs --stage DG0` prints the candidate ID. Metadata-only commits may follow the freeze.
  - If the candidate doesn't match, stop and return BLOCKED.
- **Review round:** `4`. Write your record to `docs/delivery/reviews/DG0/round-4/<your-role>.json`.
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
- Put findings in `docs/delivery/reviews/DG0/round-4/<your-role>.findings.json` as `{"findings": [...]}`. Each finding object must conform to `tools/gates/schemas/findings.schema.json`: status `OPEN`, `reported_by` your role, `reported_in` your record path, and `owner` the responsible implementer (`transformation-analyst` or `delivery-orchestrator`). Use your ID block:
  - domain-reviewer: `F-DG0-001`…`099`;
  - code-security-reviewer: `F-DG0-101`…`199`;
  - qa-verifier: `F-DG0-201`…`299`.
  - In later rounds, continue within your block.
- List the same IDs in your review record's `findings` array.
- If you re-verify earlier findings in this round, write `<your-role>.verifications.json` as `{"verifications": [{"finding_id", "result": "PASS|FAIL", "status_after": "CLOSED_VERIFIED|REJECTED_INVALID|OPEN", "note", "evidence": []}]}`.
- Your review record must validate against `tools/gates/schemas/review.schema.json`. Self-check it with:
  `node -e "import('./tools/gates/lib/schema.mjs').then(m=>{const s=require('./tools/gates/schemas/review.schema.json');const r=require('./docs/delivery/reviews/DG0/round-4/<role>.json');const e=m.validate(s,r);console.log(e.length?e:'valid')})"`
- **Verdict:** PASS only if you found no Critical, High or Medium problems in your scope and every check you ran passed. FAIL if you have findings that must be fixed. BLOCKED if you couldn't perform required checks.
- Low cosmetic observations may coexist with PASS only if you record them as findings with `"severity":"Low"` and state in the finding that you'd accept them as an observation.
- Put every check in `checks_run`, with the exact command, environment, expected result, actual result, `exit_status` and result.
- Put the requirement IDs you actually verified in `requirements_checked`.
- **Independence:** form your verdict before reading any other round-4 review record.

## Round 4 specifics (re-review after repairs)

- **The candidate changed after round 3.** Review the new frozen candidate in full, not just the diff. Use `git diff 540b3c69a0e0477476eca0207b0b9c0aaded1ea9..53f5d176dfaa913baa61b34c0aa4fe5fd9a788b5` to see what changed since the round-3 candidate (`540b3c69a0e0477476eca0207b0b9c0aaded1ea9`).
- **Verify your own earlier findings independently.** Each finding you raised in earlier rounds is listed in `docs/delivery/findings.json` with its `fix_revision` and `fix_summary`.
  - For each one, reproduce the original failure against the old commit if possible, then show whether it's fixed in the new candidate. Run the regression tests, and write your own reproduction where the existing tests are insufficient.
  - Record the result in `docs/delivery/reviews/DG0/round-4/<your-role>.verifications.json`, as `{"verifications": [{"finding_id", "result": "PASS|FAIL", "status_after": "CLOSED_VERIFIED|REJECTED_INVALID|OPEN", "note", "evidence": []}]}`.
  - Use `CLOSED_VERIFIED` only if the fix is complete and correct. If it isn't, keep the finding `OPEN` with result `FAIL`, and explain why.
  - You may only verify findings **you** reported. Findings from other reviewers are verified by their reporters.
- **New findings** continue in your ID block:
  - domain-reviewer: from `F-DG0-009`;
  - code-security-reviewer: from `F-DG0-118`;
  - qa-verifier: from `F-DG0-211`.
  - Every new finding must have `stage_id` `DG0`. The validator rejects relabelled, dropped or altered findings.
- **Rule changes since round 1.** The validator now binds each review to its run: complete, hash-consistent run evidence, the exact assignment file and SHA-256 you were given, and a start after the freeze. Don't edit your assignment file. Your `invocation_reference` is the one in your prompt.
- **Infrastructure note.** If your shell is refused because the permission classifier returned no verdict, wait and retry. The runner now resumes your session automatically after such an outage. Record anything you ultimately couldn't run as BLOCKED.
- **Round-4 rules (decision D-021; read `docs/delivery/decisions.md` D-016 to D-021 and `docs/delivery/agent-protocol.md`).**
  - Write your record and sidecars **only with the Write/Edit tools**. The validator binds them to the exact bytes your run wrote. The runner auto-commits them when your run ends, and from then on they're write-once. **Never** edit any file from an earlier round.
  - **Re-confirm every finding you have ever raised in DG0**, including those closed in rounds 2 and 3. Closures now require a verification entry from a run that recorded its outputs, and rounds 1–3 predate that. Your `docs/delivery/reviews/DG0/round-4/<your-role>.verifications.json` must therefore contain one entry per finding you reported (PASS with status_after `CLOSED_VERIFIED` or `REJECTED_INVALID`, or FAIL with status_after `OPEN`).
  - To accept a Low, non-mandatory finding as an observation instead of fixing it, use status_after `ACCEPTED_OBSERVATION`, with the rationale in `note`. It then also needs the release-auditor's agreement in its own sidecar.
- **Your findings:** list them with `python3 -c "import json;[print(f['id'],f['severity'],f['status']) for f in json.load(open('docs/delivery/findings.json'))['findings'] if f['reported_by']=='<your-role>']"`.
