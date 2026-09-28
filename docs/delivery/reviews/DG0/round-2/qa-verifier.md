# DG0 round 2: qa-verifier narrative

- **Candidate:** `sha256:d47b51caa83c28b068da75895b530e9b59d12b7ddb3356bf4aa1d71ad23c76c3`
- **Source commit:** `83860be`
- **Run:** `DG0-T-DG0-REV-QA-R2-qa-verifier-20260928T132727Z-633e04f1`
- **Verdict: FAIL**, on one Medium finding that is a mandatory violation.

This run was interrupted twice because the permission classifier gave no verdict, and the session was resumed each time. Every result below comes from commands executed after the resumption. The logs are under `docs/delivery/test-evidence/DG0/qa/round-2/`.

## Verification of my round-1 findings

| Finding | Reproduced on @26642c7 | Result on @83860be | Status after |
|---|---|---|---|
| F-DG0-201: review bound to an unrelated run | QA-N27, QA2-R201 and R201b accepted | rejected (assignment mismatch; started before freeze) | CLOSED_VERIFIED |
| F-DG0-202: bare evidence file name not checked | QA-N28 accepted | rejected; every evidence entry goes through `repoFile` | CLOSED_VERIFIED |
| F-DG0-203: test authorship later than the gate | (docs) | ownership table consistent for 28/28; independent script finds 0 errors | CLOSED_VERIFIED |

## New findings

- **F-DG0-204 (Medium, mandatory).** `rules.mjs:417` checks a finding's `verification.invocation_reference` with no assignment or time binding. A `CLOSED_VERIFIED` finding can therefore cite the verifying role's pre-freeze `T-DG0-LOAD` run and still pass the gate (QA2-N11). `agents.md` line 32 (D-016) claims that this case is rejected. This is the F-DG0-201 defect class on the verification path.
- **F-DG0-205 (Low).** Evidence that is a symlink inside the repository pointing outside it is accepted (QA2-N12).
- **F-DG0-206 (Low).** The file mode (the executable bit) is not part of the candidate identity (QA2-N14).
- **F-DG0-207 (Low).** The acceptance text of REQ-DLV-013 and REQ-DLV-026 cites two validator test names that no longer exist verbatim.

I would accept the three Low findings as observations.

## Positive results

- All seven assigned commands pass:
  - extraction check;
  - gate tests 20/20;
  - guard tests 11/11;
  - `--register`, `--pipeline` and `--reconcile`;
  - the candidate command.
- **Register:** 411 rows with 0 integrity errors. The counts per gate equal the stage plan, there are no declared VERIFIED rows, and both coverage matrices are complete (165/165 and 423/423).
- **Agents:** the raw evidence shows 10/10 definitions loaded in distinct sessions on `claude-opus-5-5`, out-of-scope writes blocked and in-scope writes succeeding. I re-checked the guard live in this session: writes to `docs/source/QA-PROBE.txt` and `tools/gates/QA-PROBE.txt` were blocked.

## Test promotion

`docs/delivery/test-evidence/DG0/qa/tests/dg0-gate-negative-r2.test.mjs` should be promoted to `tests/qa/dg0/`:
- 19 cases in total: 3 regressions for F-DG0-201 and F-DG0-202, and 16 new cases, of which N14 is informational only.
- QA2-N11 and QA2-N12 currently fail. They are the regression tests for F-DG0-204 and F-DG0-205.

The round-1 file `dg0-gate-negative.test.mjs` needs its fixture updated to the round-2 run-evidence format and message wording before promotion. Otherwise it is superseded by the round-2 file.
