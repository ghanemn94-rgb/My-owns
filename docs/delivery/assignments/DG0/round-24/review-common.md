# DG0 review: common context (read together with your role-specific assignment)

- **Stage:** P0 "Discovery and execution setup" / gate DG0. The stage is REVIEWING.
- **Frozen candidate:** `sha256:f0f3a93a1fcf33e58b1d553e39205cc8bc1764407189b69904d2d58e976f351a`, source commit `6db3b8388699b767032b4f92547ceb79edf74519`. The manifest is `docs/delivery/candidates/DG0/f0f3a93a1fcf33e5.manifest.json`.
  - Confirm `git rev-parse HEAD` equals the commit, **or** that `node tools/gates/candidate.mjs --stage DG0` prints the candidate ID. Metadata-only commits may follow the freeze.
  - **This repository must be a COMPLETE clone:** `git rev-parse --is-shallow-repository` must print `false` (run `git fetch --unshallow` if not). The gate validator refuses a shallow clone (F-DG0-160). **For your disposable clones, use `git clone --no-local <repo> "$TMPDIR/<name>"`** so you see the same object set as CI (`fetch-depth: 0`) — a plain local-path clone copies unreachable objects (D-039/F-DG0-247). If the candidate doesn't match, return BLOCKED.
- **Review round:** `23`. Write your record to `docs/delivery/reviews/DG0/round-24/<your-role>.json`.
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
- Findings in `docs/delivery/reviews/DG0/round-24/<your-role>.findings.json` conforming to `tools/gates/schemas/findings.schema.json`: status `OPEN`, `reported_by` your role, `reported_in` your record path, `owner` the responsible implementer. ID block: domain from `F-DG0-014`; code-security from `F-DG0-166`; qa from `F-DG0-249`.
- Re-verifications in `<your-role>.verifications.json`; you may only verify findings **you** reported.
- Validate your record against `tools/gates/schemas/review.schema.json`.
- **Verdict:** PASS only if no Critical/High/Medium problems and every check passed. FAIL if findings must be fixed. BLOCKED if you couldn't perform required checks. Low observations may coexist with PASS if recorded as `"severity":"Low"` findings.
- Put every check in `checks_run`; put the requirement IDs you verified in `requirements_checked`.
- **Independence:** form your verdict before reading any other round-24 review record.

## Evidence format (enforced by the validator)
Every `evidence_paths` / verification `evidence` / check `evidence` entry must be an existing repository file, optionally `#fragment`. **Write your record and sidecars only with the Write/Edit tools.**

## Round 24 specifics (re-review after the round-23 D-040 repairs — this is the GATE round)
- **The candidate changed only in the delivery tooling and docs.** `git diff 6438e20c076359ff5eda879f1e31ff6fbda0b57f..6db3b8388699b767032b4f92547ceb79edf74519` shows everything since the round-23 candidate baseline: `tools/gates/lib/rules.mjs` and `tools/gates/tests/validator.test.mjs` (the D-040 change plus corrected comments) and `docs/delivery/decisions.md` (D-040). `findings.json` and test-evidence are metadata, excluded from the candidate.
- **Context (read D-040, and D-037→D-039, in `docs/delivery/decisions.md`).** The validator is strict on the complete history (a shallow clone is refused, F-DG0-160). Rounds 20–23 removed the forgeable absent-commit tolerances; the **single** remaining absence tolerance is `findManifest`'s content-preserving one (D-035, for round-18's D-034-orphaned write-once manifest, whose entries must still hash to its `candidate_id`). D-040 is the last piece: a closure is bound to the verifying run's real `head_commit_at_start`, not the round's self-declared metadata.
- **Verify your own earlier findings independently** (reproduce, then show fixed). Use `CLOSED_VERIFIED` only if complete.
- **New findings** continue in your ID block. Every finding `stage_id` `DG0`.
- **D-040 changes to verify (`tools/gates/lib/rules.mjs`):**
  - **F-DG0-166/249 (Low):** `checkClosure` now requires a CLOSED_VERIFIED `fix_revision` to be an ancestor of the **verifying run's `head_commit_at_start`** (present, 40-hex, contains the round manifest — real run-bound evidence) **and** the gate candidate; it no longer uses the round's forgeable `source_commit` for the round-side check. **Verify:** a forged superseded round (schema-valid manifest naming a non-existent `source_commit` + a stages entry, with a genuine verifier run) can no longer close a finding whose fix was committed **after** the verifier ran; unit test "D-039/D-040 / F-DG0-164/166/246/249" and the updated "F-DG0-110 / F-DG0-204". Confirm every genuine closure's `fix_revision` IS an ancestor of its verifying run's head on the complete history (the dry-run shows no such error).
  - **F-DG0-014/167 (Low):** the `commitPresent()` (and `findManifest`) header comments were corrected to the strict complete-history model. **Verify:** the comments describe the current behaviour (only `findManifest` tolerates a genuinely-absent commit, content-preservingly; `checkClosure`/`checkInvocation` are strict).
  - **Already CLOSED_VERIFIED (do not re-verify):** F-DG0-013/145/146/148/150/151/152/153/154/155/156/157/158/159/160/161/162/163/164/165/236/237/238/239/240/241/242/243/244/245/246/247/248. F-DG0-147/149 are accepted observations awaiting the auditor's concurrence.
- **Run `tools/gates/prefreeze.sh DG0`** in a fresh `--no-local` clone. Judge delivery-tooling findings against `docs/delivery/threat-model.md`.
