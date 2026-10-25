# DG5 clean re-gate, round 3: qa-verifier narrative

Run `DG5-T-DG5-RG-QA-R3-qa-verifier-20261024T225703Z-16b1a860`. Candidate `sha256:d8d831814a6065af8b417c862486dc2132ee6cca40bae0573f4918ff52e782c9` (2203 files), source `54e02b61961550386d5ab24a74e8ae8bb612218f`, freeze `bd2e7f9`. Full run notes, with every failure explained: `docs/delivery/test-evidence/DG5/qa/round-3/RUN-NOTES.md`.

## Verdict: PASS

The four conditions of the assignment hold:
- All 78 requirements are verifiable with evidence from this round.
- Every failure in my logs is disclosed and explained.
- No Critical, High or mandatory finding is unresolved.
- My two new findings are Low test-reliability defects that I do not consider blocking.

**Note for the orchestrator.** The validator requires every finding of the stage to be terminal before the gate passes. F-DG5-145 and F-DG5-146 are OPEN, so the gate needs either a test-only repair (my recommendation: it is small and matches F-DG5-141/144) or their acceptance as observations by a specialist and the release-auditor. I would assess either in the next round.

## My round-2 findings: both CLOSED_VERIFIED
- **F-DG5-143 (Medium).**
  - The repaired auditor test passes in the full product e2e in chromium-en and chromium-ar, in both locale settings.
  - Two mutants kill it at the new APPROVE_OR_MOVE assertion in both projects: the roadmap shows the auditor an "approve date" button (M1) or a "move" button (M2). On the restored build the spec passes 14/14.
  - A static probe of all 304 literal i18n keys on the three screens finds no write-button label that the old substring matcher caught and the new whole-word matcher misses. The two old-only button labels stay covered by the test's named-label assertion.
  - Observation, not a finding: the test has never covered some write labels (decide, revoke, withdraw, archive, edit). The old matcher did not cover them either.
- **F-DG5-144 (Low).** Raid test 5 took 24.6 s in chromium-ar under full-suite load with three reviews running (load median 6.2, max 16.8), against its new 90 s budget. All 14 tests of the spec ran and passed. The diff adds only the budget and timing annotations.

## New findings (Low, not mandatory, owner frontend-ux-engineer)
- **F-DG5-145.** `p4-benefits.spec.ts` test 8 (the auditor's read-only views, 390 px and 200 % text) runs on the default 30 s budget.
  - It took 25.7–25.8 s even alone at a load of about 8, and timed out at 30.2 s in the unset full run (chromium-en).
  - No assertion failed, and no step took longer than 1.5 s.
  - It is the F-DG5-141/144 class. The same test also exceeded 30 s in DG4 qa runs under load.
- **F-DG5-146.** `session-end.spec.ts` "signed out in another tab, then an in-app link" races My Work's paged work-items load.
  - The other-tab logout landed between two pages, and the next page was answered 401. The app correctly ended the session and showed the sign-in page with the message, before the test clicked the link it waits for, which no longer existed.
  - It failed in chromium-ar late in the unset full run, where dev.lead has more than 200 open work items.
  - It passes everywhere else, and this is its first failure in all the evidence.

## What ran (all in a disposable complete clone)
- Static checks: 7/7.
- Unit: 4/4, run inside the D-134 envelope (Node 22/24 × unset/C.UTF-8; 2350/1746/259 + 2 skipped by design).
- Integration twice: 3084 passed + 1 skipped by design (320 files; 846 operations; migrations to 0097; every pending list empty).
- tests/qa alone: 336/336 (A06 27, A07 12, A15 34, A16 30).
- Root acceptance specs: 30/30 in both settings.
- Demo stack: 18/18 and 8/8 in both settings.
- Product e2e, locale unset: 463 passed, 2 failed (the two findings), 5 did not run. Both specs pass 28/28 alone.
- Product e2e, C.UTF-8: 469 passed, 1 failed. My own disk guard caused that failure by deleting a shared Playwright trace resource. The spec passes 16/16 alone.
- Probes:
  - AUD sweep of 34 P5 screens: 0 problems in en and ar, in both settings (no mutation, no enabled write control, no overflow at 390 px or 200 %, axe 0 serious or critical).
  - F-DG5-140 regression: passes.
  - REQ-PB-093: the 30/20/20/15/15 and 95 % path passes in the Studio UI.
  - REQ-PB-090: the traceability screen renders the three B0147 chains.
  - REQ-S21-001: the inbox approval shows the synthetic label.
  - REQ-PB-087: the Day-90 screen on demo data passes.
  - REQ-S13-008: the executive-pack PDF labels pending values provisional.
  - REQ-S13-006: the CSV injection probe passes 9/9.
  - 82 export samples pass content-level direction and font checks.
- Validators: 6/6.

## Limits
- Raster rendering of the export samples is BLOCKED by the sandbox: LibreOffice needs a writable /tmp, and no PDF library is installed. The samples are in the evidence, and the inspection was at content level.
- Environmental residuals (live registry, live CI, a real IdP, AI and notification adapters) are recorded on their offline surface, as the assignment instructs.
