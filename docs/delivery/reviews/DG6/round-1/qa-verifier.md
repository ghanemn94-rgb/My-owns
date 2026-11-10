# DG6 clean re-gate, round 1: qa-verifier narrative (T-DG6-REV-QA-RG-R1)

Candidate `sha256:b506084b2c497c82d6e4de07789d35314bf1b3e3bb83f1dd6bf420a6c4510451` (2769 files), source `98feb869cd85671b3e95679e13bd255c421cb80d`, freeze commit `d0ddff833`. Session `87fecc34`. Evidence: `docs/delivery/test-evidence/DG6/qa/round-1/`. My own tests (outside the candidate): `docs/delivery/test-evidence/DG6/qa/tests/round-1/`.

**Verdict: PASS, with no new finding.** No DG6 finding is open on this branch, so `qa-verifier.verifications.json` holds an empty list.

## Record notes

- **Round number.** The assignment's record-format section says `round: 7`. Three sources contradict that: the record path (`round-1/`), `stages.json` (review round 1) and the validator (`tools/gates/lib/rules.mjs:794` requires `rec.round` to equal the round entry). I recorded `round: 1` and take this to be a typo in the assignment.
- **Migrations.** The assignment says migrations `0001`→`0125`. The candidate holds 119 files from `0001` to `0127` (numbering gaps after 65, 72, 76 and 82), and both integration runs log "applied 119 migrations". `0126` (report snapshot aggregate) and `0127` (automation restricted-token key, D-233) are part of the candidate.

## Environment, and what I changed in it (all disclosed)

- **The clone.** The disposable clone is complete history, made with `git clone --shared` (alternates, not shallow). It uses a sparse checkout because the 2.6 GB of `docs/delivery/{handbacks,test-evidence,runs,reviews}` did not fit in the scratch volume: the first full clone hit "No space left on device", and I deleted that partial clone. None of those paths is in the manifest. The candidate id recomputed to `b506084b…` with 2769 files at both the freeze and the source commit.
  - One unit test, `tests/qa/unit/dlv038-s20-029-load-report.test.ts`, reads `docs/delivery/handbacks/DG6/T-DG6-DO-G-evidence/final/`. It therefore failed with ENOENT in my first two Node 24 unit runs. I then added that directory to the sparse set; the candidate id was unchanged. That test passed alone and in every later run.
- **Dependencies.** `pnpm install --offline --frozen-lockfile` exits 226 (EROFS): the shared pnpm store is read-only in the sandbox. Instead, I copied the repository's own `node_modules` trees (relative symlinks; `node_modules/.pnpm/lock.yaml` is byte-identical to the candidate's `pnpm-lock.yaml`). The build and every check then ran in the clone.
- **Playwright traces.** Traces default to `retain-on-failure`. With one worker, the temporary trace files grew to 1.6 GB and the volume fell to 1.1 GB free. I pruned temporary files older than 6 minutes. That broke 4 tests of the first product shard (ENOENT on reused trace resources). Their spec files were re-run (20/20). All later e2e runs used `--trace=off`, which changes no assertion.
- **Load.** The three reviews ran at once. The 1-minute load was 13–27 on 4 vCPUs throughout.

## Results

| Area | Result |
|---|---|
| Static (build, typecheck, lint, openapi:lint 932 ops, no-cdn, format, contrast) | 7/7 exit 0 |
| Unit, `pnpm test` | Every test passed in every run: unit-node 2902, unit-web 2111, nocodegen 259 + 2 skipped by design. Clean exit 0 in all four settings: Node 22 unset, Node 22 C.UTF-8, Node 24 unset, Node 24 C.UTF-8 (its second re-run) |
| Integration run 1 | 439/439 files, 4354 passed, 1 skipped, 1 todo, exit 0 (1 h 50 min at load 14–27) |
| Integration run 2 (two shards) | 220 + 219 = 439 files, 2081 + 2273 = 4354 passed, 1 skipped, 1 todo, exit 0 |
| tests/qa alone | integration 45/45 files (437 tests), unit 6/6 (61), exit 0 |
| Product e2e (unset) | 556 passed + 2 skipped of 558 |
| Product e2e (C.UTF-8) | 556 passed + 2 skipped of 558 (shards 278 + 1 skipped each, exit 0). A supplemental shard 2/2 from a second copy, whose partition also held my 4 probe specs, gave 282 passed + 2 skipped |
| Root acceptance (with-stack) | 288 passed + 18 skipped, in both locale settings; connection log: loopback only |
| Demo stack | 10/10 in both locale settings; connection log: loopback only |
| Validators | register DG6, pipeline, historical DG1–DG5: all PASS |

