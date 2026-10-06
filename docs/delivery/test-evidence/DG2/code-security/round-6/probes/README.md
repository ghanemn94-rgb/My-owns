# code-security-reviewer DG2 round-6 probes (T-DG2-REV-SEC-R6)

I used two disposable clones, `$TMPDIR/rev` (checks) and `$TMPDIR/probe` (probes and load generator). Both are at `51a692b1`, candidate `sha256:bb3e7581…` (528 files, recomputed in the clone). HEAD `bd2e809` differs only by delivery metadata.

- **Setup.** Offline `pnpm install --frozen-lockfile` from a scratch copy of the host pnpm store, then `pnpm -r build`.
- **Where the probes ran.** Probe files were copied into `apps/api/test/integration/` of the probe clone only, never into the candidate.
- **Database.** Disposable PostgreSQL 16.13 clusters (`../with-pg.sh`, ports 55671–55673 and 55681, deleted afterwards).
  - Run 1: LANG unset (SQL_ASCII cluster default).
  - Run 2: LANG=C.UTF-8 (UTF8 cluster).
- **Data.** All data is SYNTHETIC.
- **Reading results.** Each assertion states the secure expectation, so a failing test means a defect was shown.

## Results

Logs: `../probe-run1.log` (LANG unset), `../probe-run2.log` (C.UTF-8) and `../surrogate-probe-run1.log`.

### Round-5 repros, rerun unchanged

| File | Result |
|---|---|
| `../../round-5/probes/zz-sec-r5-probe.test.ts` | **Part E passes (F-DG2-230 fixed):** U+16FE4 and U+1D159 x2 as Out of scope give 400. **Part F passes (F-DG2-231 fixed).** **D1–D4 pass** except 3 rows (D1, D2, D3) for **NUL-only** input. Those now return 400 at the same pointer with the more specific `validation.invalid_character` instead of `validation.blank`. That is the designed one-error behaviour of the F-DG2-231 repair, not a defect: the round-5 expectation predates the repair. |
| `../../round-5/probes/zz-sec-r5-nul.test.ts` | 4/4 pass. Charter, name and reason with NUL inside visible text get a 4xx (400 `validation.invalid_character`). Counts and the record are unchanged. |
| `../../round-5/probes/zz-sec-r5-oidc.test.ts` | 8/8 pass. Identity, session and authorization are unchanged. |

### Round-6 probes

| File | Result |
|---|---|
| `zz-sec-r6-probe.test.ts` | 16/16 pass, in four parts (A–D below). |
| `zz-sec-r6-oidc.test.ts` | 8/8 pass, in three groups (below). |
| `zz-sec-r6-surrogate.test.ts` | **2 FAIL, as designed (F-DG2-260)**, plus 1 pass (below). |
| `schema-sweep-r6.mts` | `../schema-sweep-r6.log` (below). |

**`zz-sec-r6-probe.test.ts`, 16/16 pass:**
- **A. Placeholders.** Placeholder-only Out of scope, name and reason give 400 `validation.blank`. With visible text they are stored verbatim and the pre-check passes.
- **B. NUL handling.**
  - A NUL nested in an array is reported at `/stakeholders/1/name`.
  - Precedence: 401 without a session, CSRF 403, then 400.
  - The 400 does not depend on whether the record exists, so it is not an existence oracle.
  - Legitimate text is kept: `\0`, `%00`, U+0001 and U+FFFD.
- **C. Lone surrogates in free text.** They are never a 5xx. The text column stores U+FFFD (an observation).
- **D. Real HTTP (llhttp).** A NUL in X-Request-Id, in User-Agent or raw in the request target is refused by the HTTP parser with 400. `%00` in the query gets 400 from the central check.

**`zz-sec-r6-oidc.test.ts`, 8/8 pass:**
- NUL in claims:
  - a NUL in `sub` gives `token_invalid`;
  - a NUL in `name`, `preferred_username` or `email` falls through to the next claim.
- Callback query: a NUL in `state`, `code` or `error` gives 302 `invalid_request`.
- Lone surrogates:
  - in name, preferred_username or email they are never a 5xx;
  - in `sub` they give an undeclared 400 (characterized in `zz-sec-r6-surrogate`).
- The (iss, sub) binding, no roles at JIT, a working session and the single-use login are all unchanged.

**`zz-sec-r6-surrogate.test.ts`, 2 FAIL as designed (F-DG2-260):**
- An ID token whose `sub` holds a lone UTF-16 surrogate makes the callback answer **400 application/problem+json `validation.format`**. The contract declares only 302 and 429.
- No `session.login_failed` audit row is written, and no identity is created.
- JIT and bind paths fail alike.
- Root cause: JSON.stringify keeps `\ud800` as an escape in `audit_event.changes` (jsonb). PostgreSQL then raises 22P02, which `hooks.ts` maps to 400.
- Journey step name with a lone surrogate (the 1 pass): a *declared* 400 `validation.format` at pointer "" (an observation).

**`schema-sweep-r6.mts`** (`../schema-sweep-r6.log`):
- The exhaustive sweep 0..10FFFF finds the invisible set exactly equal to WS ∪ Cc ∪ Cf ∪ Cs ∪ DI ∪ {U+2800, U+16FE4, U+1D159}: 0 extra, 0 missed.
- `hasInvalidCharacter` is true only for U+0000.
- The placeholders are blank when alone and kept when they accompany visible text.
- A NUL gives exactly one error, `validation.invalid_character`.
- The single BAD row is an error in the probe's expectation. It is explained in the log.

The load generator (`../load-repro.sh`) also ran `zz-sec-r6-probe` and `zz-sec-r6-oidc` on port 55681 as CPU load. That output was discarded (load only).
