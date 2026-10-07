# DG2 round 14 — qa-verifier (re-run R14B)

- **Verdict:** PASS
- **Candidate:** `sha256:9f3ca298d029f691330de1eddab806df57d5876307926b50df0312f8882b684e` (560 files, source `ea9051b2`)
- **Run:** `DG2-T-DG2-REV-QA-R14B-qa-verifier-20261007T105926Z-8629d15f`
- **Assignment:** `docs/delivery/assignments/DG2/round-14/qa-verifier-rerun.md`
- **New findings:** none. I had no open finding to verify, so this round has no `.verifications.json`.

This is the re-run of task T-DG2-REV-QA-R14. The first run was killed by a container restart. I did not open or cite its material in `qa-r14-orphaned/`. All evidence below is fresh, under `docs/delivery/test-evidence/DG2/qa/round-14/`.

## Candidate and independence

- HEAD was `e351a34a` at the start and at the end.
- The 6 commits after `ea9051b2` change 203 files. None of them is a manifest entry.
- The candidate ID is identical in the tree, at `--ref ea9051b2` and in both disposable clones, and `--diff` is clean.
- I wrote no product code.
- I did not read the other reviewers' round-14 records before forming this verdict.

## What the repairs had to do (D-074) and what I observed

| Repair | My probe (EN + AR, both locale settings) | Result |
|---|---|---|
| FE10 / F-DG2-480: a session end lands once on sign-in | R14-01: a real second tab's **Sign out**, then an in-app link. One landing, the localized message, the URL stays on `/login` for 3 s, at most 3 `/me`, no shell. Back never re-renders the shell. The message translates on a language switch. Signing in again returns to the page. | 4/4 |
| | R14-02: upload refused with **401** after the grant is revoked (the revoke ends the sessions). The localized message shows on sign-in, the dialog is gone, no `evidence_content` row, `session.revoke` is audited. Signing in again without the grant gives an explained state and no loop. | 4/4 |
| | R14-03: three tabs ended at once, open 10 s, then a second context from the same IP signs in and navigates. With the **product's default limits** (20 auth/min, 300/min): **1 `GET /me` per ended tab in about 16 s, 4 API requests per tab, 0 × 429**. | 4/4 harness + 4/4 default limits |
| | R14-04: a **403 is never a session end**: `forbidden` on a read and on a create (one response replaced with `page.route`, labelled in the test name) and a real `csrf` 403 on the preference save. | 4/4 |
| FE11 | R14-05: refused preference save, **EN→AR then AR→EN** in one page. The notice equals the shown language's string, `lang`/`dir`, the live region's `lang` and the computed direction all match, and a reload restores the persisted language. | 4/4 |
| FE12 | Language switch while each of these is visible: required-field errors, a 403 banner, a no-permission state, the session-ended alert, the dev-login invalid-username error. Each re-renders in the new language and direction, with no old-language text left. With the notice shown, at **320 / 768 / 1280 px** in both languages: header height and wordmark width match the no-notice reference within 0.5 px, the wordmark fits, the notice sits below the header, there is no horizontal scroll, and axe is clean. | 4/4 |

**Negative control.** I ran the same spec on `aa0a68f1`, the round-13 source before FE10–FE12.

- These tests fail there, as designed:
  - R14-01: the alert renders but the form never appears (the F-480 blank/loop state).
  - R14-02 and R14-03: no session-ended message.
  - R14-05: no notice.
  - R14-06b: the error stays in the old language.
- R14-04a and R14-04b pass there too. They are regression guards.

## Full regression (both locale settings: `unset` = no LANG/LC_ALL, `cutf8` = LANG=C.UTF-8)

| Check | Result |
|---|---|
| typecheck, build, lint, `openapi:lint` (161 ops), `check:no-cdn`, `format:check`, contrast | all exit 0 |
| `pnpm test`: Node 22 ×3, Node 24 ×3, plus one run under CPU load | 7/7, 848 tests each |
| Integration on a disposable PostgreSQL, 3 runs per setting | 6/6, 652 tests each, UTF8/C; contract (161), blank-text, encoding, invalid-character, framework-errors, invalid-utf8, media-types, DB guards and evidence suites all included |
| Migrations | 0001→0019 applied, re-run idempotent |
| Product e2e (P1, P2 incl. Define→G2 and Design→G3, p2-blank-text, session-end, a20) | 72/72 per setting |
| QA-stack acceptance e2e (all specs incl. R8–R13 and R14) | 164/164 per setting, `server_encoding UTF8` line present; R8–R13 all pass |
| axe | 0 serious/critical over 334 unique scans per setting, error states included |
| `validate --register DG2`, `--pipeline`, `--reconcile` | PASS |
| Residuals D-057 (registry), D-058 (CI), D-049 (Keycloak) | PASS on the offline/config surface; the live residuals remain |

## Every non-zero exit and error line in my evidence, explained

- **`00-install-attempt1-erofs.log` (exit 226):** pnpm tried to write into HOME's read-only store, which the sandbox forbids by design. I retried with a `$TMPDIR` copy of the store, and it exited 0.
- **`12-migrations-attempt1-no-node-env.log` (exit 1):** my script omitted `NODE_ENV`, and the CLI refuses that (fail-closed). I retried with `NODE_ENV=development`, and it exited 0.
- **`18-r14-spec-dev-run1.log` (exit 1):** two defects in my R14-03 test.
  1. In AR, a non-exact link name matched two links.
  2. A tab followed "My Work", which makes no API request, so it could not learn that the session had ended.

  I fixed both. Dev run 2 passed 14/14.
- **`19-negative-control-*` (exit 1):** the designed failures listed above.
- **`32-residual-registry.log` (exit 124):** `deps:verify` was timed out waiting for the unreachable registry (D-057).
- **Lines that look like errors but aren't:**
  - `FSTDEP022` FastifyWarning (unit runs), a deprecation notice.
  - `BE17 db-econnreset` and `BE18 Q7 idp_unavailable` (integration), output of passing negative-control tests.
  - `npm warn Unknown project config` (npx reading the pnpm `.npmrc`).
  - Vite's chunk-size advisory (build).
  - The 3 documented prohibited contrast pairs, which the check expects to fail.
  - R11/R12 measurement lines.
- **A stopped background task:** one of my wait-loop helpers, not a test. The series it watched had already finished, every run with exit 0.

## Observation (not a finding)

When a session ends elsewhere and the user moves to a page that makes **no** API request, the cached signed-in shell stays until the next API call or the `/me` refetch. In P2 the static My Work page is such a page.

- **Why it is not a finding:** this follows FE10's documented rule, where a session end is a 401 from a request.
- **No data is exposed:** the server refuses every request.
- **The landing still comes:** the next action that needs the API lands once on sign-in, as R14-01 and R14-03 verify.
- **Evidence:** `test-evidence/DG2/qa/round-14/dev-run1-r14-03-en/test-failed-2.png`.

## Honesty notes

- All data is synthetic.
- No business approval (G1–G6) is implied, and a PASS here is not DG2 approval.
- `#0078FF` remains a provisional token.
- The disposable clones (`review-dg2`, `review-dg2-e2e`, `nc-aa0a68f`), the store copy and the screenshots scratch under `$TMPDIR` are removed at the end of the run.