### Every failure, error line and skip, explained

- **Unit runs that exited 1.** Each first run, and one Node 24 C.UTF-8 re-run, ended with 1 Vitest "Unhandled Error: `[vitest-worker]: Timeout calling "onTaskUpdate"`". Every test passed in each of these runs. This is the runner's worker-to-main RPC timing out at a 1-minute load of 16–24 on 4 cores; DG5 QA round 2 recorded the same thing. Re-runs at lower load exit 0 on Node 22 in both locales and on Node 24 unset.
  - Node 24's first unset run also had one unit-web failure: `traceability.test.tsx` "workstreams list WS-nn codes…" could not find "Assign initiative" within its wait under load. Alone it passed 32/32, and it passed in every later run.
- **stderr in passing unit tests.** The React Router ErrorBoundary messages `raci.deliverables is not iterable` and `reading 'length'` come from the REQ-PB-011 header tests (`extension-fields.test.tsx`), whose generic mocks do not serve the RACI and benefit-totals bodies. The tests assert only the provenance strip. The orchestrator's V15 log has the same 10 lines.
  - React duplicate-key warnings come from fixture ids in `kpiUnit` and `percentKpi`.
  - `secret_ref.refused` is a warn log the secrets test expects.
  - None of these is a product defect.
- **Integration skip and todo.**
  - The skip is the `it.runIf` pair in `presentation.test.ts`, where exactly one branch applies.
  - The todo is `audit-events.test.ts:386` "PENDING T-DG6-BE-B: a caller admitted … sees it unredacted". It is a stale placeholder: `sensitive-reach.test.ts` tests that clause at lines 336 and 360, and both passed.
- **Product e2e.**
  - Shard 1 (unset) had 4 failures, all ENOENT on Playwright trace resources that my pruning had deleted, plus 10 serial followers that did not run. The re-run of `p4-governance`, `p4-traceability`, `p5-reflow-axe` and `session-end` gave 20/20.
  - The 2 real skips are `p6-walkthrough-keyboard`, which runs only on a demo database. I ran it on the demo stack: 2/2 in every run.
- **Root acceptance skips.** The 18 skips (per locale setting) are the 9 NOT SCANNED routes per language of `a20-p6-axe`, by that spec's own design (register note on REQ-DLV-038). The other 108 scanned entries per language have no serious or critical violation.
- **Probe re-runs.** My probes had to be re-run several times because of errors in my own probes, each kept as its own log and described in the record. There was no product failure among them.
- **Export proof.** `export-proof.mjs` exits 1 on "LOAD-T20 FAIL: no sameScopeOther user for this transformation". This is the dataset gap the REQ-S20-030 register notes disclose: not latency, not access.
- **Load dataset UUID check.** It reports 120 values that are not RFC 9562 (`methodology_coverage_link.id`, `procedure_step_definition.id`). These are ids written by migrations and product functions, not by the load generator, which is the README's documented behaviour. The API refused nothing: 0 errors in the workload.

## Independent probes (my tests, outside the candidate)

1. **Restricted-token sequences** (D-226, D-228 (1), D-233; the D-238 open question). I ran 5 cases on the real API: 5/5 pass.
   - A token duplicated into two conditions and into a mixed `in` list resolves to the hidden literal at each place.
   - Moving a token into `gt` is refused 422 `condition_invalid` and names no id.
   - A dry run (201, `conditionsMet: false`) and the rule, version and dry-run lists name no hidden id.
   - Draft v2 of a published v1, edited by a writer without the grant, keeps the literal, and v1 is unchanged.
   - Two concurrent saves with one If-Match: one 200, one 409 `version_conflict`, and the literal sits only where the winner put it.
   - A grant given between read and save and then revoked: the literal survives both transitions.
