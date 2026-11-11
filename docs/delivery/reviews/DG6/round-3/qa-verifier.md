# DG6 clean re-gate, round 3: qa-verifier narrative (T-DG6-REV-QA-RG-R3)

- **Candidate:** `sha256:32e41b5581a9beeba357a6c0dd5b50c414226910232ebfbb711c2178024376b5` (2773 files). Recomputed on the complete working tree of the main repository (HEAD `c31732980`, not shallow) at the start and the end, and over the full tree of the source commit with `--ref`. The source commit is `f56f1b3d24c00d1803f6627c99b3f422a47b3014`. HEAD descends from it, and the two differ only in `docs/delivery/**` (the freeze and the interrupted-run records). `git diff a0cf22bba f56f1b3d2 -- . ':!docs/delivery'` is empty.
- **Session:** `9aa58015-f0cb-410b-af49-b3e7df0efc21`, run `DG6-T-DG6-REV-QA-RG-R3-qa-verifier-20261111T014659Z-9aa58015`.
- **Verdict: PASS.** No new finding. The four open findings (F-DG6-960, F-DG6-970, F-DG6-980 and F-DG6-971) each verify CLOSED_VERIFIED.
- **Scope of this record:** engineering only. Nothing here grants or implies a business, Finance or IT approval (G1–G6), and product G6 never implies DG7. All data is synthetic.

## How I ran it

- **Two lean disposable clones** under `$TMPDIR`: `rv` and `rv2`, both shared-object, sparse checkouts of the source commit.
  - `rv` ran the probes and mutants, static, unit, integration and the load run; `rv2` ran e2e.
  - Each clone has its own writable `node_modules`, installed offline from a copy of the pnpm store. The default Vitest config loader therefore works for `pnpm test` and `pnpm test:integration`. I added `--configLoader runner` to every direct `npx vitest` call, as the assignment asks.
  - The root A06/A07 specs got `E2E_SCREENSHOT_DIR` in my evidence folder.
  - The A17 webhook suites got `MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001`, a synthetic test value.
  - Every port was in 32500–32599, through `MTH_PORT_POOL`.
- **Node:** 24.21.0 and 22.22.0. `/opt/node22/bin` is present, and its version is 22.22.0, not the 22.22.2 the assignment names. I record the version I actually ran.
- **Scripts and logs:** `docs/delivery/test-evidence/DG6/qa/round-3/scripts/`. Every log starts with `## start` and its command, and ends with `## end … rc=N`; each `.rc` file holds that exit code.
- **Independence:** I formed the verdict without reading any other reviewer's round-3 record; the sandbox hides them in any case. I read the round-2 sidecars and probes of the other reviewers because the assignment asks me to re-run the probes that raised the open findings.

## The repair (T-DG6-BE-RG2), read line by line

