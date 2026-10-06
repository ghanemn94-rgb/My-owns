# DG2 round 3: code-security-reviewer narrative (T-DG2-REV-SEC-R3)

**Verdict: PASS**

- **Candidate:** `sha256:b98c44db7ef91295eec25a21cbd394a91890b01caeeb6bfd269eb1ee6d132be5`, 519 files, recomputed.
- **Source commit:** `9e13947e`. HEAD is `6245903`, which adds only delivery metadata on top of it.
- **Session:** a828d9b1.
- **Independence:** I authored no DG2 implementation. I did not read any other reviewer's round-3 record.

## F-DG2-143 (Low, REQ-S16-001): CLOSED_VERIFIED

I checked the fix adversarially.

**Explicit timeouts on the AST-walking tests.**
- `AST_TEST_TIMEOUT_MS = 30_000` covers:
  - the full-tree boundary test;
  - the whole "package dependency direction" block;
  - the boundary test of each P2 module (evidence, kpi, methodology, reporting, workflows).
- The other `fileViolations` calls in `architecture.test.ts` are self-checks on single planted files or small temp directories.
- The global unit default (5 s) is unchanged.

**Round-2 repro re-run.** I ran `pnpm test --reporter=verbose` while a second clone looped `pnpm -r build` and the integration probes on a disposable PostgreSQL. The host has 4 vCPUs and the load average was about 9.5.

| Run | Result | AST walk (explicit 30 s timeout) |
|---|---|---|
| Node 22 | 520/520 | 2857 ms (round 2: 5829 ms and a timeout failure) |
| Node 24 | 520/520 | 2633 ms |
| Node 22, heavier load (build loop + full integration suite) | 520/520 | 2176 ms |

**No default-timeout test is within 2x of its limit.** The slowest test that relies on the 5 s default reached 1868 ms (`p2.test.tsx` Diagnose, Node 22 under load). The 2x line is 2500 ms.

**Web retry test.** The test was strengthened, not weakened:
- Every original assertion is still there.
- A new assertion requires at least 3 failed `GET /me` calls after the POST.
- `retryDelayMs` is opt-in and only removes the real-time back-off.
- The `ME_REFRESH_TIMEOUT_MS` timeout branch was not exercised before either. The old 1 s + 2 s back-off also finished before the 5 s limit.

## D-063 blank-text hardening: holds as specified

**No input bypasses the shared schemas.**
- Every `parseBody` call site in the P2 modules maps to a shared schema built on `freeText`. This covers:
  - the generic register kit (create and partial PATCH);
  - the charter;
  - KPI;
  - evidence, including the review note;
  - decisions, options and decide;
  - gate submission and decision;
  - workshops;
  - the canvas;
  - methodology labels.
- Nested journey step fields are covered too: `actor`, `handoffTo`, `systems[]` and `controls[]`.
- P2 query parameters are only enums, UUIDs, cursor and limit.
- The remaining raw `z.string()` uses are:
  - P1 fields (transformation description, admin `q`);
  - identity;
  - codes;
  - response schemas.

**Probes on a disposable PostgreSQL.** `zz-sec-r3-probe.test.ts` passed 9/9, twice.
- Unicode whitespace that JS `trim` strips (NBSP, U+3000, LS/PS, BOM, U+2007, U+205F, U+1680, U+202F) is rejected.
- So are blank values at nested pointers (`/steps/0/systems/1`) and in partial PATCH bodies.
- Each one returns 400 `validation.blank` with nothing written and no audit row for the request.
- The evidence review note, G1 submission note, decision title and option title are rejected the same way.

**Readiness.** `criteria.ts`, `gate-facts.ts` and `charter.ts` use `hasText` for the free-text presence tests.
- One observation, no finding: `gate-facts.ts:134` still tests `unit_label !== null`. Every write path rejects a blank unit label, so it can't be reached through the API.

**Exclusions pre-check.** It now returns `attention`. Authz, If-Match and audit are unchanged:
- The read-only auditor gets 403 with exactly 1 denial audit row.
- An outsider gets 404.
- A stale If-Match gets 409 and a missing one gets 428. Neither writes anything.
- A `null` clear is audited once.
- After the clear, the pre-check shows `attention` and G1 lists `/charter/outOfScope` as missing.

## New finding

**F-DG2-160 (Low, non-mandatory, REQ-PB-031, owner backend-workflow-engineer).**

`freeText` and `hasText` (`common.ts:42` and `:58`) test blankness with `String.prototype.trim()`. That misses:
- U+0085 NEL, which is a Unicode White_Space character;
- invisible format characters: U+200B–U+200D, U+2060, U+200F RLM and U+061C ALM. The bidi marks are typical of Arabic input.

An Out of scope made only of these characters is stored (201). The B0041 pre-check then reads `pass`, and G1 treats Out of scope as documented. This reproduced 5/5 in two runs with `zz-sec-r3-invisible.test.ts`.

**Why Low and not mandatory:**
- Someone has to deliberately enter invisible-only characters.
- The pre-check supports the human scope-check answer and never replaces it.
- G1 still needs a human Sponsor decision.

**Suggested fix:** replace `trim()` with a `\p{White_Space}` / `\p{Cf}`-aware test in the one shared helper.

**How it is recorded.** The failing reproduction file ran in the same invocation as SEC-R3-03, so that check records exit status 1, while its result is PASS for its stated D-063 scope. The defect itself is recorded in the finding. This follows the round-2 convention.

## Checks

Every required check ran and passed:
- build, typecheck, lint, openapi:lint (161 operations), no-cdn, format:check;
- unit tests: 520/520 on Node 22 and on Node 24;
- integration twice on fresh disposable PG16 clusters (ports 55481 and 55482): 456/456 each time, 19 migrations, contract test with 161 operations;
- the AUD-403 sweep: 128 + 18 tests, in both runs;
- `validate --historical` for DG0 and DG1.

The environmental residuals were checked on their offline and config surfaces only: the live registry (D-057), live CI (D-058) and a live Keycloak (D-049).

I ran code only in disposable clones under `$TMPDIR` and on disposable PostgreSQL clusters. I made no change to implementation sources. All data is synthetic.