2. **Worker burst** (D-203, REQ-S20-013). 400 jobs: batch 8 × 4 lanes drained them at 91.9 jobs/s, against 23.4 jobs/s for batch 1 × 1. Two workers at once gave 0 duplicates; all jobs completed with retry_count 0.
3. **REQ-S15-007 clause 3, literally.** An Arabic export keeps 'KPI-001' and '12.5%' readable in PDF (drawn line), DOCX (LTR runs), PPTX, XLSX and CSV. The real KPI-register target text '12.5 %' stays one LTR run with the % after the number.
   - Observation: XLSX/CSV numeric cells hold the raw decimal (12.5) without a unit, per DG5's ADR-0046. The text cells keep the literal.
4. **P6 screens at 360 px, 390 px and 1280 px with 200 % text** (18 routes, en and ar, 54 measurements each). There was no page-level horizontal scroll and no stack-trace or infrastructure text, and axe at 390 px found no serious or critical issue.
5. **AUD read-only pass.**
   - The UI: no enabled mutation control on any of the 18 P6 screens.
   - The API: 7 P6 mutations with valid bodies (connector create, enable, test and disable; assistant enable; storage test; sensitive grant) all return 403, and the connector stays at version 1, disabled.
6. **XSS e2e** (the clause the register says has no e2e). The ADR-0052 payload set, in evidence-note titles and bodies, renders as literal text: no dialog, no injected global, no script, iframe, `img[src=x]`, `svg[onload]` or `javascript:` link.
7. **REQ-S17-001 on screen** (the "partial" the register discloses). A succeeded 5-row run shows Succeeded with rows read 5 and staged 5, committed Unknown and errors 5 in the run row and on the run page. The connector records a last-success time (en and ar).
8. **REQ-S15-012, all twelve walkthrough steps.** Each step link was opened with Enter on the demo stack. On every step screen, every visible enabled control in main (11 to 101 per screen) is reached by sequential Tab from the skip link, each with a visible focus indicator, and no pointer-only element exists. Collapsed `<details>` were opened by keyboard. Result: 2/2 in en and ar. The shipped spec, which performs steps 1 and 10 by keyboard, passed 2/2 too.
9. **Load and async export** (REQ-S20-029/030; PROVISIONAL, one shared 4-vCPU sandbox host at a 1-minute load of 17–21; not Mobily capacity).
   - The dataset: in-tree generator, `default` profile (50 / 1,000 / 10,000 / 100,000 / 120).
   - p95 figures: read 163.2 ms, update 263.4 ms, search 173.2 ms, dashboards 314.7 ms (Executive Overview 315.6, Finance 350.2, transformation 341.0, My Work 235.6), export start 329.1 ms. 14,504 steady requests, 0 errors, 0 rate-limit refusals. No miss against 2 s / 4 s.
   - This measures the dashboard class on the current tree, after BE-Z7B. The register note on REQ-S20-029 says this was a gap.
   - Export proof: 66 exports. Each start returned 202 at once with a job; progress rose to 100; another user and AUD got 404 on the export and its download.

## Open questions the orchestrator left to QA (D-238)

- **D-229 (connector configuration names stay cannot-name): acceptable.** Connector configuration names no sensitive record type: it names transformations, users and source systems. The only free text in it is a mapping `source` column name or a credential-ref name. These are written by connector administrators, who are also its readers. A sensitive id typed there by an admin who holds the grant is a deliberate free-text act, the same as in any description field. The product never serializes a record id into these columns. Job runs serve only error codes, and the automation audit events carry `content_sha256`, not the conditions.
- **D-228 (4) (cross-organization ids out of scope): acceptable.** Every D-218 helper scopes to the reader's organizations, and no route I probed reached another organization's records.
- **Token sequences.** No sequence I tried (duplicate, move into an `in` list, move into `gt`, draft-from-published, concurrent save, grant and revoke around a save, dry run) lost, misplaced or disclosed a hidden literal.

## Other observations (not defects)

- Draft labels vary in punctuation across screens ("Draft - not submitted", "Draft – not submitted", "Draft (not submitted)"). The shared LifecycleChip uses the literal REQ-S15-011 text, and the meaning is the same everywhere.
- The A20 evidence specs write to `test-results/` unless `QA_EVIDENCE_DIR` is set. A later Playwright run in the same tree wipes them. I collected them from the C.UTF-8 root run.
