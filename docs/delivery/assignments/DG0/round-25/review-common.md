# DG0 review: common context (read together with your role-specific assignment)

- **Stage:** P0 "Discovery and execution setup" / gate DG0. The stage is REVIEWING.
- **Frozen candidate:** `sha256:b77a1c6303fe7be11fbdc858c2810329e947871d788d29b8f000cbd6dbfdcbab`, source commit `2386a0fbd0795f3f09ec2802112e84fae2d616f9`. The manifest is `docs/delivery/candidates/DG0/b77a1c6303fe7be1.manifest.json`.
  - Confirm `git rev-parse HEAD` equals the commit, **or** that `node tools/gates/candidate.mjs --stage DG0` prints the candidate ID. Metadata-only commits may follow the freeze.
  - **This repository must be a COMPLETE clone:** `git rev-parse --is-shallow-repository` must print `false` (run `git fetch --unshallow` if not). The gate validator refuses a shallow clone (F-DG0-160). **For your disposable clones, use `git clone --no-local <repo> "$TMPDIR/<name>"`** so you see the same object set as CI (`fetch-depth: 0`) — a plain local-path clone copies unreachable objects (D-039/F-DG0-247). If the candidate doesn't match, return BLOCKED.
- **Review round:** `23`. Write your record to `docs/delivery/reviews/DG0/round-25/<your-role>.json`.
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
- Findings in `docs/delivery/reviews/DG0/round-25/<your-role>.findings.json` conforming to `tools/gates/schemas/findings.schema.json`: status `OPEN`, `reported_by` your role, `reported_in` your record path, `owner` the responsible implementer. ID block: domain from `F-DG0-014`; code-security from `F-DG0-166`; qa from `F-DG0-249`.
- Re-verifications in `<your-role>.verifications.json`; you may only verify findings **you** reported.
- Validate your record against `tools/gates/schemas/review.schema.json`.
- **Verdict:** PASS only if no Critical/High/Medium problems and every check passed. FAIL if findings must be fixed. BLOCKED if you couldn't perform required checks. Low observations may coexist with PASS if recorded as `"severity":"Low"` findings.
- Put every check in `checks_run`; put the requirement IDs you verified in `requirements_checked`.
- **Independence:** form your verdict before reading any other round-25 review record.

## Evidence format (enforced by the validator)
Every `evidence_paths` / verification `evidence` / check `evidence` entry must be an existing repository file, optionally `#fragment`. **Write your record and sidecars only with the Write/Edit tools.**

## Round 25 specifics (re-review after the round-24 D-041 repair — this is the GATE round)
- **The candidate changed only in the delivery tooling and docs.** `git diff 6db3b8388699b767032b4f92547ceb79edf74519..2386a0fbd0795f3f09ec2802112e84fae2d616f9` shows everything since the round-24 candidate baseline: `tools/gates/lib/rules.mjs` (the D-041 change plus a corrected comment), `tools/gates/tests/validator.test.mjs` and `docs/delivery/decisions.md` (D-041). `findings.json` and test-evidence are metadata, excluded from the candidate.
- **Context (read D-041, and D-037→D-040, in `docs/delivery/decisions.md`).** The validator is strict on the complete history (a shallow clone is refused, F-DG0-160). Rounds 20–24 removed the forgeable absent-commit tolerances; the **single** remaining absence tolerance is `findManifest`'s content-preserving one (D-035, for round-18's D-034-orphaned write-once manifest, whose entries must still hash to its `candidate_id`). D-041 completes `checkClosure`: a closure is now anchored to **three** commits at once, so no single forgeable metadata value decides it.
- **Verify your own earlier findings independently** (reproduce, then show fixed). Use `CLOSED_VERIFIED` only if complete.
- **New findings** continue in your ID block. Every finding `stage_id` `DG0`.
- **D-041 change to verify (`tools/gates/lib/rules.mjs`):**
  - **F-DG0-168 (Low):** `checkClosure` now requires a CLOSED_VERIFIED `fix_revision` to be an ancestor of **all three** anchors, each enforced: (1) the verifying round's frozen `source_commit` when it resolves (pins the fix to the exact frozen candidate the reviewer saw), (2) the verifying run's `head_commit_at_start` (present, 40-hex, contains the round manifest — real run-bound evidence, covers a forged round whose `source_commit` is self-declared absent), and (3) the gate candidate. D-040 had *replaced* anchor 1 with anchor 2; D-041 restores it as an addition. **Verify:** a candidate-scope fix committed **after the freeze but before the verifier ran** in a genuine round is now rejected (anchor 1), and the forged-absent-round case is still rejected (anchor 2); unit tests "F-DG0-110 / F-DG0-204" (asserts all three anchors fire) and "D-039/D-040 / F-DG0-164/166/246/249". Confirm every genuine closure passes all three anchors on the complete history (the dry-run shows no closure error).
  - **Already CLOSED_VERIFIED (do not re-verify):** F-DG0-013/014/145/146/148/150/151/152/153/154/155/156/157/158/159/160/161/162/163/164/165/166/167/236/237/238/239/240/241/242/243/244/245/246/247/248/249. F-DG0-147/149 are accepted observations awaiting the auditor's concurrence.
- **Run `tools/gates/prefreeze.sh DG0`** in a fresh `--no-local` clone. Judge delivery-tooling findings against `docs/delivery/threat-model.md`.
