# code-security-reviewer DG2 round-14 probes (T-DG2-REV-SEC-R14)

Not product code. Each probe was copied into the disposable probe clone `$TMPDIR/r14p` (HEAD d99de98 = candidate
sha256:9f3ca298…, 560 files; source ea9051b) and run there; the clone was deleted after the run.

| Probe | Where it ran | Logs |
|---|---|---|
| `zz-sec-r14-web-probe.test.tsx` (sha256 2b64ba54…, NEW this round) | `apps/web/src/auth/`, `pnpm vitest run --project unit-web` (jsdom, the product's own fixtures, SYNTHETIC data) | `../probe-web-node22.log`, `../probe-web-node24.log`; earlier draft: `../probe-web-dryrun.log` |
| round-12 `zz-sec-r12-probe.test.ts` (71cbe705…), `zz-sec-r12-oidc-probe.test.ts` (db10609c…), round-13 `zz-sec-r13-probe.test.ts` (8ae4840f…), all UNCHANGED from `../../round-12/probes/` and `../../round-13/probes/` | `apps/api/test/integration/`, disposable PostgreSQL 16 per run (`../with-pg.sh`, ports 30081-30086) | `../probe-r12-*.log`, `../probe-r13-*.log` (`../probe-runs.sh`) |

Web probe cases: W1 returnTo (16 hostile values, sign-in page Navigate target and OIDC href); W2/W3 403 forbidden, 403
csrf and 401 `auth.login_failed` are not a session end; W4 request storm against an inconsistent server (GET /me 200 but
every other GET 401, with and without a problem body); W5/W5b cross-user cache after a session end on the sign-in page
(development sign-in; OIDC mode with a /me re-probe); W6 Back after a session-end landing.

W5 and W5b FAIL by design of the probe: they assert that user B never sees user A's cached row, and B does (F-DG2-500).
The dry-run log is from the first draft (sha differs): its W1 "signed in" case wrongly expected `/` to redirect to
`/my-work` (the app correctly stayed on same-origin `/`), and its W6 case navigated to a page that issued no request (fresh
/me), so no 401 occurred. Both cases were corrected (comments in the probe) before the recorded Node 22/24 runs.
