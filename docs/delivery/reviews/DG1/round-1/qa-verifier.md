# DG1 round 1: qa-verifier narrative (T-DG1-REV-QA-R1)

- **Candidate:** `sha256:25c97340b6047e87e82642c28e90dea72cdd07b5bbd5d81986f497e5e863061b` (391 files), source commit `37ec374`. I recomputed it from the working tree, from `--ref 37ec374` and from `--ref HEAD` (HEAD `e728d4d` adds only review/run metadata), at the start and again at the end.
- **Session:** `69564131-f43f-4d4c-a03a-2652eaf171ec`, run `DG1-T-DG1-REV-QA-R1-qa-verifier-20261001T204730Z-69564131`.
- **Verdict: PASS.** Two checks are BLOCKED by the environment (see below). Two findings, both Low and non-mandatory.
- **Independence:** I wrote no implementation, and I formed this verdict without opening any other round-1 review record.

## How it was run

All code ran in a disposable clone (`$TMPDIR/review-qa`, commit `37ec374`). Dependencies came from `pnpm install --offline --frozen-lockfile` against a copy of the local pnpm store, because the original store is under the read-only HOME. Every PostgreSQL was a throwaway 16.13 cluster on its own port (55711–55741). Chromium came pre-installed from `/opt/pw-browsers` (nothing was downloaded). Logs are in `docs/delivery/test-evidence/DG1/qa/round-1/`; each starts with its command and ends with `# exit_status`. Screenshots and axe summaries are in `screenshots/{en,ar}/`. The two new tests are in `docs/delivery/test-evidence/DG1/qa/tests/`, so the frozen candidate is unaltered.

## Results (assignment steps)

| Step | Result |
|---|---|
| 1. Build and static checks | typecheck, build, lint, OpenAPI (3.1.1, **33 ops**), no-CDN, format and contrast all exit 0 |
| 2. Unit | Node 22: **325/325**; Node 24: **325/325** (unit-web green) |
| 3. Integration ×2 | **200/200** and **200/200**, exit 0; no 57P01 error and no hook timeout. Independent probe: migrations 0001–0008 apply and re-run as a no-op. `audit_event` UPDATE/DELETE/TRUNCATE is rejected for mth_app (privilege), mth_owner and the superuser (trigger). Contract 9/9 including getBrandingTokens. |
| 4. e2e | journeys **18/18** EN+AR, including the BU-Lead create→Edit/Archive and audit trail without a reload; 0 axe violations on 15 screens per language; second run 22/22 with A20 |
| 5. Acceptance | A12/A13/A14 **24/24**; A18 clean start **PASS** with a real frozen offline install; A20 bilingual shell and tokens PASS; A20 token propagation PASS, with a **negative control** that fails as it should |
| 6. Register and pipeline | `--register`, `--pipeline` and `--reconcile` all PASS |

Additional independent checks:

- **Black-box API probe, 30/30.** CSRF and Origin, validation, defaults, Arabic round-trip, If-Match 428/409, five racing writers giving exactly one 200, archive reason and read-only state, audit version steps, role denials, provisional branding and logout.
- **Worker-stop probe for REQ-S16-001.** This criterion previously had no automated test. The worker stops cleanly on SIGTERM and the API stays ready and accepts writes.
- **CI-needs mutations for REQ-DLV-025.** Two negative mutations of the workflow are rejected by the checker.

My first attempts at the DB probe and the black-box probe had bugs in the probes themselves. Their logs are kept (`*-attempt1-probe-bug.log`) with an explanation.

## BLOCKED (environment, not product)

1. **QA-R1-16, A24 live CI run (REQ-DLV-025).** There is no GitHub Actions runner and no network here. Only the static needs-graph rules and their negative mutations were verified.
2. **QA-R1-18, install-sandbox AC-1 (effect) (REQ-DLV-042).** `create` needs registry metadata, and the wrapper's namespace cannot reach the proxy (`ECONNREFUSED 127.0.0.1:3128`). The other 13 cases pass here. The orchestrator's 14/14 log was produced on a byte-identical installer and test (sha256 compared).

Under `tools/gates/lib/rules.mjs`, any non-PASS check blocks the gate. The orchestrator therefore has to either produce the missing live evidence or record a decision about these two items. I have not marked them PASS.

## Findings

- **F-DG1-230 (Low, non-mandatory; REQ-S19-004).** The views `actor_display`, `business_unit_closure` and `scope_node`, which the access policy depends on, are created by the migrations but are documented in neither `data-dictionary.md` nor `erd.md`. All tables and columns are documented.
- **F-DG1-231 (Low, non-mandatory; REQ-DLV-033).** The register rows REQ-DLV-033 and REQ-S19-004 cite evidence from another candidate (991d3241). REQ-DLV-033's notes also make IMPLEMENTED conditional on F-DG1-108/203/208, which do not exist in `findings.json` for this clean re-gate. On the frozen candidate the substance is green; this round's logs show it.

All data used was synthetic. No business, Finance or IT approval is implied, and product gate G6 is unrelated to this engineering gate.
