# DG6 clean re-gate, round 2: code-security review (T-DG6-REV-CS-RG-R2)

- **Candidate:** `sha256:d62b187baa8377da4225f689799b013f0394a64b06fe844ba42fa82b2f6966a6` (2771 files), source `71ff750ed17ea281c99f20a85d9f9663bb07efb8`.
  - Verified on the working tree, on `--ref` of the source, on `--ref` of HEAD, and in the clone.
  - The product tree equals `ccd078e91`.
- **Reviewer:** code-security-reviewer, session `55761759-bd29-4701-b05a-5c7e72e3f8c5`.
- **Verdict:** **FAIL**.
  - New findings: one Medium (F-DG6-970), which D-192 requires to be repaired before the gate, and one Low (F-DG6-971).
  - Both open findings verify CLOSED_VERIFIED.
- **Engineering gates only.** Nothing here relates to product gates G1–G6. Product G6 never implies DG7.

## Open findings: both CLOSED_VERIFIED

| Finding | Re-run of the original reproduction | Mutant reverting the fix |
|---|---|---|
| F-DG6-920 (Medium) | My round-1 probe, which asserts the bug, now **fails**: the answer is withheld (log 30). `context-recheck` + `conversations` + catalogue pass 67/67 (31). | `recordRefsOf` ignores the context: cases 1 and 4 fail (33). |
| F-DG6-900 (Low) | The domain round-1 probe on the demo stack shows "Comparison basis: Baseline and formula version validated by Finance" in en and ar (51, screenshots). `explanation.test` passes 20/20, and p4-benefits e2e passes (35, 50). | The old labels restored: both locale cases fail (36). |

## New findings

**F-DG6-970 (Medium, REQ-S17-007, non-mandatory; owner backend-workflow-engineer).** The history channel escapes the §9 re-check.
- **The flaw.**
  - `historyOf` (`conversations.ts:440-449`, called at `:753`) sends the last 6 prompts and answers to the model with no readability check.
  - The new answer's `context_records` lists only this turn's retrieval items (`answer.ts:140`).
- **Reproduction.** Run with the shipped `http_endpoint` provider and a loopback echo model (log 32).
  1. The turn-1 answer names tA1 and tA2.
  2. The grant on tA2 is revoked, and the turn-1 answer becomes withheld (the 0128 repair works).
  3. Turn 2 asks to repeat. The withheld text goes to the model as history.
  4. The text comes back in a turn-2 answer served with `contentWithheld: false` and `context_records: []`.
- **Severity.** Rated Medium for the same bounded exposure as F-DG6-920: only the owner sees it, and the text was readable when it was produced. A literal reading of A12 ("a user scoped to X … returns no Y content") also fails after the revocation.

**F-DG6-971 (Low, REQ-S17-007, non-mandatory; owner backend-workflow-engineer).** The pre-0128 fallback breaks take-to-draft.
- **The flaw.** `assistant_suggestion_context_records_required` is `NOT VALID`, but PostgreSQL still enforces it on every UPDATE (`0128:75`). So take-to-draft of a suggestion stored before 0128 answers **422** `validation.constraint` (log 34), and the immutability trigger prevents a later repair of the row.
- **Why Low.** It contradicts the ADR-0059 §9 amendment and the data dictionary. But no released installation can hold such rows, because 0111 and 0128 ship together in the unreleased P6.
- **Disclosed probe runs.** Runs 1 and 2 failed in my own probe setup (0111 guard, version-step trigger) and are disclosed.

## What I ran (one disposable `--shared` sparse clone under `$TMPDIR`, removed afterwards)

| Check | Result |
|---|---|
| install, build, typecheck, lint, format, openapi-lint (932, 1.5.0-p6), no-cdn | exit 0. The Vite chunk-size advisory is disclosed. |
| `pnpm test`, Node 22.22.0 / 24.21.0 | 2904 + 2113 + 259 (2 skips by design) on each. Node 24's exit 1 is a Vitest worker RPC timeout at load ~20; the `--maxWorkers=2` re-run exits 0. |
| Integration, LANG unset / C.UTF-8 (2 shards each) | 440 files, 4360 passed, 1 skip (by design), 1 stale todo, exit 0. Contract 932/932, 0 pending. 0001→0128. |
| e2e, en and ar | 20 + 14 + 4 + 4 + 2 (demo) passed. The A21 connection log is loopback only. |
| P6 role sweep / AUD valid bodies | Pass 1 exits 1 by design (26 × 400 to an empty body). Valid bodies: 0 not refused, no AUD write. ADM-only sees nothing. |
| Token probes, F-DG6-380 probe | 31/31, 2/2. |
| Validators: `--historical` DG5…DG1, `--register DG6` | PASS. |
| Log scan, secrets scan | PASS. Only synthetic fixtures. |

**Re-used from my round 1**, for areas the 20-file repair diff cannot affect:
- the source review of the unchanged P6 modules;
- the dashboard load re-measurement;
- the commit-time and AUD-permission listings.

## Disclosures

- **ENOSPC.** The first full clone exhausted the shared volume. I removed my own copies and switched to `git clone --shared` with a sparse checkout.
- **Node 22.** It is v22.22.0, not 22.22.2.
- **`--configLoader runner`.** Not needed, because the clone's `node_modules` is writable.
- **Log filtering.** Passing-test lines are filtered out of the unit and integration logs.
- **Integration teardown.** The unset run has two "job run record failed: driver has already been destroyed" lines. They come from a teardown race in `automation-version-at-occurrence.test.ts`. The failure is logged by design (`worker.ts:132-136`), and the tests pass.
- **Unit-web stderr.** The `TotalsView` TypeError comes from a fetch mock in `extension-fields.test.tsx` T14. That test passes.
- **HEAD moved.** HEAD moved to `ed6389915`, the domain reviewer's auto-commit. I did not open its files. The candidate is unchanged.
