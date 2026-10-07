# DG2 round 12: qa-verifier narrative (T-DG2-REV-QA-R12)

**Verdict: FAIL.** One regression was found. F-DG2-430 is closed.

- **Candidate:** `sha256:5dfecce4…92b8`, 552 files.
- **Source:** 8488e7a, freeze commit 744af0b.
- **Where I ran things:** disposable clones only, all removed at the end.
- **Machine-readable record:** `qa-verifier.json`, with the sidecars `qa-verifier.verifications.json` and `qa-verifier.findings.json`.

## F-DG2-430 (Low): CLOSED_VERIFIED

**Unit logs are clean.** `pnpm test` ran 7 times: Node 22 and Node 24, both locale settings, plus one run under load.
- Every run: 790/790 tests passed.
- No `Cannot update a component` line and no act() warning in any log.

**The Team preview works in both languages.** The assign dialog's preview follows the Role select through every assignable role and back.
- English: left-to-right.
- Arabic: right-to-left.
- Each time the text matches the API.
- After Cancel, nothing is assigned.

**The guard catches a reintroduced violation.**
- I restored the old impure updater in a throwaway clone. The guard then fails `team.test.tsx` in both locale settings.
- With the guard's checks removed, the same violation passes and only prints the warning. So it is the guard that turns the warning into a failure.

**Sweep.** All 13 functional state updaters in `apps/web/src` are pure.

## BE17 regression focus (D-072)

These all **pass**, each run 4 times (en and ar × both locale settings):
- **Edit during the upload body (R12-01):** the edit itself is not blocked (it completes in under 30 ms). The upload then gets 409 and nothing is stored. Two uploads racing with the same If-Match produce exactly one winner.
- **Stalled uploads (R12-02):** 25 stalled uploads, more than the pool's 20 connections, do not block other users or `/readyz`. No session sits idle in a transaction, and a positive control shows the probe would have caught one.
- **Aborted bodies (R12-03):** aborted JSON and upload bodies cause no 500 and no error-level log. Each abort is logged at info level.
- **Binary uploads (R12-04):** stored byte-exact, and the sha256 matches the database and the Digest header.
- **Unicode (R12-05):** Arabic and emoji text round-trips verbatim.
- **R8-05 / R9-05:** each form error message is still shown once.

## New finding: F-DG2-460 (Medium, non-mandatory)

**What happens.** An upload that is still in flight when the API receives SIGTERM leaves an orphaned `<content>.part` file in the evidence store.
- The file holds the partial user bytes (2 MiB in the probe).
- It survives a restart.
- Nothing ever removes it.

**It is a regression from round 11.**
- The round-11 freeze 309aff2 leaves nothing in the identical probe.
- My round-11 test R11-02(b) passed 4 of 4 runs in round 11. It now fails 4 of 4.

**Probable cause.** Before BE17, the upload held a checked-out pool connection, so `db.destroy()` in `main.ts` had to wait until the handler had cleaned up. In phase 2 the body is now received without a connection, so `db.destroy()` returns at once. `process.exit(0)` then runs before `store.receive()` finishes its asynchronous `rm(temp)`.

**Owner:** backend-workflow-engineer.

## Everything else

All of these passed:
- **Static checks:** typecheck, build, lint, OpenAPI lint (161 operations), no-CDN, formatting and contrast.
- **Integration:** 6 runs, 640/640 tests each.
- **Product e2e:** 64/64 in each locale setting.
- **QA-stack e2e:** 128 passed in each locale setting. The only 2 failures are R11-02 (F-DG2-460).
- **Accessibility:** 636 axe scans, 0 serious or critical violations.
- **Validators:** register, pipeline and reconcile.

The environmental residuals D-057 (live registry), D-058 (live CI) and D-049 (Keycloak) pass on the offline/config surface; the residuals themselves remain.

No business approval is implied. Product gates G1–G6 are separate from DG0–DG7.
