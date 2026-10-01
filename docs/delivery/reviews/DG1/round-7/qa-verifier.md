# DG1 round 7: qa-verifier (T-DG1-REV-QA-R7)

**Verdict: PASS.** No new findings.

- **Candidate:** `sha256:d3743a352912a357b0a81124794561cea5f06f5dbc31542b9623c68c47649ab7`.
- **Commits:** freeze commit `a6bdea0`, HEAD `2cfbf4f`. Between them only candidate-excluded metadata changed. The candidate ID recomputes identically in the repository and in a full, non-shallow disposable clone.
- **Run reference:** `DG1-T-DG1-REV-QA-R7-qa-verifier-20261001T125644Z-5b3f1b08`.

## Fixes verified (sidecar: `qa-verifier.verifications.json`)

| Finding | Result | Key evidence |
|---|---|---|
| F-DG1-127 (Low, REQ-S16-003): node:sqlite loader route | CLOSED_VERIFIED | Probe 16/16 (all sqlite import forms reported; regressions caught; control clean). Negative control with the pre-fix testkit: exactly A1 fails (77/78). A real planted `node:sqlite` import in `modules/access` turns the module-tree check red; with it removed, 78/78. Since round 6 the change touches only the testkit and its test (plus decisions.md). |
| F-DG1-212 (Low, REQ-DLV-042): stale installer log | CLOSED_VERIFIED | The cited log holds 14 PASS lines, 0 FAIL and exit=0, and its labels are identical to the frozen suite's `ok` labels (diff exit 0). It was regenerated after 3037ce2, and `tools/deps` is unchanged since then. My own run: 13 PASS including AC-10. AC-1 (effect) is BLOCKED (ECONNREFUSED, no registry); its offline equivalent passes. |

## Checks (all in disposable clones under `$TMPDIR`, removed afterwards)

| Check | Result |
|---|---|
| typecheck / build / lint / format / no-cdn / contrast | PASS |
| openapi:lint | PASS (33 operations) |
| Unit | 271/271 (architecture 78/78) |
| Integration, twice (PG 16.13, port 5492) | 200/200 in both runs; 0 57P01 in the server logs (F-DG1-009 holds); 8 migrations; A12/A13/A14 green |
| Audit trigger | append-only for the superuser and the owner; app DELETE denied |
| Contract test | 9/9, including getBrandingTokens |
| e2e (Chromium, `--workers=1`, port 5493) | 22/22 in EN and AR, including F-DG1-210. My independent F-DG1-210 spec passes 2/2. |
| A18 clean start | PASS |
| A20 token propagation | PASS |
| `validate.mjs --register DG1` / `--pipeline` / `--reconcile` | PASS |
| The 12 DG1-final requirements | IMPLEMENTED, with all cited evidence present |

## Blocked checks (environment, no registry network)

- **Whole-suite installer run:** exit 1 here, from AC-1 (effect) alone.
- **Live-registry AC-1 (effect):** BLOCKED; the offline equivalent passes.
- **`pnpm deps:verify`:** not assigned; BLOCKED.

## Observations (not findings)

1. The A1 self-check title carries the template text "(round-4 lint: 'missed')". This is cosmetic.
2. The notes cell of the REQ-DLV-042 register row still contains the historical analyst remark "acceptance suite 7/7 (T-DG1-REG)". It is a dated task note, not the cited evidence.

## Scope of my writes

- Evidence under `docs/delivery/test-evidence/DG1/qa/round-7/`.
- One new probe: `docs/delivery/test-evidence/DG1/qa/tests/dg1-r7-sqlite-import-probe.test.ts`.
- These round-7 `qa-verifier.*` files.

I made no product changes. I did not read any other round-7 reviewer's record.
