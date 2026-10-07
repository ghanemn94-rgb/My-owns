# DG2 round 15 — qa-verifier

- **Verdict:** PASS
- **Candidate:** `sha256:3f01c61090435f114b52150d1ab73818839530ede08a4c07d04936175f7fe8f9` (561 files, source `ed80b234`)
- **Run:** `DG2-T-DG2-REV-QA-R15-qa-verifier-20261007T130951Z-5a9d29e2`
- **Assignment:** `docs/delivery/assignments/DG2/round-15/qa-verifier.md`
- **New findings:** none. I had no open finding to verify, so this round has no `.verifications.json`.

## Candidate and independence

- HEAD was `9236a9f6` (freeze + assignments) at the start.
- During my run, HEAD moved to `0cf0d05` and then to `3cbdda88`, through the other reviewers' auto-committed round-15 evidence. Of the 152 files changed since `ed80b234`, none is a manifest entry.
- The candidate ID and `--diff` were identical at the start and at the end.
- I wrote no product code.
- I did not open the other reviewers' round-15 records.

## FE13 / F-DG2-500: my negative checks (real API + PostgreSQL, EN and AR, both locale settings)

| Probe | What it does | Candidate | Pre-FE13 `c44da6f` |
|---|---|---|---|
| R15-01 | A sees a record (list and **detail**). A real second tab's **Sign out** ends A's session. Tab 1 goes **Back** to an in-document `/login`, whose `/me` notices the end. B (`dev.lead`) signs in in the same tab. B walks **forward through A's history entries** (list, then A's detail), back again, and then opens A's detail URL. B's reads are held 1.2 s, and a MutationObserver records every moment A's text is in the document. | 4/4: never; B gets not-found | **fails**: A's record rendered for B |
| R15-02 | Identity change with **no 401**: A signs out and B signs in in another tab. Tab 1 is refocused after `/me`'s 60 s staleTime. | 4/4: B's identity never shown together with A's record | **fails**: observer saw both on `/transformations` |
| R15-03 | In-app session end. | 4/4: lands once on `/login?error=session_expired` with the localized message; URL stable 3 s; no shell; `/me` ≤ 3 (≤ 6 after Back); Back never shows A's record | passes (regression guard) |
| R15-04 | A real 403 `csrf` and a 403 `forbidden` (route-replaced). | 4/4: never a session end; cache kept; the language notice equals the shown language's string, both directions | passes (regression guard) |

All earlier specs pass in both locale settings: R8 to R14, the product session-end spec (including FE13's own test) and the default-limits runs.

## Full regression

| Check | Result |
|---|---|
| typecheck, build, lint, `openapi:lint` (161 ops), `check:no-cdn`, `format:check`, contrast | all exit 0 |
| `pnpm test`: Node 22 ×3, Node 24 ×3, one run under load | 7/7, 866 tests each |
| Integration, 3 runs per locale setting, disposable PostgreSQL | 6/6, 652 tests each. Contract, blank-text, encoding, invalid-character, framework-errors, invalid-utf8, media-types, DB guards and evidence all included. |
| Migrations | 0001→0019 applied; re-run idempotent |
| Product e2e (P1, P2 incl. Define→G2 and Design→G3, p2-blank-text, session-end, a20) | 74/74 per setting |
| QA-stack e2e (all specs, R8 to R15) | 174/174 per setting; `server_encoding UTF8` line present |
| Default rate limits (R14-03 + product same-IP test) | 8/8 |
| axe | 0 serious/critical violations over 348 unique scans per setting |
| `validate --register`, `--pipeline`, `--reconcile` | PASS |
| Register rows | 32/32 IMPLEMENTED, final gate DG2 |
| D-057 / D-058 / D-049 | PASS on the offline/config surface; the live residuals remain |

## Every non-zero exit, explained

- **`00-install-attempt1-*-storepath.log` (exit 1, `ERR_PNPM_NO_OFFLINE_TARBALL`):** my `--store-dir` pointed at the `v10` level. I corrected the path, and the retries exited 0.
- **`18-r15-spec-dev-run1..5` (exit 1):** defects in my own test. Details are in check QA-R15-18:
  - Back-walk entries were replaced, so the walk reached `about:blank`.
  - B's preferred language (AR) applies after sign-in.
  - `/me`'s 60 s staleTime meant an early refocus fetched nothing.

  Dev run 6 passed 8/8.
- **`19-negative-control-*` (exit 1):** the designed failures of R15-01 and R15-02 on pre-FE13 code.
- **`32-residual-registry.log` (exit 124):** `deps:verify` was timed out while waiting for the unreachable registry (D-057).
- **Lines that look like errors but aren't:**
  - FSTDEP022 (a deprecation notice).
  - npm "Unknown project config" warnings.
  - Vite's chunk-size advisory.
  - The 3 documented prohibited contrast pairs.
  - The BE17/BE18 negative-control output and the QA-R11 to R13 measurement lines, all from passing tests.
- **Stopped background task:** one wait-helper loop I started hit its time limit. It was a helper, not a test. The runs it waited on finished, every one with exit 0.
- **Refused command:** the permission classifier refused one read-only command (reading `e2e/support/qa-stack.sh` in the clone). I didn't retry it. I used the harness exactly as round 14's `run-e2e.sh` documents.

## Observation (not a finding)

When another tab of the same browser signs out and signs in as B, a tab that saw no 401 keeps showing A's identity and A's already-loaded data. This lasts until its `/me` is refetched (in my runs: a refocus after `/me`'s 60 s staleTime; dev runs 4 and 5).

Two things I did not probe:
- Requests made in that window run under the browser's current cookie.
- Whether interacting in that window, before the refetch, can reach other cached A queries.

This is not a finding:
- What that tab shows was already on screen in a shared browser.
- FE13 documents the `/me` re-probe as the trigger for an identity change without a 401.
- Once `/me` returned B, the purge ran before B rendered (R15-02 passes; it fails on pre-FE13 code).

## Honesty notes

- All data is synthetic.
- A PASS here is not DG2 approval and implies no G1–G6 business approval.
- `#0078FF` remains a provisional token.
- The disposable clones, the store copy and the screenshot scratch under `$TMPDIR` were removed.
