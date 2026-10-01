# Delivery progress checkpoint

_Updated by the delivery-orchestrator at every step change. On resumption, run `node tools/gates/validate.mjs --reconcile` and `--pipeline` first. Then reconcile this file with `stages.json`, `findings.json` and the latest review round before assigning any write task._

## Current checkpoint

- **DG0 is APPROVED.** Gate record `docs/delivery/gates/DG0.json` = APPROVED on candidate `sha256:84130c624e877424eed6deb91d086249bc1330bda34ff109b0183102533751bd` (source `1e4c0226`), 19/19 DG0-final requirements. Validator passes in all modes: `--stage DG0`, `--pipeline`, and `--historical --stage DG0` all exit 0. Approval commit `979df00`; state set APPROVED in `9de13f4`; pushed.
- **Round-29 gate outcome (D-045):** 3x PASS. `checkReviewRounds` now requires a review round's `source_commit` to be a commit object when present (the fourth and last commit-id field the gate depends on, completing D-044's "tag where a commit is required" class). **F-DG0-171** (code-security) and **F-DG0-251** (qa) CLOSED_VERIFIED. Two unit tests added (round source_commit tag; head_commit_at_start tag). Gate+agent suites 105 pass.
- **Accepted observations (Low, non-mandatory), concurred by reporter + release-auditor:** F-DG0-015 (D-045 changelog headline wording), F-DG0-147 (copy-back accept pattern not round-pinned; fail-closed), F-DG0-149 (threat-model residual 7, disclosed). All recorded in `findings.json` with acceptance objects; no OPEN/FIXED_PENDING findings remain.
- **DG0 journey:** 29 review rounds. Rounds 1-15 built and hardened the delivery machinery (validator, candidate hashing, agent runner + nested/OS sandboxes, write-once evidence) and the source analysis. Rounds 16-29 hardened the gate validator itself against increasingly marginal edge cases: D-030-033 (process/Landlock sandbox), D-034 (write-once history repair), D-035-038 (shallow-clone / complete-history model), D-037-045 (commit-object requirement across every commit-id field the gate depends on). Full detail in `decisions.md` (D-001..D-045) and `stages.json`.
- **DG1 implementation + review is complete through 16 rounds; the gate audit is BLOCKED pending one user decision (D-056).** Round 16 (gate round): domain/code-security/qa all PASS on candidate `sha256:56f3eb885c6cf3db…` (source `13418b8`, 391 files); F-DG1-137/218 CLOSED_VERIFIED; all 66 DG1 findings terminal; zero unresolved Critical/High/mandatory. BUT the first complete `validate.mjs --stage DG1` (never run to exit in rounds 1–15) returned 209 problems and the release-auditor returned BLOCKED (`docs/delivery/gates/DG1.json`).
- **Blocker shape (full taxonomy in D-056):** most of the debt is **fixable autonomously** — (1) expand 44 abbreviated `fix_revision`s to 40-hex; realign ~25 `verification` mirrors in findings.json to the validator's selected sidecar (a systemic `import-findings` vs validator role-selection divergence); correct stages.json rounds 7–15 `frozen_at`/`source_commit` to match manifests; (2) a clean **round-17 re-verification** of ~26 findings whose governing sidecar is a write-once record with an annotated `assignment` (rounds 2/3/10/11/13) or a pre-freeze run (round 12 → F-DG1-132/133); (3a) add the two missing `.findings.json` sidecars (round-16 cs 137/218; round-4 domain 009/210, append-only); (4) a D-049-style decision for the environmentally-BLOCKED online-installer check SEC-R16-32c (REQ-DLV-042). **The one irreducible item (3b):** the **round-2 code-security record** predates the current `checks_run` schema (old `{id,procedure,result,evidence}` shape, free-text results; 54 schema errors). It is the only schema-nonconformant record, write-once committed (`16ac7b3`), and `checkReviewRounds` schema-validates every round — so no later round supersedes it. Making it valid = re-authoring committed review evidence, which `checkWriteOnce` forbids and (per D-034) needs a user-added `git filter-branch` permission rule.
- **Next action: await the user's decision on (3b)** — (A) authorize a D-034-style history rewrite to migrate the round-2 record (and optionally the annotated-assignment records) to the current schema, reconstructing its fields from its own evidence logs; or (B) accept DG1 on substance with a documented deviation (validate.mjs would still flag the historical-schema errors); or (C) another path. Once chosen, items (1)–(4) proceed autonomously. No record has been edited to make the validator pass.

**Review history**

