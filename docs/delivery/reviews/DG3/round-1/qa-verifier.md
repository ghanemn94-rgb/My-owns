# DG3 round 1: qa-verifier narrative

**Verdict: PASS. No findings.**

- Candidate: `sha256:873115d9…9c33` (753 files), source `928b7654`.
- Every check ran in one disposable clone under `$TMPDIR`, which I removed at the end.
- Other reviewers' round-1 records: not opened.

## What ran

| Area | Result |
|---|---|
| Static: typecheck, build, lint, OpenAPI (270 ops), no-CDN, Prettier, contrast | all exit 0 |
| Unit: Node 22 and 24 × locale unset and C.UTF-8 (plus two extra ar_SA runs that fall back to C) | 80 files / 1528 tests each |
| Integration ×2 (Node 24 C.UTF-8; Node 22 unset) | 56 files / 791 tests each; 27 migrations; every pending list empty, so all 270 operations are routed and exercised |
| e2e on the real stack: 11 product specs, A20 and my `dg3-qa-r1.spec.ts`, chromium-en and chromium-ar, both locale settings | 200/200 per setting |
| Final version of my spec alone, both settings | 28/28 per setting; 117 recorded checks per project, 0 failed |
| `validate --register DG3`, `--pipeline`, `--historical` DG2 and DG1 | all PASS |

## My independent spec

`docs/delivery/test-evidence/DG3/qa/tests/round-1/e2e/dg3-qa-r1.spec.ts`

**How it works**
- It drives the public HTTP API with CSRF, Origin, If-Match and Idempotency-Key.
- Each role is a distinct synthetic user: TL dev.lead, SP, FIN, BO and ADM_METHOD, with AUD dev.auditor as the read-only user.
- It walks one End-to-End transformation through every DG3 acceptance text, literally.
- The G1–G3 *record* fixtures are borrowed from the product's e2e support. Every DG3 assertion is my own.
- Each check is recorded as JSON under `round-1/results/`.

**Highlights**
- **Scoring:** 5,4,3,2,1 gives `3.3000`, shown as 3.30 and 57.5 with the conversion label.
- **Weights:** totals of 95% and 105% give 422 and write nothing. v2 rescoring gives 2.90. Snapshot 1 keeps v1 and 3.3000. The history says 'weight version 2'.
- **Launch sequencing:** before G2/G3, with G2 pending and after G2 only, launch gives 422 with the exact text 'North Star, outcomes and target state not yet approved'. After G3 it succeeds.
- **Selected - unfunded:** a selected initiative without funding cannot launch even after G2/G3 (`initiative.selected_unfunded`).
- **Cycles:** both are refused, named as `INI-03 → INI-02 → INI-03` and `INI-04 → INI-02 → INI-03 → INI-04`. Needed-by and before-predecessor are both flagged.
- **Formulas:**
  - revenue example: `100000` SAR, exact;
  - cost example: `151852.11`, exact;
  - annual population × monthly ARPU: 422 `formula.period_mismatch`.
- **Business case:** the roll-up counts each line once (3300.6 → 3400.7 after an edit, 3 lines).
- **G4:**
  - the refusal names the initiatives and lists 'Finance validation', and writes nothing;
  - deciding your own submission: 403;
  - a non-approver: 403;
  - a superseded submission: 409;
  - approved by the SP: phase Transform.

## Disclosures (details in `test-evidence/DG3/qa/round-1/RUN-NOTES.md`)

1. **A detached first launch of integration run 2 was killed with its parent shell.** It produced no result and was rerun properly.
2. **The first full-e2e attempt exited 1 before any test ran.** The positional filter `e2e` also matched archived DG2 specs under `docs/`. The corrected run passes an explicit list of spec files, and its logs replaced the failed ones.
3. **Trials 1–6 of my spec failed only on my own test defects.** Each one is described in RUN-NOTES.md.

## Observations (not findings)

- **Check order:** a submitter of the *current* G4 submission who tries to decide a superseded one gets 403 before the version check. Both outcomes refuse.
- **G4 API message:** the aggregated per-criterion message repeats the label, for example 'Finance validation Finance validation …'. The UI renders the items one by one (D-079).
- **Test scratch:** the integration suites leave many `mth-evidence-it-*` directories in `$TMPDIR`. This is test hygiene, not product behaviour.
- **Residuals not verified here:** live registry, live CI and a real Keycloak. They are not DG3-final requirements.

Product gates G1–G6 are business approvals inside the product. Every approval in these tests is a synthetic demo decision that approves nothing real.
