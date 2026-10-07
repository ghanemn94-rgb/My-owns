# code-security-reviewer DG2 round-17 probes (T-DG2-REV-SEC-R17)

These probes are not product code. Each probe was copied into the disposable probe clone `$TMPDIR/r17p` (HEAD 23edabf = candidate
sha256:ddaab3cc…, 564 files; source 805da3e) at `apps/web/src/auth/` and run with `pnpm vitest run --project unit-web`
(jsdom, the product's own fixtures and `createQueryClient`, SYNTHETIC data). The clone was deleted after the run. Runner: `../probe-runs.sh`.

| Probe | Logs | Result (Node 22 LANG unset / Node 24 LANG=C.UTF-8) |
|---|---|---|
| round-14 `zz-sec-r14-web-probe.test.tsx` (sha256 2b64ba54…, UNCHANGED) | `../probe-r14-web-*.log` | 26/26 pass on both (exit 0) |
| round-15 `zz-sec-r15-web-probe.test.tsx` (sha256 bd97dbc9…, UNCHANGED; X1–X7) | `../probe-r15-web-*.log` | 6/6 pass on both (exit 0) |
| round-16 `zz-sec-r16-web-probe.test.tsx` (sha256 f0d72881…, UNCHANGED; Y1/Y1c/Y4/Y5) | `../probe-r16-web-*.log` | 4/4 pass on both (exit 0). **Y1, which failed in round 16, now passes.** The path stays `/transformations/new`, the generation goes 0→1, B's header is shown, and B sees neither A's code nor A's name. |
| `zz-sec-r17-web-probe.test.tsx` (sha256 d75da82e…, NEW; Z1–Z6) | `../probe-r17-web-*.log` | 7/7 pass on both (exit 0) |
| `zz-sec-r17-lint-bypass.tsx` (sha256 3a0cbf3e…, NEW) | `../lint-bypass-probe.log` | eslint exit 1 **as intended**: the 2 import bypasses are refused. 3 obfuscated cache-write forms are not flagged (observation, see below). |

## Round-17 cases

Users A and B differ in user id AND in session/CSRF token, as the API answers.

- **Z1, PASS.** A create whose post-create `GET /me` takes longer than `refreshEffectivePermissions`' 5 s timeout. The
  handler resumes while its generation is still A's, so it navigates: this is an effect under A, while A is current.
  The detail page's GET then waits for the in-flight `/me` (`probesIdle`). `/me` answers B, so the generation moves and
  B's subtree gets B's own 404. Across every DOM mutation, B's header was never shown together with A's code or name
  (0 mixed states). The URL still carries A's new record id. That is inherent to a shared tab URL (the same as whatever
  page A was on), and the server refuses it to B.
- **Z2, PASS** (assertion corrected after the dry run, see below). An edit whose PATCH is in flight for 3 s while B
  signs in. The edit's awaits send no GET, so the navigation runs under A's still-current generation. The navigation
  identity check then asks `/me` before any page GET. Result: header B, and 0 DOM states with B's header over A's
  record data. **Z2c control, PASS**: under one identity the same 3 s save still updates and navigates.
- **Z3, the documented D-077 residual, PASS (demonstrated and bounded).** On a refetch inside the 2 s window, after B
  signed in elsewhere, B's row is shown under A's header (logged). After the window, the next GET sends `GET /me` first;
  the header becomes B's, and A's rows are gone. Only the cookie holder's own, server-authorised data appears. A write
  from that view carries A's CSRF token and is refused (403 csrf, r15 X7).
- **Z4, Y5 made asserting, PASS.** A navigation immediately after B signed in (no focus event, no time passes) sends
  `GET /me` first. Across all DOM mutations, A's header is never rendered above B's rows.
- **Z5, OBSERVATION.** A query-string-only navigation (same pathname) inside the window does not re-ask `/me`
  (`useLayoutEffect` keys on `pathname`). It behaves like Z3, i.e. it is within the documented residual ("a filter, a
  page of results"). It is not raised.
- **Z6, OBSERVATION (liveness).** While a navigation's `GET /me` is held, the page's GETs are not sent. They are sent
  once `/me` answers. This is by design (D-077). If `/me` hung indefinitely, the page would stay Loading until the
  browser's fetch gives up. It is not raised: a hung `/me` already breaks the session gate.

## Lint-convention probe

These are evasive forms, not accidental ones. `import * as RR` (`RR.useNavigate`) and a renamed `useNavigate` import
are both refused by `no-restricted-imports`. These three forms pass both the ESLint rule and the scan test in
`session-bound.test.tsx`:

- a destructured `const { setQueryData } = queryClient`;
- a computed `queryClient["setQueryData"](…)`;
- an alias named `action` (`const action = queryClient`).

No code in the candidate uses any of them (grep in the record). The runtime guard does not depend on lint, because the
only navigate/cache-write API the pages hold is the session-bound one. This is recorded as a non-blocking observation.

## Editing history

The r17 probe was dry-run once before the recorded runs (output not kept). In that dry run Z2's first assertion,
`path stays /transformations/<id>/edit`, failed. I had assumed the post-PATCH invalidation would trigger the 2 s
recheck. On this page no active query matches it, so no GET and no `/me` happens before the navigation, which therefore
runs under A's still-current generation. That is not a stale effect. I replaced the assertion with the class invariant:
header B, no mixed DOM state, and none of A's record data shown. The other cases and the save-button label fix
(`Save` → `Save changes`, made before the dry run) were not changed after the dry run.
