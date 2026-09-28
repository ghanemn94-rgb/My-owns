# Delivery progress checkpoint

_Updated by the delivery-orchestrator at every step change. On resumption, run `node tools/gates/validate.mjs --reconcile` and `--pipeline` first. Then reconcile this file with `stages.json`, `findings.json` and the latest review round before assigning any write task._

## Current checkpoint

- **Active stage:** P0 / DG0, state **REVIEWING** (round 4)
- **Round-4 candidate:** `sha256:0be571eaa84438604b9b4095b7a2bb26086a340b1a34ab2b56aba3a148d3a3b7` (commit `53f5d17`). The manifest is `docs/delivery/candidates/DG0/0be571eaa8443860.manifest.json`.

**Review history**

| Round | Outcome | Findings |
|---|---|---|
| 1 | domain FAIL · code-security BLOCKED (classifier outage) · QA FAIL | 17, including 2 High |
| 2 | domain PASS · code-security FAIL · QA FAIL | 15 verified closed; 11 new, including 1 High |
| 3 | domain PASS · QA PASS · code-security FAIL | 15 verified closed; 7 new, including 1 High |

- **Total so far:** 35 findings. 27 were closed by round-2/3 verifications, and 8 were fixed pending verification. Because rounds 1–3 predate run-output binding (D-021), round 4 re-confirms every closure.
- **The main hardening came from these reviews:**
  - provenance bound to complete run evidence;
  - reviewer artefacts bound to their run's outputs and write-once in git history;
  - finding closure and acceptance only through reviewer sidecars;
  - a candidate identity that includes file modes;
  - a write guard with a fixed root that follows symlinks.
- **Next:**
  1. Import the round-4 results.
  2. If all three reviewers PASS with every finding terminal, run the release audit, adding the auditor record to the round-4 `review_rounds` records.
  3. Otherwise, run repair and round 5. After three unproductive cycles, do a root-cause review per §0.4.

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

None yet.
