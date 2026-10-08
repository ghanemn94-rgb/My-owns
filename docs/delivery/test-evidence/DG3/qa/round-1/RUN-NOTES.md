# qa-verifier DG3 round 1: run notes (non-zero exits disclosed)

All runs in the disposable clone $TMPDIR/review-dg3 @ 928b7654 (candidate sha256:873115d9..., 753 files), removed at the end.

1. Integration run 2, first launch: started as a detached `( ... ) &` child of a background shell; the child was
   killed when its parent shell exited (log had only its header line). Not a product result. Relaunched properly as a
   background command; that run is 03-integration-run2.log (56/56 files, 791/791 tests, EXIT 0).
2. Full e2e, first attempt (both locale settings): `npx playwright test e2e apps/web/e2e` exited 1 in both settings.
   Cause: Playwright positional arguments are regex filters, and "e2e" also matched 19 archived DG2 QA specs under
   docs/delivery/test-evidence/DG2/qa/** that are present in the clone; they failed to load ("Cannot find module
   .../apps/web/e2e/support/ui.ts" relative to their archive folder) before any test ran. No product test ran. The two
   logs were overwritten by the corrected run, which passes an explicit list of the 13 spec files (11 product +
   e2e/a20-bilingual-shell.spec.ts + e2e/dg3-qa-r1.spec.ts): 04-e2e-cutf8.log and 04-e2e-unset.log, 200/200 each.
3. trials/07-trial-1..6.log: development iterations of MY spec (chromium-en, then both projects). Every failure there
   was a defect in my test, fixed in the spec, none in the product:
   - trial 1: my second TOM gap had no owner, which made G3's own criterion incomplete (my fixture);
   - trial 2: I created the North Star before the borrowed g2Records helper (which PUTs it without If-Match) -> 428;
   - trial 3: dependency types are configured by ADM_METHOD, not ADM (403 for dev.admin: correct product behaviour);
     my expectation that missingSections is empty before any investment/benefit line contradicts ADR-0024 §1;
     a check helper crashed on an undefined detail;
   - trial 4: GET of a single business-case line does not exist (list only) -> my lookup; G4 not ready because my
     plain (formula-less) benefit lines and missing initiative-case investment line are G4 missing items (correct);
   - trial 5: my 409 probe let the Sponsor, then submitter of the CURRENT submission, decide a superseded one: the
     product answers 403 gate.submitter_cannot_decide first (separation of duties before the version check; both
     refuse). Restructured to probe 409 with a non-submitter; ordering recorded as an info observation. The 0-100
     view is behind the "Show the 0-100 view" toggle (my check did not click it);
   - trial 6: chromium-ar only: the shared signIn helper sets the UI language with PUT /me/preferences, which my AUD
     write-tracker counted; tracking now starts after sign-in.
4. Final spec dg3-qa-r1.spec.ts sha256 c60747ce... adds one check (A6-selected-unfunded-cannot-launch-after-G2G3) to the
   version used in the full runs (sha256 ffc47765...). It was run on its own in both projects and both locale
   settings: 04-e2e-qa-final-{cutf8,unset}.log, 28/28 each, EXIT 0.
5. Unit runs labelled ar_SA: that locale is not installed (locale -a: C, C.utf8, POSIX), so glibc falls back to C; they
   are recorded as extra runs only. The binding "both locale settings" are C.UTF-8 and unset (02-unit-*-C/unset).
