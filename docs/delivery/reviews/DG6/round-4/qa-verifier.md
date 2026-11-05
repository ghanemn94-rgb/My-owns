# DG6 round 4: qa-verifier narrative (T-DG6-REV-QA-R4)

The candidate is `sha256:4b84bf201d45d0b78b6c5fdb856e7c52df69bf62a1b709176d786c207cba1b5b` (2732 files), source
`654e39d89b66c0975ebef293d607f480f58408e3`. I recomputed it on a full clone and again in the repository at HEAD
`2efdc024`. Evidence is in `docs/delivery/test-evidence/DG6/qa/round-4/` and my probes are in
`docs/delivery/test-evidence/DG6/qa/tests/round-4/`. Every run used a disposable clone under `$TMPDIR`.

## Verdict: PASS

- **F-DG6-260 is CLOSED_VERIFIED.**
  - The four register rows now have a T-DG6-AN-Z2 check, and the stale clauses are superseded.
  - The check script exits 0 on this candidate. It exits 1 on the reverted (round-3) register, which is the mutant.
- **F-DG6-261 is CLOSED_VERIFIED.**
  - Both parts of the repair hold on their own: the filter label, and the scoped, waiting spec step.
  - With the definitions delayed, the round-3 locator and the new one both pick the Generate form.
  - Reverting both parts (mutant M2) reproduces the round-3 failure, so the probe catches it.
  - The real spec passed 8 of 8 executions.
- **Full review.** Every candidate test passes in both languages and both locale settings, once re-run where needed.
- **Open question 1 (problem codes).** The HTTP problem codes and field-error codes are covered.
  - The scan found one gap: two operational-exception codes (`kpi.stale`, `operations.heartbeat_missed`) have no
    catalogue text.
  - For those, the exception page's "Last error" shows the raw code in en and ar.
  - That is **F-DG6-320** (Low, cosmetic, not blocking).
- **Open question 2 (`p3-ui-completion`).** It passes in both locales.
  - The deliverable-count warning reads correctly in both languages: LTR in English, RTL in Arabic.
  - It shows at 0 and 8 deliverables and not at 3 or 7. It is never a block.

## Disclosed non-zero exits (each explained in the record)

- **The shared root disk filled up (ENOSPC)** during the first unit C.UTF-8 run and the first unset English product
  chunks. Chromium crashed ("Target crashed", "Unable to capture screenshot") and some tests timed out.
  - I freed 2 GB by making the clone borrow git objects from the repository (`git repack -l`).
  - Every affected chunk or file was then re-run, and passed.
- **Load-only unit artifacts:**
  - Vitest "Timeout calling onTaskUpdate", with every test passing. It passes at low load.
  - A 1 s `waitFor` in `valueHeadlines.test.tsx`. The file passes alone.
- **My own probe defects, each fixed and re-run:**
  - The exception probe omitted `organizationId`.
  - The deliverable-count probe had a race.
  - The known marker-based `demo-keyboard` probe failed. `walkthrough-crumbs` refutes it in the same runs.
- **`export-proof`'s LOAD-T20 dataset gap**, which the register already discloses.

The assignment says `round: 3`. This record uses `round: 4`, because the validator requires the round to match the
`round-4/` directory.

All data is synthetic. The load figures are provisional engineering measurements from one shared sandbox host, not
Mobily capacity. Nothing here is a G1–G6 business approval, and product G6 never implies DG7.
