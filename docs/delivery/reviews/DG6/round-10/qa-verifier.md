# DG6 round 10 — qa-verifier narrative

**Verdict: PASS.** Candidate `sha256:56415aee…c392d1b3` (source `cde60365`, 2766 files) was confirmed on a disposable clone. HEAD `de4e7d23f` adds only the freeze metadata. No new finding.

## Open findings verified (qa-verifier.verifications.json)

- **F-DG6-560 (Medium) — CLOSED_VERIFIED.**
  - **API.** Round 8's reproduction P0–P3 passes on the real API (disposable PostgreSQL), and so do 14 adversarial cases (my probe, 18/18).
  - **UI.** On the real demo stack, in en and ar, the condition the author kept keeps its own literal.
  - **Round-10 additions (the F-DG6-580 class):**
    - A second save without a reload now sends the current version's token, and nothing is swapped.
    - A stale token is refused 422 `automation_rule.restricted_token_stale`.
    - A save after a concurrent save gets 409, a bilingual "changed, re-apply" alert and a reloaded form; the re-applied save keeps the literal.
  - **Mutants caught:** M2 (ordinal pairing) 22 failures, M1 (no version check) 8, W1 (no editor reload) 2.
- **F-DG6-561 (Low) — CLOSED_VERIFIED.** All 27 uses of the label pass an explicit scope. Rows and conditions show the item description in en and ar. Mutant L1 fails 10 candidate tests.

## Runs (all in disposable clones; details in qa-verifier.json)

| Area | Result |
|---|---|
| Static (build, typecheck, lint, openapi, no-CDN, format, contrast) | Pass. Lint and format first flagged only my probe files; a clean clone passes. |
| Unit: Node 24.21.0 and 22.22.0, locale unset and C.UTF-8 | Pass. Infrastructure errors re-run clean: a Vitest RPC timeout under load, and a sparse-clone folder. 22.22.2 is not installed. |
| Integration ×2 (118 migrations, 0001–0126) | 438/438 candidate files pass. One ENOSPC failure and one harness `uniq()` code collision each pass when re-run alone. |
| `tests/qa` alone | 45/45 files, 437 tests. |
| Product e2e, en and ar | Unset: 556 passed. C.UTF-8: 544 passed; the 7 browser crashes under OOM pass alone (74/74). |
| Root e2e (22 specs) | C.UTF-8: 288 passed. Unset: crash failures in the term scan pass alone. |
| Demo e2e | Pass, after re-running a crash and a dialog timeout alone and fixing my probe's 403 (wrong second writer). |
| Probes | Pass:<br>• AUD read-only pass<br>• reflow at 360/390 px and 200 % text<br>• the 400 shown in the selected language<br>• S17-001 row counts on screen<br>• cleared browser storage<br>• axe on detail screens<br>• XSS<br>• Arabic export literals<br>• concurrent job failures<br>• no restricted id on 66 routes |
| Reliability | A13 kill/restart drills pass; the D-203 burst gives one execution per event. |
| Load and export (provisional) | p95: read 38 ms, update 61 ms, dashboard 78 ms, export start 64 ms.<br>66 exports reach 100 %; download is requester-only.<br>Same LOAD-T20 generator residual as before. |
| Validator | Historical DG5–DG1, register DG6 and pipeline: all PASS. |

## Observations (not findings)

- **Cross-rule token.** A token copied from another rule whose row version coincides is accepted. It resolves only to the target draft's own literal, so it discloses nothing and swaps nothing, and the editor never sends one.
- **Failed reload after a 409.** If the reload GET itself fails, the "re-apply" alert still says the form shows the current version. The next save would be refused 422 stale, so nothing is misplaced.
- **Test-harness flake.** `uniq()` in `apps/api/test/support/harness.ts` uses 3 random bytes, and organization codes collided once (run 2). This is test-only.
- **Leftover label in my load driver.** The export-proof label still says "r8".
- **Assignment drifts.** The assignment asks for `round: 7` (the validator needs 10), names Node 22.22.2 (22.22.0 is installed) and says migrations end at 0125 (the tree ends at 0126).

## Open questions (D-232)

- **D-229.** Connector configuration names (`field_mappings` sources, `credential_refs`) are typed by people who already see that configuration. They are not served references to records, so they stay cannot-name.
- **D-228 (4).** The cross-organization ruling holds: the sweeps and my id-refs probe find no hidden id.
- **Token sequences.** No edit, grant change or concurrent-save sequence I tried loses or misplaces a hidden literal.

Engineering gates DG0–DG7 and product gates G1–G6 are unrelated; nothing here approves a business gate. All data is synthetic.
