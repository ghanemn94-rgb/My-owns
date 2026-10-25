# DG5 round 1 (corrected clean re-gate): qa-verifier narrative

**Verdict: PASS**, with one new finding: **F-DG5-140 (Low, not mandatory, not blocking)**.

Run: `DG5-T-DG5-RG2-QA-R1-qa-verifier-20261025T155325Z-8f612da4`. Candidate `sha256:ff3bc2c4…1008` (2203 files), source `2fe8f853e54ef7ab7b88527f11633c0c3542edd6`, freeze `f816fb2`. I verified the candidate on a complete clone at the start and the end of the review. The product tree equals the first re-gate head `5a7c189` outside `docs/delivery`.

## What I ran (all this round, on this candidate)
- **Static checks:** 7/7 exit 0. OpenAPI has 846 operations.
- **Unit:** `pnpm test` on Node 22 and Node 24, locale unset and C.UTF-8. All 4 runs exit 0 with 2350 / 1746 / 259 + 2 skipped by design.
- **Integration:** run twice on a disposable PostgreSQL. Each run: 320 files, 3084 passed + 1 skipped by design. The contract test passes 83/83. Migrations run 0001→0097; the 8 retired ids are documented. All 43 `p5-pending` files have empty lists.
- **tests/qa alone:** 336/336 integration and 22/22 unit.
- **REQ-DLV-037:** A06 27, A07 12, A15 34 and A16 30 tests pass on this candidate. I inspected 62 PDF/DOCX/XLSX/PPTX samples in en and ar. Each file has the correct text direction for its language and the B0004 statement in that language. None claims official PMI status or certification, and none names DG0–DG7.
- **Product e2e:** C.UTF-8 470/470. With the locale unset, 455 passed and 5 failed. Four of the five were 30 s timeouts at a load of 12–18 on 4 cores. The fifth was a sign-in miss during the window when the shared disk was full. The five spec files re-run alone passed 70/70. I record these as observations, not defects.
- **Root acceptance specs:** 30/30 in both locale settings. Demo-stack specs: 12/12 in both settings.
- **My probes:** these cover clauses the register calls partly covered.
  - AUD read-only pass, axe, 390 px and 200 % text on 42 P5 screens: 84/84 in each setting.
  - REQ-PB-093 driven through the Studio UI: passes in en and ar, both settings.
  - Demo probes, 8/8 in each setting:
    - D1: the REQ-PB-090 chain on the rendered traceability view.
    - D2: the REQ-S21-001 label on an approval opened from the inbox.
    - D3: the REQ-PB-087 Day-90 screen.
    - D4: the REQ-S18-001 banner on 29 P5 screens.
  - REQ-S13-008 on a generated executive pack: 3/3.
  - REQ-S05-006: OpenAPI coverage of the twelve record types.
  - REQ-S08-019: my independent NPV oracle agrees with ADR-0047 §5.
- **Validators:** `--register DG5`, `--pipeline` and `--historical` for DG4, DG3, DG2 and DG1, all PASS.

## Finding
**F-DG5-140 (Low).** Before any branding version is saved (version 0), the worker's export runner prints `DEFAULTS.productName` ("Mobily Transformation Hub") in every language. ADR-0049 §8 defines version 0 as "Mobily Transformation Hub" / "منصة موبايلي للتحوّل". The API and the Arabic shell use the Arabic name, but all 25 Arabic PDF/DOCX/PPTX headers show the English one. REQ-S01-002's literal acceptance still holds. This is a cosmetic bilingual inconsistency. Owner: backend-workflow-engineer.

**Id note.** The history branch `5a7c189` also used F-DG5-140, and closed it there. This branch has no DG5 findings, and the assignment requires ids from F-DG5-140 onward.

## Observations (not findings)
- The rooted traceability view shows the platform's deliverable and capability nodes between the initiative and the KPI. The five B0147 labels still appear in chain order.
- The Studio-default weight set's rationale is generated English text, and it also shows in the Arabic prioritization screen.
- Unit stderr comes from fixture artefacts in passing tests: the RACI and benefit-totals mocks in `extension-fields.test.tsx`.
- Under heavy concurrent load, some long journeys cross 30 s. Alone they finish in 13–21 s.

Details, invalid probe attempts and every error line are in `docs/delivery/test-evidence/DG5/qa/round-1/RUN-NOTES.md`. The per-requirement matrix is in `15-requirements-matrix.md`.

Product gates G1–G6 are business approvals inside the product. Nothing here grants a business, Finance or IT approval, and nothing relates them to DG0–DG7.
