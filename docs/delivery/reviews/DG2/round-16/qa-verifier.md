# DG2 round 16: qa-verifier

- **Verdict:** PASS, with one new **Low** finding, F-DG2-580. It is not mandatory and not a regression.
- **Candidate:** `sha256:0cab0a8c37924ead608f23b37be51336504ada1c95c928a4f80e2a93d2a4bb70` (562 files, source `e3b2375a`)
- **Run:** `DG2-T-DG2-REV-QA-R16-qa-verifier-20261007T154436Z-ac2c975a`
- **Assignment:** `docs/delivery/assignments/DG2/round-16/qa-verifier.md`
- I had no open finding to verify, so this round has no `.verifications.json`.

## Candidate and independence

- HEAD was `f4242ae4` (freeze and assignments) at the start, and `f81b75a9` at the end, after the other reviewers' auto-committed evidence.
- Of the 157 files changed since `e3b2375a`, none is a manifest entry.
- The candidate ID and `--diff` are identical at the start, at the end and in every clone.
- I wrote no product code.
- I did not open the other reviewers' round-16 records.

## FE14 / F-DG2-530: my probes (real API and PostgreSQL, EN and AR, both locale settings)

| Probe | What it does | Candidate | Pre-FE14 `7905e8b` |
|---|---|---|---|
| R16-01 | A **create** is in flight. The server commits it, and only the answer to the page is held. A signs out and B signs in in tab 2. Tab 1 is refocused and `/me` returns B. Then the answer is delivered. | 4/4: B never sees the record and is not navigated to it | **fails**: B is navigated to A's record |
| R16-02 | Same sequence with an **edit** (PATCH) | 4/4: A's edit never shows; A's id gives not-found | **fails**: no not-found (A's record is in the cache) |
| R16-03 | Same sequence with an **archive** | 4/4 | **fails**: A's record is shown to B |
| R16-04 | A normal create, edit, evidence upload and archive | 4/4: the screen updates, navigation works, one document throughout | passes (baseline) |
| R16-05 | Refocus after B signs in elsewhere, before `/me`'s 60 s staleTime | 4/4: the header never shows A's name with B-only data; 0 `/me` on a second refocus | **fails**: the header still shows A |
| R16-06 | A **create answered before the tab learns of B**, with no refocus | **fails 6/6**: F-DG2-580 | fails too |

R15-03 and R15-04 still pass in both settings. They cover:
- the session end that lands once, with `/me` bounded and no stale shell;
- a 403 that is never a session end;
- the language notice matching the shown language.

All the specs from R8 to R15, `session-end.spec` and the default-limits runs pass too.

## F-DG2-580 (Low, frontend-ux-engineer)

The sequence in `TransformationCreatePage`:
1. The 201 arrives while the tab still holds A's session generation, so it is accepted.
2. `refreshEffectivePermissions` refetches `/me`, which returns B. The identity reset runs.
3. The handler still runs `navigate('/transformations/<A id>', { state: { created: { code, name } } })`.
4. B's GET answers 404, and `CreatedNotVisible` shows A's code and name under B's header ("created, but you cannot open it").

Server-side authorization is intact. The race window is narrow, and the class is the same as F-DG2-530, so I rated it Low. A possible fix: stop silently, or recheck the session generation before navigating, once the generation has moved during the post-create steps.

## Full regression

| Check | Result |
|---|---|
| typecheck, build, lint, `openapi:lint` (161 ops), `check:no-cdn`, `format:check`, contrast | all exit 0 |
| `pnpm test`: Node 22 ×3, Node 24 ×3, plus one run under load | 7/7, 892 tests each |
| Integration, 3 runs per locale setting | 6/6, 652 tests each. Includes contract, blank-text, encoding, invalid-character, framework-errors, invalid-utf8, media-types, the DB guards and evidence. |
| Migrations | 0001→0019 applied; the re-run is idempotent |
| Product e2e | 74/74 per setting |
| QA-stack e2e | 184/184 per setting; `server_encoding UTF8` line present |
| Default limits | 8/8 |
| axe | 0 serious or critical violations: 350 unique scans (unset) and 362 (cutf8) |
| Validators | `--register`, `--pipeline` and `--reconcile` pass; the register has 32/32 IMPLEMENTED |
| D-057 / D-058 / D-049 | PASS on the offline/config surface; the live residuals remain |

## Every non-zero exit, explained

- **Dev runs 1 to 4 (exit 1):** defects in my own test.
  - The radio's accessible name includes its guidance text.
  - B's preferred language is AR.
  - The observer counted A's own textarea text.

  Dev run 5 passed 10/10.
- **Negative-control runs (exit 1):** the designed failures on `7905e8b`.
- **`18-r16-06-candidate.log`, `19-r16-06-{unset,cutf8}.log` (exit 1):** the F-DG2-580 reproduction.
- **`32-residual-registry.log` (exit 124):** `deps:verify` timed out with no network (D-057).
- **Integration ports:** the runs used 25331-25336, because my edit to move them to 26161 did not apply. Every cluster started on its first attempt.
- **Unset axe summary:** the R16-06 run overwrote the R16 summary file of the unset run. The in-test axe assertions passed. The script was fixed before the cutf8 run.
- **Lines that look like errors but aren't:**
  - the `WARN Failed to create bin mth-db` lines before the build;
  - Vite's chunk-size advisory;
  - the 3 documented prohibited contrast pairs;
  - test names and measurement lines from passing tests.

## Observation (not a finding)

The unit and integration runs left about 246 scratch directories (215 MB, `mth-evidence-it-*`, `mth-spa-*`) in `$TMPDIR`. I removed them. I did not check whether this is intended.

## Honesty notes

- All data is synthetic.
- This PASS is not DG2 approval and implies no G1–G6 business approval.
- `#0078FF` remains a provisional token.
- The clones, the store copy and the scratch directories were removed.
