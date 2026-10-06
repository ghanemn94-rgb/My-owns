# code-security-reviewer DG2 round-5 probes (T-DG2-REV-SEC-R5)

Disposable clones `$TMPDIR/review-sec` (checks) and `$TMPDIR/review-probe` (probes, load generator), both at `96a3c293`
(candidate `sha256:2f81c60a…`, 526 files, recomputed in the clone; HEAD `da317d7` differs only by delivery metadata).
Offline `pnpm install --frozen-lockfile` from a scratch copy of the host pnpm store, then `pnpm -r build`. Probe files
were copied into `apps/api/test/integration/` of the probe clone only (never into the candidate) and run on disposable
PostgreSQL 16.13 clusters (`../with-pg.sh`: ports 55621-55624, deleted afterwards; NO `--encoding` given to initdb, so
the cluster default follows LANG). All data SYNTHETIC. Assertions encode the SECURE expectation: a failing test = defect shown.

| File | Result (`../probe-run1.log`, `../probe-run2.log`; readyz/NUL also `../readyz-probe.log`, `../nul-probe.log`) |
|---|---|
| `../../round-3/probes/zz-sec-r3-invisible.test.ts` (round-3 repro, unchanged) | 5/5 PASS |
| `../../round-4/probes/zz-sec-r4-probe.test.ts` (round-4 repro, unchanged) | 8/8 PASS. Part C (F-DG2-180): U+FE0F, U+034F x2, U+180B, U+17B4, RLM+VS16 Out of scope -> 400; archive reason U+FE0F x3 -> 400 |
| `../../round-4/probes/zz-sec-r4-oidc.test.ts` (round-4 repro, unchanged) | 2/2 PASS (F-DG2-181 fixed) |
| `zz-sec-r5-probe.test.ts` D1-D4 | 23 PASS: 13 invisible values -> 400 validation.blank at /outOfScope, /reason, /name, nothing stored, no audit; 7 visible-with-marks Out of scope values + a reason and a name stored verbatim, pre-check pass |
| `zz-sec-r5-probe.test.ts` E | 2 FAIL as designed (F-DG2-230): U+16FE4, U+1D159 x2 Out of scope -> 201, pre-check pass, G1 treats as documented |
| `zz-sec-r5-probe.test.ts` F | 2 FAIL as designed (F-DG2-231): NUL inside text -> undeclared 500 |
| `zz-sec-r5-oidc.test.ts` | 8/8 PASS: F-DG2-181 fixed; (iss, sub) binding, session, no roles unchanged |
| `zz-sec-r5-readyz.test.ts` | 3/3 PASS: positive cache cannot give a false ready after a same-name SQL_ASCII swap (503 migrations pending; migrate refuses); fresh process -> database fail; not-ready path creates 0 objects; body only status/checks; client_encoding override in URL options does not fool the guard |
| `zz-sec-r5-nul.test.ts` | root cause PASS (SQLSTATE 22021); 3 FAIL as designed (F-DG2-231): charter/name/reason 500, counts unchanged, record unchanged |
| `schema-unicode-matrix-r5.mts` | `../schema-unicode-matrix-r5.log`: 0 unexpected; exhaustive DI/White_Space/Cc/Cf/Cs sweeps 0 residual; linear timing |
| `extra-schema-checks.mts` | `../extra-schema-checks.log`: U+16FE4/U+1D159 accepted by freeText/name/reason; NUL-in-text accepted now and by the round-4 predicate; DG1 name/reason were plain zod strings |

The load generator (`../load-repro.sh`) also ran `zz-sec-r5-probe.test.ts` and `zz-sec-r5-readyz.test.ts` on port 55631 as CPU load; that output was discarded (load only).