| Round | domain | code-security | QA | New findings |
|---|---|---|---|---|
| 1 | FAIL | BLOCKED (classifier outage) | FAIL | 17 (2 High) |
| 2 | PASS | FAIL | FAIL | 11 (1 High) |
| 3 | PASS | FAIL | PASS | 7 (1 High) |
| 4 | PASS | FAIL | PASS | 7 Low; 115 reopened |
| 5 | FAIL | (orphaned: runner bug) | (orphaned) | 1 |
| 6 | FAIL | FAIL | FAIL | 5 (bytecode in candidate; 115 back-dating residual) |
| 7 | PASS | FAIL | PASS | 4 (132 High: empty-transcript bypass). D-022 prompt-binding defect found by the orchestrator |
| 8 | PASS | PASS | PASS | 1 Low (path with space) |
| 9 | PASS | FAIL | PASS | 2 (134 Medium: worktree guard bypass) |
| 10 | PASS | FAIL | PASS | 3 (135/136 Medium: guard fail-open, user settings) |
| 11 | PASS | FAIL | FAIL | 6 (137 High, 226: shell bypasses of the guard). Led to the §0.4 root-cause response: D-025 (OS Bash sandbox) and `threat-model.md` |
| 12 | (orphaned: stub false positive; run PASS) | FAIL | FAIL (run exit 1; does not bind) | 5: 140 Critical (runner imports planted modules), 229 Medium, 230/231/232 Low |
| 13 | PASS | FAIL | FAIL (Low only) | 5: 141 High (sandbox wrapper cloned into agent-writable `$TMPDIR`), 012/142/233/234 Low; 231 reopened |
| 14 | PASS | FAIL | PASS (Low) | 3: 143/144 Medium (guard fail-open via /proc; shared $TMPDIR, demonstrated by an unintended cross-agent incident), 235 Low |
| 15 | PASS | FAIL | PASS (Low: 236, 237) | 145 High (guard check-then-use: symlink swap between hook check and Write), 146 Low (sandbox stubs perturb working-tree candidate; fails closed) |
| 16–22 | PASS | PASS/FAIL | PASS/FAIL | Process + Landlock sandbox (D-030–033, F-DG0-145/152 High CLOSED), write-once history repair (D-034), shallow-clone/complete-history model (D-035–038); F-DG0-013/014/145/146/148/150–166 resolved |
| 23–27 | PASS | PASS | PASS | Strict validator convergence: absent-commit tolerances removed, three-anchor closure (D-039–042), single-source closure comment (D-043), commit-object fix_revision/head (D-044). Mostly Low observations |
| 28 | PASS | PASS (F-DG0-171 Low) | PASS (F-DG0-251 Low) | Same residual found independently: review_rounds[].source_commit not type-checked. F-DG0-250 CLOSED_VERIFIED |
| 29 (GATE) | PASS | PASS | PASS | D-045 repair verified: F-DG0-171/251 CLOSED_VERIFIED; F-DG0-015 Low (accepted). **DG0 APPROVED** |

- **RESOLVED — F-DG0-145 (High, mandatory):** the user chose option 1 (kernel-enforced outer sandbox around the whole agent process) and added the permission rule; implemented as D-030 (outer bwrap) + D-033 (per-run Landlock domain). **CLOSED_VERIFIED.** The sections below are retained as historical context; the authoritative current state is the checkpoint above plus `decisions.md`, `stages.json` and `findings.json`.
- **Findings:** 77 closed and verified. F-DG0-145 (High) is open. F-DG0-146, 236 and 237 are fixed and pending verification.

## Done in P0 so far

- Located the authoritative source (a session upload), committed it, and made the extraction reproducible: `tools/source/check_extraction.sh` passes.
- Saved the master prompt v2.0 verbatim and split it into 423 anchored blocks.
- Wrote the ten project agent definitions. The invocation mechanism was verified; see `docs/delivery/agents.md` and decision D-003.
- Built the role write guard and its tests (8/8 pass).
- Built the gate tooling: schemas, candidate hashing, validator (`--stage`, `--historical`, `--pipeline`, `--register`, `--reconcile`) and self-tests (15/15 pass).
- Added the CI workflow `.github/workflows/delivery-gates.yml`.
- Wrote delivery records: environment, protocol, register spec, decisions, stages, findings.

## In flight

| Task | Agent | Status |
|---|---|---|
| T-DG0-AN-01: playbook → REQ-PB (92 rows), source coverage (165/165), glossary, field inventory | transformation-analyst | **done** (handback committed) |
| T-DG0-LOAD: load and guard check of all ten agents | all ten | **done**: 10/10 loaded, 10/10 out-of-scope writes blocked |
| T-DG0-AN-02: master prompt §1–§13 | transformation-analyst | running |
| T-DG0-AN-03: preamble, §0 and §14–§21 | transformation-analyst | running |
| P1 stack discovery (read-only, not a delivery task) | built-in research workflow agents | running |

**Deviation, recorded honestly:** during this step, 2 delivery agents and 4 read-only research agents ran concurrently, which is above the §0.2 default of 4 active workers. The research agents write nothing to the repository. No resource contention was observed on the 4 vCPU / 15 GiB host.

## Next actions

1. **AN-02:** master prompt §1–§11 → requirements, coverage, permissions matrix, user journeys.
2. **AN-03:** preamble, §0 and §12–§21 → requirements, coverage, acceptance map, stage plan.
3. **AN-04:** merge the parts into `docs/delivery/requirements.csv` and `docs/analysis/master-prompt-coverage.csv`, then run `validate.mjs --register DG0`.
4. Freeze the DG0 candidate, then run the three independent reviews (domain, code-security, QA) followed by the release audit.

## Unresolved blockers

- **BLK-DG1-r2-schema (D-056):** DG1 gate round 16 is BLOCKED. The round-2 code-security review record predates the current `checks_run` schema and is write-once committed, so `validate.mjs --stage DG1` cannot reach exit 0 without re-authoring committed review evidence (a D-034-style `git filter-branch` rewrite, which needs a user-added permission rule) or a documented deviation. **Awaiting the user's decision** (D-056 options A/B/C). All other validator debt is fixable autonomously and will proceed once the path is chosen. No record has been edited to make the validator pass.

_(The DG0-era "Done in P0 / In flight / Next actions" sections below are historical and superseded by the Current checkpoint above.)_
