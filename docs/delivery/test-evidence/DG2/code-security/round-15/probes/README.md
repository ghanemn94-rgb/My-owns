# code-security-reviewer DG2 round-15 probes (T-DG2-REV-SEC-R15)

Not product code. Each probe was copied into the disposable probe clone `$TMPDIR/r15p` (HEAD 9236a9f = candidate
sha256:3f01c610…, 561 files; source ed80b23) at `apps/web/src/auth/` and run with `pnpm vitest run --project unit-web`
(jsdom, the product's own fixtures, SYNTHETIC data). The clone was deleted after the run. Runner: `../probe-runs.sh`.

| Probe | Logs |
|---|---|
| round-14 `zz-sec-r14-web-probe.test.tsx` (sha256 2b64ba54…, UNCHANGED from `../../round-14/probes/`) | `../probe-r14-web-node22-lang-unset.log`, `../probe-r14-web-node24-lang-c-utf8.log` — 26/26 pass on both |
| `zz-sec-r15-web-probe.test.tsx` (sha256 bd97dbc9…, NEW) | `../probe-r15-web-node22-lang-unset.log`, `../probe-r15-web-node24-lang-c-utf8.log` — 5/6 pass, X3 fails by design |

Round-15 cases (users A and B differ in user id AND session/CSRF token, as the API answers):

- X2 Back/Forward after an identity change: B never sees A's cached detail or list. PASS.
- X3 an edit (PATCH) of A's in flight when the identity changes to B (a refocus /me after A signed out and B signed in
  in another tab) and answered afterwards: TransformationEditPage's success handler writes A's record into the cache
  with setQueryData and navigates to it, so B sees A's record, and still sees it after B's own refetch answers 404.
  FAILS BY DESIGN: the one failing assertion is `expect(cached?.name).toBeUndefined()` (received "A-PATCHED-SECRET").
  This is finding F-DG2-530.
- X3b the same after a session END in this tab and B's development sign-in: the identity change at B's /me removes
  the late write. PASS (FE13's defence in depth works on this path).
- X4 a query of A's in flight across an identity change, answered afterwards: never lands in B's cache. PASS.
- X6 OBSERVATION (always passes): a refocus within GET /me's 60 s staleTime refetches page queries with the new
  cookie but not /me. The tab shows A's name with B's rows (B's own data, the cookie holder's); nothing of A's
  is shown to B. Not raised as a finding.
- X7 403 csrf on a PATCH: phase stays active, identity and cache kept, no reset hook. PASS.

The probe was edited twice before the recorded runs (dry runs not kept). (1) X4 used `act(...).catch`, which act's
thenable does not support; that broke React's act scope for X6/X7 too. (2) X3 gained the after-refetch observation.
