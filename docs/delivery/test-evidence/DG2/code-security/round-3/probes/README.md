# code-security-reviewer DG2 round-3 probes (T-DG2-REV-SEC-R3)

Disposable clone `$TMPDIR/review-probe` at 9e13947e (candidate sha256:b98c44db…, 519 files; HEAD 6245903 differs only by
delivery metadata), Node v22.22.2, offline `pnpm install --frozen-lockfile` from a writable copy of the host pnpm store,
`pnpm -r build`. Probe files were copied to `apps/api/test/integration/` in that clone only (never into the candidate)
and run against a disposable PostgreSQL 16 (`../with-pg.sh`, 127.0.0.1:55491 and :55492, removed afterwards).
All data SYNTHETIC.

- `zz-sec-r3-probe.test.ts`: 9 tests, PASS in both runs (`../probe-run1.log`, `../probe-run2.log`). Covers Unicode
  whitespace that JS trim strips (NBSP, U+3000, LS/PS, BOM, U+2007/U+205F, U+1680/U+202F) on charter outOfScope and
  changeSummary (400 validation.blank, 0 audit rows, version unchanged); auditor 403 + 1 denial audit; outsider 404;
  stale If-Match 409; missing If-Match 428; null clear audited once (charter.update v2) -> exclusions pre-check
  `attention`, G1 lists /charter/outOfScope, auditor can read the view; journey nested step name/actor/systems[1] and
  failureDemand, journey PATCH description; evidence review note; G1 submission note; decision PATCH title and option
  title. All 400 at the nested pointer, nothing written, no audit.
- `zz-sec-r3-invisible.test.ts`: 5 tests, FAIL (as designed: secure expectation) in both runs. It reproduces
  F-DG2-160: an Out of scope made only of U+0085 (NEL, Unicode White_Space), U+200B, U+200F, U+061C or U+2060 is
  stored (201), the B0041 pre-check `exclusions_documented` reads `pass`, and G1 `g1.initial_charter` does not list
  /charter/outOfScope as missing.
- `schema-unicode-matrix.mts`: `node schema-unicode-matrix.mts <clone>/packages/shared` (Node 24 type stripping)
  runs `freeText(1,100)` and `hasText` over 18 code points. Output: `../schema-unicode-matrix.log`.
