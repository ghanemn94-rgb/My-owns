# DG0 review: common context (read together with your role-specific assignment)

- **Stage:** P0 "Discovery and execution setup" / gate DG0. The stage is REVIEWING.
- **Frozen candidate:** `sha256:84130c624e877424eed6deb91d086249bc1330bda34ff109b0183102533751bd`, source commit `1e4c0226fc50dc6cc928ce4f16cbf7507afed1ac`. The manifest is `docs/delivery/candidates/DG0/84130c624e877424.manifest.json`.
  - Confirm `git rev-parse HEAD` equals the commit, **or** that `node tools/gates/candidate.mjs --stage DG0` prints the candidate ID. Metadata-only commits may follow the freeze.
  - **This repository must be a COMPLETE clone:** `git rev-parse --is-shallow-repository` must print `false` (run `git fetch --unshallow` if not). The gate validator refuses a shallow clone (F-DG0-160). **For your disposable clones, use `git clone --no-local <repo> "$TMPDIR/<name>"`** so you see the same object set as CI (`fetch-depth: 0`) — a plain local-path clone copies unreachable objects (D-039/F-DG0-247). If the candidate doesn't match, return BLOCKED.
- **Review round:** `29`. Write your record to `docs/delivery/reviews/DG0/round-29/<your-role>.json`.
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
- Findings in `docs/delivery/reviews/DG0/round-29/<your-role>.findings.json` conforming to `tools/gates/schemas/findings.schema.json`: status `OPEN`, `reported_by` your role, `reported_in` your record path, `owner` the responsible implementer. ID block: domain from `F-DG0-014`; code-security from `F-DG0-166`; qa from `F-DG0-249`.
- Re-verifications in `<your-role>.verifications.json`; you may only verify findings **you** reported.
- Validate your record against `tools/gates/schemas/review.schema.json`.
- **Verdict:** PASS only if no Critical/High/Medium problems and every check passed. FAIL if findings must be fixed. BLOCKED if you couldn't perform required checks. Low observations may coexist with PASS if recorded as `"severity":"Low"` findings.
- Put every check in `checks_run`; put the requirement IDs you verified in `requirements_checked`.
- **Independence:** form your verdict before reading any other round-29 review record.

## Evidence format (enforced by the validator)
Every `evidence_paths` / verification `evidence` / check `evidence` entry must be an existing repository file, optionally `#fragment`. **Write your record and sidecars only with the Write/Edit tools.**

## Round 29 specifics (re-review after the round-28 D-045 repair — this is the GATE round)
- **The candidate changed only in the delivery tooling and docs.** `git diff 331407e9b6711abbc01f7ee0456e4fa92ff65cda..1e4c0226fc50dc6cc928ce4f16cbf7507afed1ac` shows everything since the round-28 candidate baseline: `tools/gates/lib/rules.mjs` (the D-045 `checkReviewRounds` object-type check, +11 lines), `tools/gates/tests/validator.test.mjs` (two new tests, +36 lines) and `docs/delivery/decisions.md` (the D-045 row). `findings.json` and test-evidence are metadata, excluded from the candidate.
- **Context (read D-045 and D-044, and D-037→D-043, in `docs/delivery/decisions.md`).** The validator is strict on the complete history (a shallow clone is refused, F-DG0-160). The **single** remaining absence tolerance is `findManifest`'s content-preserving one (D-035, for round-18's D-034-orphaned write-once manifest). `checkClosure` anchors a closure to **three** commits, all unconditional; and — after D-045 — **all four** commit-id fields the gate depends on must be **commit objects** (never an annotated tag or other ref-dependent object): the gate `source_commit` (D-037), each closure's `fix_revision` and each run's `head_commit_at_start` (D-044), and each **review round's `source_commit`** (D-045). D-045 is the last field; the "tag where a commit is required" class is now closed with no remaining field.
- **Verify your own earlier findings independently** (reproduce, then show fixed). Use `CLOSED_VERIFIED` only if complete.
- **New findings** continue in your ID block. Every finding `stage_id` `DG0`.
- **D-045 change to verify (`tools/gates/lib/rules.mjs`, `checkReviewRounds`):**
  - **F-DG0-171 (code-security) / F-DG0-251 (qa), both Low — the same residual, fixed together:** `checkReviewRounds` now computes `objectType(r.source_commit)` and rejects it when the object is **present but not a commit** (`rscType && rscType !== "commit"`), so an annotated-tag object id in `review_rounds[].source_commit` (closure anchor 1, and the source `findManifest` recomputes the round manifest from — all of which `commitPresent`/`isAncestor`/`manifestFromRef` PEEL) is now rejected, matching the D-037/D-044 rule for the other three commit-id fields. A **genuinely absent** source_commit stays tolerated (round 18's D-034/D-035 orphan — `objectType` returns `null` for an absent object, so the check never fires on it). **Verify:** unit tests "D-045 / F-DG0-171 / F-DG0-251" (a tag-object round source_commit is rejected; an absent one is still tolerated) and "D-044 / F-DG0-251" (a tag-object `head_commit_at_start` is rejected — the previously untested D-044 `checkInvocation` branch). Forge a tag-object round `source_commit` in a disposable clone and confirm rejection. Confirm **no genuine record regressed**: on the complete history every present `review_rounds[].source_commit` (all 27), every `fix_revision` and every `head_commit_at_start` is a commit object; round 18 is the known absent orphan; the dry-run shows no new "is a … object, not a commit" error. This is the reporter-anticipated fix (code-security's round-28 F-DG0-171 verification: "if the orchestrator fixes it … I will re-verify it as CLOSED_VERIFIED").
  - **Already CLOSED_VERIFIED (do not re-verify):** F-DG0-013/014/145/146/148/150/151/152/153/154/155/156/157/158/159/160/161/162/163/164/165/166/167/168/169/170/236/237/238/239/240/241/242/243/244/245/246/247/248/249/250. F-DG0-147/149 are accepted observations awaiting the auditor's concurrence.
- **Run `tools/gates/prefreeze.sh DG0`** in a fresh `--no-local` clone. Judge delivery-tooling findings against `docs/delivery/threat-model.md`.