| Area | What I checked | Result |
|---|---|---|
| `historyFor` (conversations.ts) | Each earlier `answer` passes `withheld()` over `recordRefsOf` (citations ∪ context; citations only before 0128) for `first.fresh`, the principal reloaded in transaction 1. Withheld answers are dropped before the 6-message window is taken. User prompts are kept (they are the owner's own text). | Correct. Probes P1, P4 and P7. |
| Inheritance (answer.ts) | `contextRecords = merge(own data block, historyContext)`. Suggestions store `outcome.contextRecords`. | Transitive and correct. P1 and P3. |
| Cap | The union is ≤ 50 answers × 20 records = 1,000. `budget = 1000 − max_context_records`. The newest-first drop never fires within the real limits. | The bound is exact. P5 reaches turn 50 with a 1,000-key context, no history drop, and turn 51 refused (422 `assistant.conversation_full`). |
| Race | A revocation that commits after `historyFor` and during the model call. | The stored context inherits, so the reply is withheld in the POST response and on GET. P2. |
| Other channels to the model | `answer.ts:142` is the only `ModelProvider.complete` call (grep), and `postAssistantMessage` is the only caller of `answer`. The model receives only the system text, the history, the data block and the prompt; there is no conversation title or suggestion text. A prompt that retrieves nothing does not call the model (`no_sources`). | No other channel. |
| Migration 0129 | Both NOT VALID CHECKs are dropped. BEFORE INSERT ROW triggers of the same names raise 23514 with the same constraint name. `p6_assistant_context_records_valid` accepts ≤ 1,000 keys. The 0128 immutability trigger is unchanged. | P8: `tgtype 7`, legacy to-draft 200, setting a context later gives 23514 immutable, and an INSERT without a context gives 23514 required. |
| 0128→0129 window | P6 simulates an answer stored by the RG1 code (own data block only) that repeats a withheld answer. After the revocation it stays readable and is sent as history. | This is the disclosed residual. It exists only where the unreleased RG1 build ran. DG6 is not approved and nothing has shipped, so this is not a defect of this candidate. The same reasoning governs the pre-0128 limit RG1 recorded. |
| Code-security probe disclosure | The probe's fake answers a **hard-coded** text naming both titles when the history holds no assistant message (its line 46). | P4 shows the request holds neither the title, nor the fact, nor the id. The probe's residual failure is an artefact of its fake. Disclosure accepted. |

**Mutants:**
- **M1:** `conversations.ts` and `answer.ts` reverted to `71ff750ed`. It is caught by my round-2 probe (the original F-DG6-980 facts return), by P1–P5 and by the shipped history-recheck cases 1–3.
- **M2:** 0129 removed. It is caught by the shipped case 4 (422 `validation.constraint`) and by the code-security legacy probe.
- **Restoration:** the clone was restored and `git status` was empty afterwards.

## Results

| Check | Result |
|---|---|
| Static | Typecheck, lint, OpenAPI lint (932 operations), no-CDN, Prettier and contrast (50 pairs pass, 3 prohibited pairs fail as documented): all exit 0. |
| Unit | Node 22 and 24 × locale unset and C.UTF-8: all 4 runs exit 0. unit-node 191 files / 2906 tests; unit-web 125 / 2113; nocodegen 3 / 259 + 2 skipped by design. |
| Integration | Run 1 (unset) and run 2 (C.UTF-8): each 441/441 files, 4366 passed, 1 skipped (a `runIf` pair), 1 todo (a stale placeholder), exit 0. "applied 121 migrations" = 0001–0129. contract.test.ts 105/105. Route inventory: 486 unsafe operations, 0 pending. |
| tests/qa alone | Integration 45/45 files, 437 tests; unit 6/6 files, 61 tests. |
| e2e product (apps/web/e2e) | Unset: 556 passed, 2 skipped. C.UTF-8: see the record. The 2 skips are the keyboard walkthrough, which skips itself off a demo database; it passed on the demo stack. |
| e2e root acceptance | Unset: 288 passed, 18 skipped, and the connection log PASSes (936 connections, all loopback). C.UTF-8: 288 passed, 18 skipped. The 18 skips are a20-p6-axe's declared NOT SCANNED detail routes. |
| e2e demo | 10/10 in each locale setting. |
| A20 evidence re-run | 82 passed, 18 skipped. axe: 76 screen/viewport entries per language, 0 serious or critical. |
| Probes | 360/390 px and 200 % reflow, AUD read-only, XSS as text, S17-001 run counts on screen: 8/8. Keyboard walkthrough on the demo stack: 4/4. Restricted tokens: 5/5. Arabic export literals: 6/6. Worker burst: 2/2 (130.0 vs 33.8 jobs/s, 0 duplicates). |
| Load | Provisional: all classes within target. Worst p95: read 13.4 ms, update 20.9 ms, search 12.1 ms, dashboard 29.3 ms, export start 23.5 ms. Async export: 66 exports, starts 202, progress reaches 100, the other user and AUD get 404. export-proof exits 1 only on the disclosed LOAD-T20 dataset gap. |
| Validators | `--register DG6`, `--pipeline`, and `--historical` for DG5, DG4, DG3, DG2 and DG1: all PASS. |

## D-229 and D-228 (4)

Neither is a defect.

- **Connector configuration:**
  - The configuration names no sensitive record type; the sensitive types are benefit, business case and evidence.
  - `fieldMappings` is `{source, target}`, and `target` is limited to an identifier pattern. The only free text is the mapping source column and the credential-ref names. Connector administrators set them and also read them (`connector.read`).
  - A sensitive id typed there would be a deliberate free-text act, like any description field. The product never serializes a record id into these columns.
- **Restricted tokens:** my token-sequence probe re-ran 5/5. It covers a duplicated token, a token moved into an ordering condition followed by a dry run, a v2 draft by a writer without the grant, two concurrent saves with one If-Match, and a grant given and revoked between read and save. No sequence lost or misplaced a hidden literal.
- **D-228 (4):** the D-218 helpers scope to the reader's organizations. The route-inventory case 3b (a user of org B holding every role there) got 403/404 on all 312 operations that address an org A record, and nothing was persisted.

## Disclosures

- **P6 run 1** failed in my own probe's setup. I gave the user no grant on tA3, so A2 was a `no_sources` reply, and 0128's `assistant_message_context_records_valid` refused a context on it. I fixed the probe, and run 2 is 8/8.
- **Probes that fail by design on the candidate (log 30):**
  - The code-security history probe fails because it asserts the defect, and its fake returns a hard-coded text.
  - The legacy-suggestion probe fails in its own setup DDL, because the CHECK it drops no longer exists.
  - Both are explained in the verifications.
- **OOM kill:** while the second clone was building, the kernel reported an out-of-memory kill. Its build exited 0, and every later run is complete, so no result I cite depends on the killed process.
- **A20 evidence:** the root runs' axe summaries default to `test-results/`, which later Playwright runs clear. I re-ran the two A20 specs with `QA_EVIDENCE_DIR` pointed at my evidence folder (log 25).
- **Contract count:** `contract.test.ts` prints no operation count. It asserts that every governed route maps to an operation and back, and the OpenAPI lint counts 932.
