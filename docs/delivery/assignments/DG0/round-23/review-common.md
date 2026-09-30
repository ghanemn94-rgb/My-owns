# DG0 review: common context (read together with your role-specific assignment)

- **Stage:** P0 "Discovery and execution setup" / gate DG0. The stage is REVIEWING.
- **Frozen candidate:** `sha256:e6df2e1ebccbd87f01fa80a17ddd0f89ca469658e2511d0e9bff47b319da51c5`, source commit `6438e20c076359ff5eda879f1e31ff6fbda0b57f`. The manifest is `docs/delivery/candidates/DG0/e6df2e1ebccbd87f.manifest.json`.
  - Confirm `git rev-parse HEAD` equals the commit, **or** that `node tools/gates/candidate.mjs --stage DG0` prints the candidate ID. Metadata-only commits may follow the freeze.
  - **This repository must be a COMPLETE clone:** `git rev-parse --is-shallow-repository` must print `false` (run `git fetch --unshallow` if not). The gate validator refuses a shallow clone (F-DG0-160). **For your disposable clones, use `git clone --no-local <repo> "$TMPDIR/<name>"`** so you see the same object set as CI (`fetch-depth: 0`) — a plain local-path clone copies unreachable objects (D-039/F-DG0-247). If the candidate doesn't match, return BLOCKED.
- **Review round:** `23`. Write your record to `docs/delivery/reviews/DG0/round-23/<your-role>.json`.
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
- Findings in `docs/delivery/reviews/DG0/round-23/<your-role>.findings.json` conforming to `tools/gates/schemas/findings.schema.json`: status `OPEN`, `reported_by` your role, `reported_in` your record path, `owner` the responsible implementer. ID block: domain from `F-DG0-014`; code-security from `F-DG0-166`; qa from `F-DG0-249`.
- Re-verifications in `<your-role>.verifications.json`; you may only verify findings **you** reported.
- Validate your record against `tools/gates/schemas/review.schema.json`.
- **Verdict:** PASS only if no Critical/High/Medium problems and every check passed. FAIL if findings must be fixed. BLOCKED if you couldn't perform required checks. Low observations may coexist with PASS if recorded as `"severity":"Low"` findings.
- Put every check in `checks_run`; put the requirement IDs you verified in `requirements_checked`.
- **Independence:** form your verdict before reading any other round-23 review record.

## Evidence format (enforced by the validator)
Every `evidence_paths` / verification `evidence` / check `evidence` entry must be an existing repository file, optionally `#fragment`. **Write your record and sidecars only with the Write/Edit tools.**

## Round 23 specifics (re-review after the round-22 D-039 repairs — this is the GATE round)
- **The candidate changed only in the delivery tooling and docs.** `git diff 480cd3ff2b1048439bafebf0bf40151a11d84ea7..6438e20c076359ff5eda879f1e31ff6fbda0b57f` shows everything since the round-22 candidate baseline: `tools/gates/lib/rules.mjs`, `tools/gates/tests/validator.test.mjs`, `docs/delivery/decisions.md` (D-039). `findings.json` and test-evidence are metadata, excluded from the candidate.
- **D-039 REMOVES complexity — read D-039 in `docs/delivery/decisions.md`.** The D-037/D-038 absent-commit tolerance in `checkClosure`/`checkInvocation` was forgeable (it keyed on a round's `source_commit`, which is orchestrator metadata that `findManifest` tolerates) and, on the complete history with every closure re-verified against a retained candidate, unnecessary. It is **gone**. The validator is now strict: a CLOSED_VERIFIED `fix_revision` and a run's `head_commit_at_start` must be **present** commits, and the fix must be an ancestor of the round and gate candidates. The only remaining absence tolerance is `findManifest`'s content-preserving one (D-035) for round-18's write-once orphan manifest.
- **Verify your own earlier findings independently** (reproduce, then show fixed). Use `CLOSED_VERIFIED` only if complete.
- **New findings** continue in your ID block. Every finding `stage_id` `DG0`.
- **D-039 changes to verify (`tools/gates/lib/rules.mjs`):**
  - **F-DG0-164/246 (Med):** no absent-commit escape. **Verify:** a forged superseded round (a schema-valid manifest + stages entry naming a non-existent `source_commit`, no run evidence forged) can no longer close a finding with an all-zero/absent `fix_revision`, and a run with a missing/`unknown`/absent `head_commit_at_start` is rejected. Unit tests "D-039 / F-DG0-164/246" and "D-039 / F-DG0-164". Confirm the only absence tolerance left is `findManifest`'s (round 18), and that it is content-preserving (entries must hash to `candidate_id`).
  - **F-DG0-165 (Low):** a later-round findings sidecar cannot reclassify a finding's immutable fields (`severity`, `mandatory_violation`, …). **Verify:** unit test "D-039 / F-DG0-165"; adding a round-N+1 sidecar that downgrades a finding's severity is rejected.
  - **F-DG0-013/247 (Low):** the round-18 orphan `450c756` (and `cb76260`) were `gc --prune=now`'d. **Verify:** `git cat-file -t 450c756f679a911b4c736e856fc9dd5e9b2c89a8` fails here; the real-repo dry-run (`docs/delivery/test-evidence/DG0/qa/tests/real-repo-gate-blockers.mjs`) reports 0 in the PRUNED/RECORD-LESS/DROPPED buckets on both a `--no-local` and a plain local clone.
  - **F-DG0-248 (Low):** the shallow-clone refusal now has a unit test. **Verify:** "D-039 / F-DG0-248" (a `--depth=1` clone is refused, a complete clone is not).
  - **Already CLOSED_VERIFIED (do not re-verify):** F-DG0-145/146/148/150/151/152/153/154/155/156/157/158/159/160/161/162/163/236/237/238/239/240/241/242/243/244/245. F-DG0-147/149 are accepted observations awaiting the auditor's concurrence.
- **Run `tools/gates/prefreeze.sh DG0`** in a fresh `--no-local` clone. Judge delivery-tooling findings against `docs/delivery/threat-model.md`.
