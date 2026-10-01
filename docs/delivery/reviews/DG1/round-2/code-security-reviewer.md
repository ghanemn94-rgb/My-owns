# DG1 round 2: code-security review (T-DG1-REV-SEC-R2)

**Verdict: PASS.**

- **Candidate:** `sha256:e6979e12111aeb1456f591d66f8437d9f491c7e8e58215ea7c5a9f233cbfe71d`, source `485e91f`, 394 files.
- **Run:** `DG1-T-DG1-REV-SEC-R2-code-security-reviewer-20261001T214241Z-14876631`, session `14876631-…`.
- **Machine-readable record:** `code-security-reviewer.json`.
- **Finding closures:** `code-security-reviewer.verifications.json`.

The first turn of this session stopped on a permission-classifier outage (`CLASSIFIER-BLOCKED`) before any check ran. Every result below comes from the resumed run.

## Round-1 findings: re-verified adversarially, all CLOSED_VERIFIED

| Finding | Sev / mandatory | How it was verified |
|---|---|---|
| F-DG1-140: BU cycle under concurrency | Medium / yes | **Round-1 repro, unchanged:** no longer reaches the cycle, because the second PATCH queues on the hierarchy lock.<br>**Round-2 repro (7/7):** API concurrent gives 200 + **422 cycle** and 0 cycles. Direct SQL as `mth_app` gives **23514** at READ COMMITTED and **40001** at REPEATABLE READ. A single-statement swap gives 23514. `mth_app` cannot disable the guard (42501 ×3). |
| F-DG1-141: destination not authorized | Medium / yes | **Round-1 repro:** the move is now **403** and the sibling auditor still gets 404.<br>**Round-2 repro:** sibling, deep-sibling and top-level moves all get 403 (an audited `authorization.denied`). Another organization gives 422, the same as a nonexistent unit. The in-scope move gives 200. |
| F-DG1-142: limiter keyed on raw cookie | Medium / no | **Round-1 bypass:** now `{"429":50}`.<br>**Round-2 repro (4/4):** rotating fake cookies is limited after 3 requests. Rotating X-Forwarded-For is limited. Sessions share a per-user bucket. A flood does not starve a valid session. A logged-out cookie falls back to the IP bucket. |
| F-DG1-143: ajv codegen lint bypass | Low / no | **The plant:** now flagged, and the architecture suite fails.<br>**Import variants:** 13 tried, all flagged.<br>**Framing:** ajv and ajv-formats really are still transitive fastify runtime dependencies. yaml is dev-only and correctly classified as development. |
| F-DG1-144: flaky web test | Low / no | 18/18 parallel runs passed under build load. |
| F-DG1-145: views undocumented | Low / no | All 3 views are documented and their columns match `SCHEMA_COLUMNS`. No stale `schema.test.ts` reference remains. |
| F-DG1-146: D-057 said 14/14 | Low / no | D-057 now says 13/14. Re-run result: 13 PASS; the only FAIL is AC-1 (effect), and the registry ECONNREFUSED was reproduced. |

## Checks

All of these ran on Node 22.22.2 and passed:

- typecheck, build, lint, OpenAPI lint, no-CDN check and format check;
- unit tests: 326/326 on Node 22, and again 326/326 on Node 24.21.0;
- integration suite twice on fresh disposable PostgreSQL 16.13 clusters (ports 54861 and 54862): 209/209 each time, 9 migrations;
- gate/agent tooling tests: 105/105;
- deploy script tests: 59/59;
- the three `ci.yml` copies are byte-identical, and `check-ci-needs` is OK for each;
- install-sandbox: 13/14 offline;
- SBOM check: OK;
- DG0 historical validation: PASS;
- secrets scan: clean.

The repair diff does not touch the gate tooling, agent definitions, CI or source documents.

**Environmental residuals.** These are disclosed, not BLOCKED checks:

- **D-057:** the AC-1 live-registry install effect.
- **D-058:** the live GitHub Actions execution.

**Environment note.** Initialising PostgreSQL as root is refused, and each shell command has its own network namespace. So `with-pg.sh` starts a TCP-only cluster in a nested user namespace mapped to uid 1000 for the length of one command.

## New findings

None.

## Observations (not findings)

1. **403/422 existence difference.** Within one organization, an out-of-scope unit that exists gives 403, while a nonexistent ID gives 422. This is not a practical enumeration oracle: the IDs are UUIDv7 with 74 random bits, and different organizations stay indistinguishable.
2. **Direct-SQL deadlock.** A direct-SQL writer that interleaves a row lock with the trigger can deadlock (40P01). That fails closed.
3. **REPEATABLE READ depth residual.** The depth-only residual under REPEATABLE READ is stated in the migration header.
