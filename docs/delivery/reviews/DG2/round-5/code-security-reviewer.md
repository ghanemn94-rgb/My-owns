# DG2 round 5 — code-security-reviewer narrative (T-DG2-REV-SEC-R5)

**Verdict: PASS.** Both round-4 findings are CLOSED_VERIFIED. Two new findings are raised; both are **Low and non-mandatory**:

- **F-DG2-230:** two placeholder code points that are invisible by design still count as content.
- **F-DG2-231:** a NUL inside text returns an undeclared 500. This is pre-existing.

Nothing is Critical, High or mandatory, and every required check ran and passed.

## Candidate

`git rev-parse HEAD` = `da317d7`. Its only delta from `source_commit` `96a3c293` is delivery metadata: the round-5 assignments, the candidate manifest and `stages.json`. `node tools/gates/candidate.mjs --stage DG2` gave `sha256:2f81c60ab1347986…8c46` over 526 files, both on the working tree and in a fresh complete clone at `96a3c293`.

## Verification of my round-4 findings

### F-DG2-180: CLOSED_VERIFIED

`common.ts:51` now excludes `White_Space`, `Cc`, `Cf`, `Cs`, `Default_Ignorable_Code_Point` and U+2800 in the one shared predicate.

- **Exhaustive sweeps:** 0 residuals in any of these properties.
- **Round-4 repro (unchanged):** passes.
- **API:** 13 invisible values return 400 at `/outOfScope`, `/reason` and `/name`. Nothing is stored and no audit row is written.
- **Visible text with marks:** stored verbatim. Tested with VS16 emoji, keycap, ZWJ family, tag flag, RLM + Arabic, combining marks and Mongolian + FVS.
- **Performance:** matching stays linear (about 0.13 s at 10^7 code units).

### F-DG2-181: CLOSED_VERIFIED

`displayNameCandidate` truncates to 200 code points first, then applies `hasText`.

- **Repro:** the round-4 repro and six other invisible prefixes all fall back correctly.
- **Astral input:** cut on a code-point boundary; `char_length` is 200.
- **Identity, session and authz unchanged:**
  - binding stays on (iss, sub), with one identity row;
  - the display name is not re-derived on later logins;
  - `/me` works for the signed-in user;
  - JIT creates no roles;
  - an unverified e-mail is never stored as the user's e-mail.

## Re-review of `e37f6ea4..96a3c293` (product code)

### UTF8 guard (`packages/db/src/encoding.ts`)

- **`migrate()`:** checks the encoding before the advisory lock and before `CREATE TABLE`.
- **CLI:** checks before `status`, `bootstrap` and `seed-dev`.
- **Read-only GUC:** `SHOW server_encoding` reads a GUC that a client cannot set. My probe added `-c client_encoding=LATIN1` to the URL options, and the guard still refused SQL_ASCII and created 0 objects.

### `/readyz`

- **Positive cache:** cannot produce a false ready. I swapped a migrated UTF8 database for a same-name SQL_ASCII one under a live process. The result was 503 with `migrations: pending`; `mth-db migrate` refuses that database, so the tooling can never make it up to date. A fresh process reports `database: fail`.
- **Not-ready path:** writes nothing (0 objects after 5 probes).
- **Response body:** only `status` and `checks`. The encoding appears only in the server log.
- **Note, not a finding:** the error log on each unauthenticated probe of a mis-encoded database follows the existing warn-per-failure pattern.

### Deploy

- `POSTGRES_INITDB_ARGS`, `10-mth-roles.sh` (ENCODING UTF8 TEMPLATE template0) and `ci-e2e-stack.mjs` add no secrets and change no roles or grants.
- template0 does not weaken schema hardening, because migration 0001 explicitly revokes CREATE on public.
- The diff scan found only a `.invalid` test URL.

### Test clusters and harness

- The test-cluster scripts now pass `--encoding=UTF8 --locale=C`.
- `global-setup` creates every scratch database explicitly as UTF8/C from template0.
- My integration run 1 deliberately used a cluster whose default was SQL_ASCII (LANG unset, no initdb encoding). The run database was still UTF8 and all 483 tests passed.
- The web harness change (`asyncUtilTimeout` 5 s, `testTimeout` 20 s) is test-only.

## New findings

### F-DG2-230 (Low, REQ-PB-031)

U+16FE4 KHITAN SMALL SCRIPT FILLER and U+1D159 MUSICAL SYMBOL NULL NOTEHEAD are invisible placeholders that no Unicode property covers.

- **Impact:** as Out of scope, either one passes the B0041 pre-check and G1.
- **Fix:** add both next to U+2800 in the predicate.

### F-DG2-231 (Low, REQ-DLV-034)

U+0000 inside visible text passes `freeText`, `name` and `reason`. PostgreSQL then raises 22021, and the API returns an undeclared 500.

- **Impact:** nothing is written and nothing leaks.
- **History:** pre-existing since DG1.
- **Fix:** reject it in the schemas, or map 22021 to a 400.

## Checks

| Check | Result |
|---|---|
| build, typecheck, lint, openapi:lint (161 ops), no-cdn, format:check | all exit 0 |
| unit, Node 22 and Node 24 | 640/640 each |
| unit under load (loadavg 13.9–14.9 on 4 vCPU), Node 22 and Node 24 | 640/640 each |
| integration run 1 (LANG unset; SQL_ASCII cluster default) | 483/483 |
| integration run 2 (LANG=C.UTF-8) | 483/483 |

Both integration runs applied 19 migrations to a fresh UTF8 database. They include contract (161 ops), blank-text 25, oidc 24, encoding 8, migrate 7 and the readiness tests. The AUD-403 sweep passed in both runs: 128 plus 18 KPI.

Historical validation passed for DG0 and DG1.

### Environmental residuals

These were checked on their offline and config surfaces only:

- live registry (D-057);
- live CI (D-058);
- Keycloak (D-049).

Evidence: `docs/delivery/test-evidence/DG2/code-security/round-5/`.
