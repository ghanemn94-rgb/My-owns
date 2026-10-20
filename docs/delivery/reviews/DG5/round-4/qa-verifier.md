# DG5 round 4: qa-verifier (T-DG5-REV-QA-R4C), narrative

**Verdict: BLOCKED.** Candidate `sha256:26d4ad92…` (2188 files, source `fb9c221`) was confirmed on complete clones at the start and at the end of the review.

## Why the verdict is BLOCKED

This run's shell sandbox does not allow new user namespaces: `/proc/sys/user/max_user_namespaces` is 0 and only uid 0 is mapped. All three database harnesses (`tests/qa/support/with-pg.sh`, `apps/web/e2e/support/with-stack.sh` and `e2e/support/with-demo-stack.sh`) run as uid 0 and start PostgreSQL as uid 1000 through `unshare --user`, because PostgreSQL refuses to run as root. That call fails with "Operation not permitted" (`03-sandbox-userns-blocker.log`). The earlier R4B run of this round could start PostgreSQL, so the sandbox has changed since then.

I did not work around the sandbox, for example by faking PostgreSQL's root check. Changing it is the user's decision.

These checks are therefore BLOCKED:
- both integration runs, `contract.test.ts` and the p5-pending lists;
- `tests/qa` on its own;
- every product, root and demo e2e spec;
- the AUD pass;
- the REQ-DLV-037 suite counts and the integration-generated samples;
- the prescribed real-stack verification of F-DG5-144.

To unblock: re-run in a session whose Bash sandbox allows the uid-1000 user namespace.

## What ran, and its results

- **Static checks:** all seven exit 0.
- **Unit tests:** six `pnpm test` runs, all green:
  - Node 22 and Node 24, each with the locale unset and with C.UTF-8;
  - two extra Node 22 runs at the same time, which pushed the load to 19.4.
  - The 18 stderr blocks are pre-existing and explained: the histogram is identical to rounds 2–3.
- **Validators:** `--register DG5`, `--pipeline` and `--historical` for DG4, DG3, DG2 and DG1 all PASS.
- **F-DG5-145: CLOSED_VERIFIED.**
  - The full-tree walk took 16–27 s on Node 22, against its own 150 s budget (5.5–9.1× headroom).
  - The guard test catches a real rule-4 mutant. The surviving mutant is equivalent, like observation (o).
- **F-DG5-144: not closed (no verification entry).**
  - The DB-free check rendered the real Diagnose screen and `ConflictPanel` in jsdom and laid them out in Chromium with the built CSS, at 390, 320 and 200 %, in en and ar. It shows 0 page overflow, and every register sits in a focusable, named region.
  - A control with the repair reverted brings the overflow back.
  - The demo-stack re-run of R3-DIAG and R3-REG, and the real 409 banner, could not run.
- **New finding F-DG5-146 (Medium, non-mandatory).** The DB-free P5 sweep took 156 snapshots of 13 P5 web test files at 390 px and 200 %, with axe. Two P5 tables sit in no scroll container:
  - the Form builder's field table: its wrapper, `div.table-scroll`, has no CSS rule anywhere;
  - the T14 Attachments table, which has no wrapper at all.

  The page scrolls sideways in en and ar, up to 281 px at 390 px. `ExportDialog` uses the same unstyled wrapper.

  Apart from the snapshot-only `document-title`, axe reports no serious or critical issue on any P5 snapshot.
- **Offline export samples (DB-free, renderer only):**
  - Arabic outputs carry their RTL markers in every format.
  - Unknown values are never shown as 0.
  - Provisional values are labelled.
- **D-175 observations:**
  - (n) is accepted as a readability observation. With 200 % text, `overflow-wrap: anywhere` breaks ordinary English words in narrow statement columns. Arabic words and column headers are never broken.
  - (o) is accepted.
  - (l) and (m) are left for the integration re-run; no test pins the old counts.

Every value used is synthetic. Nothing here approves anything real. The product's G1–G6 gates are unrelated to the engineering gates DG0–DG7.
