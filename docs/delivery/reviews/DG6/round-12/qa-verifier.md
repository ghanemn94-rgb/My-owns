# DG6 round 12: qa-verifier narrative

**Verdict: PASS.**
- **Candidate.** `sha256:c05864ba…314f5023c` (source `2495e036`, 2769 files). I confirmed it in the repository and in a disposable clone. HEAD `895b1e43b` adds only freeze metadata on top of the source commit.
- **Findings.** I raised no new finding.
- **F-DG6-740** (my round-11 Low) is **CLOSED_VERIFIED**.

## F-DG6-740 verified

I re-ran my round-11 reproduction on the real demo stack (`with-demo-stack.sh`), in chromium-en and chromium-ar, under both locale settings (runs 40 and 41, 30/30 each).

**Step F.** The author pastes another rule's token, at the same row version, into rule A's editor. The save is refused with 422 `restricted_token_stale`, and A is unchanged. The form's one alert now shows the problem text in English and Arabic:
- en: "…so nothing was saved. The rule editor shows the version as it is stored now…"
- ar: "…لذلك لم يُحفظ أي شيء…", with `dir=rtl`.

The 409 text "This rule changed after you opened it" does not appear. The form reloads A's own token, and the next save returns 200 and clears the alert.

**Step F2 (new).** A token in the retired pre-0127 form gives the same result.

**Step E.** A 409 still shows "changed, re-apply", and the stale-token text does not appear.

**Mutants.** Both are caught by the candidate's `rule-editor-tokens-z14.test.tsx`; the control run is 15/15.

| Mutant | What it does | Failures |
|---|---|---|
| Z16R | Restores RulePage.tsx from before the fix | 6 |
| Z16C | Routes a 409 to the stale-token alert | 2 |

**Where the new text can appear.** `restricted_token_stale` is thrown only on PATCH of a rule version. The only web caller is the rule editor, which reloads the stored version before it shows the text. So the new text is true wherever it appears.

## Regression of earlier token fixes

**My API token probe.** P0–P21 pass (23/23). It covers:
- edits, moves and duplicates;
- grant and sensitivity changes;
- 8 concurrent saves;
- cross-rule and published-to-draft copies;
- non-disclosure of the key and tag;
- reader independence.

**Round-11 mutants.** All are still caught:

| Mutant | Failures |
|---|---|
| Z1 | 6 |
| Z2 | 15 |
| M2 | 30 |
| W1 | 2 |
| L1 | 4 |

## Runs (disposable clones under `$TMPDIR`)

| Area | Result |
|---|---|
| Static | Build, typecheck, OpenAPI (932 operations), no-CDN and contrast pass.<br>Lint and format failed first, only on my own untracked probe specs. I had copied them into the clone too early. Run on the candidate files, they pass (01b). |
| Unit: Node 24.21.0 and 22.22.0, locale unset and C.UTF-8 | All tests pass: 2902 + 2111 + 259, plus 2 fuzz tests skipped by design in the nocodegen project.<br>Two runs exited 1 on a Vitest RPC timeout (`onTaskUpdate`) under load near 20. Their unit-node re-runs pass (02b).<br>Node 22.22.2 is not installed. |
| Integration, twice (119 migrations, 0001–0127) | 439/439 files, 4354 tests (1 skipped, 1 todo), in each run.<br>932/932 operations validated, 0 pending. |
| `tests/qa` alone | 45 files and 437 tests, plus 6 unit files and 61 tests. |
| Product e2e, en and ar, both locales | 556 passed each, split into two halves to stay under the 2-hour task limit.<br>2 skipped: the keyboard walkthrough, which needs the demo database. It passes in the demo runs. |
| Root e2e (22 specs), both locales | 288 passed each.<br>18 skipped: all are a20-p6-axe NOT SCANNED routes. |
| Demo e2e, both locales | 30 passed each. |
| Stack probes, both locales | 30 passed each:<br>• AUD read-only<br>• 360/390 px and 200 % reflow<br>• a 400 in the selected language<br>• S17-001 row counts<br>• cleared storage<br>• detail axe<br>• XSS<br>• "Last error" text |
| Reliability | The A13 kill-and-restart drills pass, and so do the D-203 batch settlement and my concurrent-failure probe. |
| Load and export (provisional) | p95: read 18.3 ms, update 29.1 ms, dashboard 39.8 ms, export start 34.8 ms.<br>Exports reach 100 % and are downloadable only by the requester.<br>LOAD-T20 is the known dataset gap. |
| Validator | Historical DG5–DG1, register DG6 and pipeline: all PASS. |

## Open questions (D-236)

**D-229.**
- `field_mappings` targets are restricted to identifiers by a pattern.
- Sources, `credential_refs` and `adapterSettings` are free text that only ADM_TECH (`connector.configure`) writes.
- No system path writes a record id into them.
- A reader (TO, KDS, TD, AUD, ADM_TECH) could learn an id only if a privileged writer who already knew it typed it there on purpose. That is the same exposure as any free-text field, so it is not a defect.

**D-228 (4).** The id-refs sweep finds no restricted id in either language or locale.

**Token sequences.** No sequence I tried loses or misplaces a hidden literal.

## Assignment drifts

- The record uses `round: 12`, not the assignment's `round: 7`, to match the round folder.
- The assignment names Node 22.22.2; 22.22.0 is installed.
- It says migrations 0001 to 0125; the tree ends at 0127.

Engineering gates DG0–DG7 and product gates G1–G6 are unrelated, and nothing here approves a business gate. All data is synthetic.
