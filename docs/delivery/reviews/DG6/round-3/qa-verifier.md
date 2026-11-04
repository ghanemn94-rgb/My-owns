# DG6 round 3: qa-verifier narrative (continuation run T-DG6-REV-QA-R3B)

Candidate `sha256:aa219bd2e60c986ea7cf03665a9940e15be05931b26b4b8ddc7ca9918c41cb14` (2729 files), source
`95f981917e4e5572f954d7cd159d869eca142bff`. This run continues the stopped run
`DG6-T-DG6-REV-QA-R3-qa-verifier-20261104T123608Z-01cb5eae` (exit 143, container restart) on the same candidate. The
stopped run's evidence (`docs/delivery/test-evidence/DG6/qa/round-3/00-*` to `22-*`) and its
`qa-verifier.verifications.json` are kept as they were written. This run adds the files numbered `30-` to `40-`.

## What this run did

1. **Candidate.** I recomputed the candidate ID on a full (non-sparse) clone at the source commit, and again in the
   repository at HEAD `30cbe375`. Both give `aa219bd2…` over 2729 files. HEAD differs from the source commit only under
   `docs/delivery/` (`30-r3b-candidate-and-setup.log`).
2. **Explained every non-zero step of the stopped run** (its `summary.txt`), from the logs, in the record's checks:
   - unit timeouts under load;
   - 4 load timeouts in `response-validation.test.ts` (integration run 1, half A);
   - three probe defects (XSS search without a worker, a ligature in the Arabic-PDF probe, a marker-based keyboard
     probe);
   - the mutants, which fail by design;
   - two mutant files deleted mid-run;
   - the `a02-demo-users-walkthrough` 300 s timeout.

   I reproduced the last one deterministically. Its cause is an ambiguous `Output` label in the spec (F-DG6-261).
3. **Finished the steps the stopped run did not complete:**
   - the REQ-S20-029/030 load and async-export measurement, which was interrupted mid-workload (`31-load*`);
   - the full unit suite on Node 24 and Node 22, in both locale settings, on the now quiet host (`40-unit-*`);
   - `validate.mjs --register DG6` and `--pipeline` at HEAD (`34-validate-r3b.log`);
   - the follow-up probes:
     - axe, reflow and the AUD pass on the two P6 detail screens no suite opens (`32b`);
     - the walkthrough breadcrumb and region keyboard check (`33c`).
4. **Verifications.** The stopped run's three verifications (F-DG6-144, F-DG6-200 and F-DG6-201 CLOSED_VERIFIED)
   were re-read against their logs. I agree with each, and the record says so in check QA-R3B-VERIF.

## Findings raised (both Low, non-mandatory, not blocking)

- **F-DG6-260.** The register notes of REQ-S20-001, -012, -017 and -022 still report suites that are failing or
  absent. On this candidate those suites are present and pass. This is documentation drift of the F-DG6-201 class.
- **F-DG6-261.** Step 10 of `e2e/a02-demo-users-walkthrough.spec.ts` selects the report output through a label that
  two selects share. When the report definitions answer late, the step selects the snapshot filter, the Generate
  button stays disabled, and the test hangs for 300 s. This is a test-side race of the F-DG6-200 class.

The verdict and every check are in `qa-verifier.json`. All data used is synthetic. Nothing here is a G1–G6 business
approval, and product gate G6 never implies DG7.
