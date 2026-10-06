# code-security-reviewer DG2 round-4 probes (T-DG2-REV-SEC-R4)

Disposable clones `$TMPDIR/review-sec` (checks) and `$TMPDIR/review-probe` (probes, load generator), both at
`e37f6ea4` (candidate `sha256:29ced0ed…`, 521 files, recomputed in the clone; HEAD `bb4dd9c` differs only by delivery
metadata). Node v22.22.2 (probes) / v24.21.0 (matrix). Offline `pnpm install --frozen-lockfile` from a scratch copy of the
host pnpm store, then `pnpm -r build`. Probe files were copied into `apps/api/test/integration/` of the probe clone only
(never into the candidate) and run against disposable PostgreSQL 16.13 clusters (`../with-pg.sh`, 127.0.0.1:55591 and
:55592, deleted afterwards). All data SYNTHETIC. Assertions encode the SECURE expectation: a failing test = defect shown.

| File | Result (both runs: `../probe-run1.log`, `../probe-run2.log`) |
|---|---|
| `../../round-3/probes/zz-sec-r3-invisible.test.ts` (round-3 F-DG2-160 repro, unchanged) | 5/5 PASS: U+0085, U+200B, U+200F, U+061C, U+2060x3 Out of scope -> 400 (nothing stored). |
| `zz-sec-r4-probe.test.ts` A (register archive, T03 TOM gap) | PASS: auditor 403 + 1 `authorization.denied` audit; auditor with a blank reason still 403 (authz before validation); outsider 404; 5 invisible reasons (RLM x3, NEL+WJ+NBSP+ZWSP, ALM x4, U+3164 x3, RLO+LRI+PDI) -> 400 `validation.blank` at `/reason`, 0 audit rows for the request; missing If-Match 428; stale 409; record still `open` v1; valid reason -> 200, trimmed, v2, exactly one `tom_gap.archive`. |
| `zz-sec-r4-probe.test.ts` B (evidence-link removal) | PASS: the same set (403/403/404/400x5/400 strict body/428/409), link still `active` v1 with no reason; valid -> `removed` v2, one `evidence_link.remove`. |
| `zz-sec-r4-probe.test.ts` C (residual, F-DG2-180) | 6 FAIL as designed: Out of scope = U+FE0F, U+034F x2, U+180B, U+17B4, RLM+U+FE0F -> 201 stored, `exclusions_documented` = `pass`, G1 `g1.initial_charter` does not list `/charter/outOfScope`; archive reason U+FE0F x3 -> 200, archived with an invisible reason. |
| `zz-sec-r4-oidc.test.ts` | Test 1 PASS: invisible-only `name` falls back to `preferred_username`; a 2nd login with the same (iss, sub) and another invisible name signs in the SAME user; 0 scoped assignments. Test 2 FAIL as designed (F-DG2-181): `name` = 200 x U+200B + "Visible Synthetic" passes `hasText`, then `slice(0, 200)` stores a 200-code-unit display name with no visible content. |
| `schema-unicode-matrix.mts` | `../schema-unicode-matrix.log`: freeText / hasText / name / reason over 60 inputs; exhaustive sweep of the 4174 `\p{Default_Ignorable_Code_Point}` code points (4032 still counted as visible; assigned ones: U+034F, U+17B4-17B5, U+180B-180D, U+180F, U+FE00-FE0F, U+E0100-E01EF); timing up to 10^7 invisible code units (linear, about 0.2 s at 10^7). |

The load generator (`../load-repro.sh`) also ran `zz-sec-r4-probe.test.ts` repeatedly on port 55593 as CPU load; those
runs' output was discarded (load only).
