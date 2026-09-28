# DG0 round 3: qa-verifier narrative

- **Candidate:** `sha256:31fd0843977d30afd4459591abdfd730c5c994440030816188227d9f6ec4cbf9` @ `540b3c69`. HEAD `4af07b0` is a metadata-only descendant, and the recomputed ID matches.
- **Run:** `DG0-T-DG0-REV-QA-R3-qa-verifier-20260928T140336Z-414fe1d7`.
- **Verdict: PASS.**

## What ran (disposable worktrees `/tmp/review-qa-r3` @ 540b3c69 and `/tmp/review-qa-r2old` @ 83860be, both removed afterwards)

| Check | Result |
|---|---|
| `check_extraction.sh` | PASS |
| `tools/gates/tests` | 24/24 |
| `tools/agents/tests` | 13/13 |
| `validate.mjs --register DG0` | exit 0 |
| `validate.mjs --pipeline` | exit 0 |
| `validate.mjs --reconcile` | exit 0 |
| `candidate.mjs` (working tree and `--ref`) | matches |
| My round-3 negative suite `dg0-gate-negative-r3.test.mjs` | 27 pass, 0 fail, 1 todo (F-DG0-208) |
| Register integrity script | 0 errors |
| Agent load evidence | 10/10 |
| Live guard probe | 3/3 blocked |
| Acceptance feasibility | 28/28 |
| Analyst consistency tools | 0 problems |

The round-3 negative suite covers the full assigned A24/A25 rejection list plus 12 cases that aren't in `tools/gates/tests`.

## Re-verification of my findings

- **F-DG0-204, F-DG0-205, F-DG0-206:** reproduced against 83860be and fixed in 540b3c69. All CLOSED_VERIFIED.
- **F-DG0-207:** the stale test titles are gone, and every cited title resolves. CLOSED_VERIFIED.

## New findings (all Low, all acceptable as observations)

- **F-DG0-208:** round `frozen_at` and committed review records can be rewritten in place; only deletions are detected (probe QA3-N20).
- **F-DG0-209:** D-005 and the REQ-DLV-022 procedure still state the old `<sha256>  <path>` line format.
- **F-DG0-210:** agents.md says 3 resumes; D-019 and the runner say 6. This may overlap F-DG0-114.

Promotion note: `docs/delivery/test-evidence/DG0/qa/tests/dg0-gate-negative-r3.test.mjs` is intended for `tests/qa/dg0/`. It uses `QA_REPO_ROOT` or the enclosing git root.
