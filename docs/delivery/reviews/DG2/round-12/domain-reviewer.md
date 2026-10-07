# DG2 round 12: domain-reviewer narrative

- **Candidate:** `sha256:5dfecce44b9d7d4ded6ca45968c9e2686d1c011cdd7c906ba3dc9974bbdf92b8` (552 files). Source `8488e7a4`, freeze commit `744af0b2`.
- **Verdict: PASS.** No new findings, and no open findings to verify.

## What changed since round 11 (D-072), from the domain angle
The product diff `cbdb4f6..8488e7a` covers 19 files:
- evidence routes and store: a three-phase upload, with the body received while no database connection is held;
- the central incomplete-body 400 in the platform hooks;
- the pool bounds;
- `RecordForm`: `onValuesChange` is now reported from an effect;
- `JourneysSection`: the step key is now generated outside the updater;
- tests.

Nothing changed in i18n, migrations, seeds, the playbook source, gate criteria or the register modules. The methodology content is untouched.

## Live evidence (disposable PG16 + API, synthetic data, Node 24 build)
- **Full P2 walk.** The full walk (live-scenario: 101/101) passes again:
  - G1→G2→G3 are decided in order, with the B0023 names, and out-of-sequence submissions are refused;
  - the 14-field charter has the composed B0037 thesis and the five B0039-B0043 checks;
  - there is exactly one current North Star;
  - the 3-5 outcome warning, the good-outcome test, and G2 blocked at zero guardrails all work;
  - there are 10 TOM dimensions (B0056), the B0062 canvas and 6 workstreams (B0029);
  - T01-T04 have their source columns;
  - Arabic text with RLM is stored verbatim, and invisible-only values are refused with the localized message in EN and AR.
- **D-072 upload behaviour** (r12-delta-api, 9/9):
  - A normal file still round-trips byte-identical with its Arabic+RLM+emoji name.
  - With 24 slow uploads in flight (more than the pool of 20), other users' reads and a charter write were answered within 22 ms, and no session was idle in a transaction. All 24 uploads then completed byte-identical.
  - Interrupted JSON and upload requests get the localized 400 `validation.malformed_request` with nothing stored.
- **Browser, EN (LTR) and AR (RTL):**
  - evidence upload and download through the dialog;
  - the team assignment dialog: the B0018 preview follows the role, the assignment is recorded, and there is no console warning;
  - the journey steps editor: add, reorder and save, keeping the decimal cycle time;
  - the B0009 mode guidance;
  - the gates pages: business approval, with G4-G6 marked not available in this release;
  - the provisional wordmark;
  - no PMI or Mobily certification claim.

## Disclosed failures (all mine, all explained in the record)
- **First Node 24 pass:** exit 127, because pnpm was not on my PATH. I re-ran it with the correct PATH.
- **`r12-team-ui` attempt 1:** 8/10. My console assertion counted Chromium's automatic "Failed to load resource" lines. They come from three answers, all by design:
  - the pre-login `401 /me`;
  - the documented dev-login availability probe, which answers 400;
  - `404 /users/:id` for a lead who cannot read the user directory. The UI then shows team-role labels instead.

  Attempt 2 lists them by URL and passes 10/10.
- **`r12-journey-steps-ui` attempt 1:** a selector error in my probe. "Edit steps" sits inside the journey detail. Attempt 2 passes 6/6.

## Observation (not a finding)
- **G3 on a fresh transformation.** The gate card shows "1 of 5" outputs complete, because `g3.design_decisions` is a documented pure prohibition. G3 still cannot pass without the TOM, gap matrix, capability gaps and future journeys.

## Environmental residuals (not gate checks)
These were not checked live: live registry (D-057), live CI (D-058) and Keycloak (D-049).
