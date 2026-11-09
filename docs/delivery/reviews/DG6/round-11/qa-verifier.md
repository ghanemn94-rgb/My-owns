# DG6 round 11: qa-verifier narrative

**Verdict: PASS.** Candidate `sha256:c45d73b8…20ad2b` (source `33db1a46`, 2769 files) was confirmed in the repository and in a disposable clone. HEAD `4492cdfd0` adds only the freeze metadata. I raised one new finding, **F-DG6-740 (Low, not mandatory, not blocking)**.

## Open findings verified

None. I had no open finding from earlier rounds, so `qa-verifier.verifications.json` holds an empty list. As a regression check I re-ran the F-DG6-560/580 reproductions (P0–P17) on this candidate; they pass.

## BE-Z15 (D-233) challenged

**My API probe.** 23/23 pass (run 20b).
- **F-DG6-640 cases (P15, P15b).** These are refused with 422 `restricted_token_stale` and change nothing:
  - a token copied from another rule at the same row version, alone or mixed in a list;
  - a token from the published version pasted into its draft;
  - a version-1-row token forged at the draft's row version.
- **Other tags (P14).** Every other tag is refused: v-1, v+1, a random tag, and the retired `[restricted:<v>:<k>]` at the current version.
- **The key (P18).** It is in no response, header, audit row or outbox payload (hex or base64).
- **The tags (P18).**
  - Each is 24 hex digits.
  - They differ per row and per revision.
  - None contains a fragment of the row id.
- **Immutability (P19).** The 0127 trigger refuses a key change. All 41 rows have distinct 32-byte keys.
- **Concurrency (P20).** Eight concurrent saves give one 200 and seven 409. Each re-sent loser is refused stale.

**Mutants caught.**

| Mutant | What it reverts | Failures |
|---|---|---|
| Z1 | The tag hashes the row version only | 6 (3 of mine, z15 a/b/c) |
| Z2 | No issuer check | 15 |
| M2 | Ordinal pairing | 31 |
| W1 | No editor reload | 2 |
| L1 | The label always shows the total | 10 |

**In the UI (new step F, en and ar, both locales).** I pasted a foreign token into the editor:
- the save is refused 422 stale and nothing is stored;
- the form reloads;
- the next save sends only the rule's own token.

## New finding

**F-DG6-740 (Low).** The editor treats every stale-token 422 like a 409. After a token pasted from another rule, it says "This rule changed after you opened it" (Arabic: "تغيّرت هذه القاعدة بعد أن فتحتها"), though the rule did not change.
- The reload drops the author's other unsaved edits.
- The en/ar problem text that BE-Z15 corrected is never shown in the editor.
- No literal is lost, swapped or disclosed.
- The candidate's own z14 web test asserts this text, so it is the behaviour as built.
- Owner: frontend-ux-engineer.

## Runs (all in disposable clones)

| Area | Result |
|---|---|
| Static (build, typecheck, lint, OpenAPI 932 operations, no-CDN, format, contrast) | Pass, on a clean clone. |
| Unit: Node 24.21.0 and 22.22.0, locale unset and C.UTF-8 | Pass. Infrastructure errors passed when re-run:<br>• a file excluded by my sparse clone (ENOENT in dlv038);<br>• a Vitest RPC timeout.<br>Node 22.22.2 is not installed. |
| Integration, twice (119 migrations, 0001–0127) | Run 2: 441/441 files.<br>Run 1: one contract test timed out under load; it passes alone (218/218).<br>932/932 operations validated, 0 pending. |
| `tests/qa` alone | 45/45 files, 437 tests. |
| Product e2e, en and ar | 556 passed in each locale.<br>2 skipped: the keyboard walkthrough, which needs the demo database and passes on the demo stack. |
| Root e2e (22 specs) | 288 passed in each locale.<br>18 skipped: a20-p6-axe's NOT SCANNED routes, by design. |
| Demo e2e | 30 passed in each locale. |
| Probes | Pass:<br>• AUD read-only pass<br>• reflow at 360/390 px and 200 % text<br>• the 400 shown in the selected language<br>• S17-001 row counts on screen<br>• cleared browser storage<br>• axe on detail screens<br>• XSS<br>• Arabic export literals<br>• concurrent job failures<br>• no restricted id on any page the TL opens<br>Run 70 failed 2 tests: my error in run order. 70b and 71 pass. |
| Reliability | A13 kill/restart drills pass, and the D-203 batch-settlement tests pass. |
| Load and export (provisional) | p95: read 21 ms, update 33 ms, dashboard 45 ms, export start 40 ms.<br>Exports reach 100 % and download only for the requester.<br>LOAD-T20 is the known dataset gap. |
| Validator | Historical DG5–DG1, register DG6 and pipeline: all PASS. |

## Open questions (D-234)

- **D-229.** Connector configuration names stay cannot-name.
- **D-228 (4).** The cross-organization ruling holds; my sweep finds no hidden id.
- **Token sequences.** No sequence I tried loses or misplaces a hidden literal, and the 0127 key is not disclosed.

## Assignment drifts

- The assignment asks for `round: 7`; this record uses 11, to match the round folder.
- It names Node 22.22.2; 22.22.0 is installed.
- It says the migrations run 0001 to 0125; the tree ends at 0127.

Engineering gates DG0–DG7 and product gates G1–G6 are unrelated; nothing here approves a business gate. All data is synthetic.
