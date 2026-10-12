# DG4 round 6: code-security-reviewer narrative

- **Task:** T-DG4-REV-SEC-R6
- **Session:** 2573804d-af74-4d2c-add7-8aaa96f32897
- **Candidate:** `sha256:f966fe5728e260b87544093d27faccb379195391894fafab6f567952f6bfe536`. Source `1e0dc5d`, freeze `0e499f2`, 1472 files. I recomputed it in a complete clone, and in the repository at the start and at the end.
- **Verdict: PASS.** I raise no new finding. F-DG4-106 is **CLOSED_VERIFIED**.

## F-DG4-106: verified closed

The repair, T-DG4-FE-R9B, is tests only: `session-bound.test.tsx` +66/-7, `session-generation.test.tsx` +6/-1 and `session-identity.test.tsx` +8/-2. No product, API, contract or migration change.

**What changed.** `Date.now`, the only clock `api/client.ts` uses for `SESSION_RECHECK_MS`, is now controlled for the whole spec file. So the 2 s window is crossed only where a test says so.

**Y1c is stricter, not weaker.**
- It keeps the exact count of 2 `/me`.
- It adds order assertions: the permission refresh is the first request after the 201, the created record's detail is the first page GET, and no `/me` comes after it.
- It also checks the session generation and the user name.

**The new case is correct.** It crosses the window at the detail GET and asserts exactly one revalidation, sent first. Its hook is evaluated inside the stubbed `fetch` before the scripted server records the request, so `crossedAt` is exact.

**My round-5 probe, unchanged.** I appended it to the new spec and ran every hold, at 2.2 s and 4.5 s. All 12 cases now give 2 `/me` and pass. In round 5, the summary and audit holds gave 3.

**Mutation check** (probe clone only, reverted):

| Mutation of `client.ts` | Result |
|---|---|
| None | 6/6 pass |
| M1: the window is ignored, so every page GET revalidates (an extra `/me`) | 4 fail (Y1c and the new case, EN and AR) |
| M3: the product never revalidates after the window | 2 fail (the new case, EN and AR) |
| M2 and M4: window stamps and single flight removed | Still pass |

M2 and M4 are equivalent mutants. The session-check runner is `queryClient.fetchQuery(keys.me)`, which joins a `/me` already in flight, so only one `/me` reaches the wire.

**Under load.** Over 8 full `pnpm test` runs, Y1c and the new case passed 48/48, at load 9–34 on 4 CPUs.

## Required checks

- typecheck, build, lint, openapi:lint (652 operations), no-cdn and format: exit 0.
- **pnpm test:** clean on Node 22 and Node 24, at load about 11. 2917/2917 pass, plus 259 in the no-codegen project with its 2 by-design skips.
  - Six runs at load 20–34 exited 1. The only failures were these:
    - first-render `findBy` waits over 5 s (raid, prioritization, p2-blank-forms, g1-agreements, traceability);
    - the architecture test at its 30 s limit;
    - a vitest RPC timeout.
  - With a longer wait (scratch config only), the same specs pass 90/90; the slowest test took 15.2 s. The unchanged control fails the same 4. So these are slow renders, not defects. They do not involve F-DG4-106, and every one is disclosed.
- **Integration:** 1975/1975 twice. Once with the locale unset (SQL_ASCII, Node 22) and once with `LANG=C.UTF-8` (UTF8, Node 24). Contract and migrations 0001→0061 included.
- **validate:** `--historical` DG3, DG2 and DG1, `--register DG4` and `--pipeline` all PASS. The pipeline step was re-run alone because the harness hit its 2 h background limit.
- **`--configLoader runner`** on the confined tree (read-only node_modules): the three repaired specs pass 80/80.

## Full review of the candidate

The product code is byte-identical to round 5. I re-ran all 15 of my earlier probes unchanged, each against its own disposable PostgreSQL. All pass:

- sweep 766: AUD gets 403 on every P4 write, ADM-only sees nothing transformation-scoped, and the outsider differences are D-111 and D-112;
- idor 204, body-idor 2, drill-scope 163, outcome-scope 3, currency 151, gross-currency 2;
- filter-scope 5;
- approvals 6, SoD 4, Finance 10, gate commit-time 6, slice-B ids 1, required members 2+2.

The static checks are unchanged:
- **Commit-time scan:** the residual list is identical to round 5's.
- **Module graph:** acyclic; `raid` never imports `governance`.
- **Worker:** imports no API code.
- **p4-pending:** all 43 lists are empty.
- **Problem.params:** optional and additive.
- **Decimals:** no float on money.
- **Migrations:** only added and contiguous through 0061, with guards and no DELETE/TRUNCATE grant. The assignment says 0028–0060; 0061 exists and is covered.
- **Exactly-once suites:** all pass, and so do the D-102 parity tests (8 per run).

## Residuals and process notes

**Residuals**, PASS on their offline surface: the live registry (D-057), the live CI (D-058) and Keycloak (D-049).

**Process notes:**
- **An unintended stop note.** I tried to stop my repeat unit runs to spare the integration runs, but `pkill` could not reach the other sandbox's process. Runs 3 and 4 completed and are valid. The summary file has a correction line after my wrong "stopped" note.
- **Independence.** HEAD moved to `99b387c` during my run: the domain reviewer's auto-commit, which I did not read.
