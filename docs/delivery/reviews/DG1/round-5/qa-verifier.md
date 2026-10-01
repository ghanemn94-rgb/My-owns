# DG1 round 5: qa-verifier narrative

**Verdict: PASS.** Candidate `sha256:24eb377939d83b7036e992e647f390b91e030cd6aa18b805b74dea900d50b08e`, freeze commit `5f83a33`. No new findings.

## Candidate identity
I recomputed the candidate ID three times and got the same value each time: in the repository at HEAD `d3fcb89` (`--diff` matches), at `--ref 5f83a33`, and again after HEAD moved to `9815456`. The later commits are other reviewers' auto-committed run evidence, which the candidate excludes. I didn't open them. All code ran in disposable clones under `$TMPDIR`.

## What ran (real output)

| Area | Result |
|---|---|
| Frozen offline install (scratch copy of the local store) | exit 0, lockfile up to date, 0 downloads |
| typecheck / build / lint / openapi:lint (33 ops) / no-cdn / format:check / contrast | all exit 0 |
| Unit (`pnpm test`) | 267/267 |
| Integration ×3, fresh PostgreSQL 16.13 each (port 5492) | 200/200 each, exit 0; no 57P01 or terminating-connection lines in the server logs |
| Independent audit-trigger probe (psql) | migrations 0001–0008; UPDATE/DELETE/TRUNCATE rejected for superuser and owner (trigger) and mth_app (privilege) |
| e2e EN+AR, `--workers=1`, PG 5493 | 22/22; axe 0 violations (15 pages per language) |
| A12/A13/A14 | 14/5/5 green in every integration run |
| A18 clean start (`--install`, production config) | PASS |
| A20 token propagation (separate copy) | PASS |
| Worker-stop probe (REQ-S16-001) | worker exits 0 on SIGTERM; the API stays ready and serves an authenticated session |
| validate `--register DG1` / `--pipeline` / `--reconcile` | PASS |
| check-ci-needs; 3× ci.yml identical | OK |

## Findings verified
- **F-DG1-211: CLOSED_VERIFIED.** The cited log is the 13-case suite. Its labels match the script 1:1, and it was generated after the suite's last change.
- **F-DG1-122: CLOSED_VERIFIED.** I planted developer files at every AC-8 path and they survived byte-identical. As a negative control, the pre-fix script deleted all five of them.
- **F-DG1-009 and F-DG1-210: still hold.**

## BLOCKED, not counted as PASS
- The installer suite's **AC-1 (effect)**, as written, needs registry metadata, and this sandbox has no network (ECONNREFUSED). Its offline equivalent, run through the unchanged wrapper, passes.
- **`pnpm deps:verify`** (not assigned) needs the registry.
- **A24 live CI run** (REQ-DLV-025): there is no GitHub Actions access here. The static dependency check passes, and the register notes record that a live run has not been observed.

## Observations (no finding)
- The REQ-DLV-042 notes column still carries the historical remark "acceptance suite 7/7" from T-DG1-REG. The cited evidence is current.
- REQ-S16-004's A19 restore drill belongs to DG7, as the register notes state.
- Two of my own probes needed corrections (an empty audit table, and missing CLI environment variables). Only the corrected runs are recorded as evidence.
