# DG3 round 1: code-security-reviewer narrative

- **Task:** T-DG3-REV-SEC-R1.
- **Session:** afa637ec-0d6b-41c4-9ae4-bcec62c0e5cf.
- **Candidate:** `sha256:873115d9bc84f763d8ec0670f0e5e320b013dc26faba6e3026395b09ed5c9f33`, 753 files, recomputed. The source is 928b765; HEAD ec45ef1 adds only the freeze metadata.

**Verdict: PASS.** I raised one new Low, non-mandatory finding, **F-DG3-100**. I found nothing Critical, High or mandatory.

## What I ran

All of it ran in disposable clones under `$TMPDIR`. Every clone was deleted afterwards.

| Step | Result |
|---|---|
| build, typecheck, lint, openapi:lint (270 operations), check:no-cdn, format:check | all exit 0 |
| unit on Node 22 / Node 24 | 1528/1528 each, exit 0 |
| integration, LANG unset (SQL_ASCII) / LANG=C.UTF-8 (UTF8) | 791/791 each, exit 0; migrations 0001→0027; contract.test.ts with all 270 operations; every p3-pending list empty |
| validate --historical DG2 / DG1 | PASS |

**Harness error (disclosed).** My first integration attempt exited 126 before any test ran. The helper was not executable: the Write tool does not set the execute bit. I re-ran it with `bash with-pg.sh`. Both logs are kept.

**Warnings.** The two warnings in the logs are both already present in DG2 r17:

- Vite's chunk-size advisory;
- Fastify's FSTDEP022 deprecation notice.

## Reviewer probes

The probe sources are in `docs/delivery/test-evidence/DG3/code-security/round-1/probes/`. They ran on Node 22 with LANG unset and on Node 24 with LANG=C.UTF-8.

**Probe A: AUD sweep.** The sweep is generated from the contract and covers all 64 P3 mutating operations. It runs against records created by the seven exercise seams.

- Every call that has a target gets 403 and writes exactly one `authorization.denied` event.
- Every row of the 29 P3 tables is unchanged: a checksum taken before and after the sweep matches.

**Probe B: integrity, run below the API as `mth_app`.**

- **Separation of duties.** The database refuses six separation-of-duties bypasses, each with its named CHECK.
- **Guards cannot be switched off.** Every attempt is refused with 42501: `session_replication_role`, DISABLE TRIGGER, DROP CONSTRAINT, and replacing a guard function.
- **Cycle races.** Raw-SQL races of A→B against B→A: 25 out of 25 commit exactly once. The losing transaction names the cycle.
- **Other cycles.** Closing a 3-cycle, un-archiving an edge into a cycle, and re-pointing an edge into a cycle are all refused, naming the cycle.
- **Weights.** Totals of 95%, 105% and 99.99% get 422 with the exact text, and nothing is written. A weight with three decimals gets 400 and is never rounded.
- **No on-behalf decisions.** `onBehalfOfUserId` gets 400 on weight-set approval, on both Finance validations and on override revoke. This adds to the suites' 422s on selection, funding, override decision and dispensation.
- **Audit shape.** All 282 audit events that carry changes have the `{from, to}` shape for every member.

**Probe C: the formula engine under hostile input.** It covers injection strings, size and depth limits, division by zero, 20,000 fuzz strings, and an exact BigInt-rational oracle. The engine never throws, never evaluates anything outside its grammar, and the 2,853 oracle-checked trees match exactly.

## F-DG3-100 (Low, non-mandatory; owner kpi-benefits-engineer)

ADR-0024 §6 says an ESLint override "enforces" that the formula engine runs no dynamic code, and a source scan backs it up. Both guards still accept these forms:

- `Reflect.construct(Function, …)`;
- `Reflect.apply(Function, …)`;
- an aliased `const F = Function; F("…")`;
- a computed `["constructor"]("…")`;
- `createRequire(import.meta.url)("vm")`.

I placed these forms inside `evaluate.ts` in a disposable clone: eslint exited 0 and the scan passed. The engine as shipped contains no dynamic code, so this is a guard-coverage gap, not an exploitable defect.

A suggested fix:

- ban the `Function` identifier, `Reflect.construct`/`Reflect.apply`, `createRequire`/`require`, and computed `constructor` members in the override;
- add the same patterns to the scan.

## Observations (not raised)

- **G4 submit and decide.** These are DG2-approved P2 routes and still authorize on the principal resolved at preValidation, not with `refreshPrincipal`. Every one of the 109 P3 operations re-authorizes at commit time.
- **Delegation kept by design.** ADR-0021 §6 keeps one-hop delegation for two record-owner decisions: the G4 gate decision and deliverable acceptance. Neither lets the submitter decide, in person or through a delegate.
- **Finance baseline author.** For separation of duties, the baseline's author is the case's `created_by`. ADR-0024 §5 documents this decision.

I approve nothing: product gates G1–G6 are business approvals inside the product and are unrelated to DG0–DG7. All data was synthetic.
