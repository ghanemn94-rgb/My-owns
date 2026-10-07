# code-security-reviewer DG2 round-16 probes (T-DG2-REV-SEC-R16)

Not product code. Each probe was copied into the disposable probe clone `$TMPDIR/r16p` (HEAD f4242ae = candidate
sha256:0cab0a8c…, 562 files; source e3b2375) at `apps/web/src/auth/` and run with `pnpm vitest run --project unit-web`
(jsdom, the product's own fixtures, SYNTHETIC data). The clone was deleted after the run. Runner: `../probe-runs.sh`.

| Probe | Logs | Result (Node 22 LANG unset / Node 24 LANG=C.UTF-8) |
|---|---|---|
| round-14 `zz-sec-r14-web-probe.test.tsx` (sha256 2b64ba54…, UNCHANGED from `../../round-14/probes/`) | `../probe-r14-web-node22-lang-unset.log`, `../probe-r14-web-node24-lang-c-utf8.log` | 26/26 pass on both (exit 0) |
| round-15 `zz-sec-r15-web-probe.test.tsx` (sha256 bd97dbc9…, UNCHANGED from `../../round-15/probes/`) | `../probe-r15-web-node22-lang-unset.log`, `../probe-r15-web-node24-lang-c-utf8.log` | 6/6 pass on both (exit 0); X3, which failed in round 15 (F-DG2-530), now passes |
| `zz-sec-r16-web-probe.test.tsx` (sha256 f0d72881…, NEW) | `../probe-r16-web-node22-lang-unset.log`, `../probe-r16-web-node24-lang-c-utf8.log` | 3/4 pass on both (exit 1); Y1 fails by design |

Round-16 cases (users A and B differ in user id AND session/CSRF token, as the API answers):

- **Y1: FAILS BY DESIGN on both runtimes.** A creates a transformation on `/transformations/new`. While A's POST is in
  flight, A signs out and B signs in in another tab (`state.user = "B"`). A's POST is then answered 201. It is still
  under the generation it was sent with (0), so FE14 correctly returns it. TransformationCreatePage's success handler
  then awaits `invalidateQueries` and `refreshEffectivePermissions`, which is a GET /me. That /me returns B, so the
  generation moves to 1 and the session state is reset. The handler nevertheless continues: it navigates to
  `/transformations/<A's new id>` with A's code and name in router state. B's own GET of the record answers 404, and
  the detail page renders CreatedNotVisible from that router state. Under B's header, B reads "TR-A-NEW-SECRET ·
  A-CREATED-SECRET-NAME was saved as a draft…".
  - Requests after the POST: POST, GET /me, GET business-units, GET /transformations/<id>.
  - The one failing assertion is `expect(path).not.toBe('/transformations/<A's id>')`. The next assertion (A's code or
    name not shown) is not reached, but the logged line records `B sees A's code=true; B sees A's name=true`.
  - This is the F-DG2-530 class: the answer to a request sent under A is navigated on and shown after the tab moved
    to B. FE14 gates each answer, but not what a handler does after a further `await`.
- **Y1c control: PASS.** The same create under one identity still navigates to the created record and shows the
  "created as a draft" banner (FE14 does not break the normal flow).
- **Y4: PASS.** This is X6 with the production `QUERY_DEFAULTS` (no test override). A refocus after B signed in
  elsewhere sends `GET /api/v1/me` FIRST, then the stale page queries. The header shows B above B's rows, and never A
  above B's rows.
- **Y5 OBSERVATION (always passes; not raised).** An in-app navigation with no focus or visibility event (for example
  two windows side by side, where TanStack's focusManager, which listens only to `visibilitychange`, fires nothing).
  After B signed in elsewhere, the new page's queries are fetched with B's cookie. A's header stays, above B's rows,
  until the next /me. Nothing of A's is shown to B: the data is the cookie holder's own and is server-authorised. A
  write from that view carries A's CSRF token, which the server binds to the session
  (`apps/api/src/modules/identity/sessions.ts`, constant-time hash comparison), so it is refused with 403 csrf, and
  that is not a session end (r15 X7).

Editing history: the r16 probe was dry-run once before the recorded runs (dry-run output not kept). In the dry run, Y1
was asserted 400 ms after release, while the detail page was still "Loading…". A bounded wait (up to 3 s) for the
settled state was added, along with a request log. A no-op wait line in Y4 was removed. The assertions were not
changed.
