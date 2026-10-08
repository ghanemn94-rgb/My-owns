# Assignment T-DG3-FE-D: P3 end-to-end journeys on the real stack, including G4 end to end (frontend-ux-engineer)

## Stage and working tree

- **Stage:** P3 "Mobilization and portfolio", gate DG3 (BUILDING).
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory, on branch `dg3/fe-d`, at the integrated `HEAD`:
  - every P3 backend task (BE-A…BE-E, KBE-A…KBE-C, ARCH-01…03);
  - every P3 screen (FE-A0, FE-A, FE-B, FE-C), plus FE-E's completion: funding decisions, capacity editing, deliverables, milestones, waves and audit labels;
  - ARCH-04's `0027` and the shared mirrors;
  - G4 is enabled (`0026`);
  - all 270 contract operations are routed.

  `node_modules` is installed and the packages are built.
- **Concurrency (D-004):** BE-F (one G4 evaluator item, `g4.schedule_unknown`, plus two `gates.json` keys) and the transformation-analyst (`requirements.csv`) run alongside you in their own worktrees.
  - You own `apps/web/e2e/p3-journeys.spec.ts`, its screenshots under `apps/web/e2e/screenshots/{en,ar}/p3-journey-*.png`, and new helpers in **new** files under `apps/web/e2e/support/` if you need them. Never edit an existing support file.
  - You may **fix product web code** (`apps/web/src/**`) only where a journey exposes a real defect. Keep each fix minimal, add a web unit test for it, and list it in the handback. Never touch `apps/api/**` or `packages/**`. A backend defect goes in the handback, with its reproduction.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** the hard limit is about 2 hours. Run `date -u` at the start and at the end. Build the journeys in the order below. If you pass about 100 minutes, keep what passes and write the handback.

## Environment

- Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
- Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`). Never run `playwright install`.
- **Your harness ports are 23800–23849 only** (`apps/web/e2e/support/with-stack.sh`: `QA_PG_PORT`, `E2E_API_PORT`, `MTH_PORT_POOL`).
- Remove any empty `.claude/.cc-writes` directories inside source folders before you run tests.

## Read first

- The FE-A, FE-B, FE-C and FE-E handbacks in `docs/delivery/handbacks/DG3/`, for the screens, their flows and their selectors.
- The existing e2e specs `apps/web/e2e/p3-{portfolio,prioritization-roadmap,business-cases,ui-completion}.spec.ts`, and `apps/web/e2e/support/ui.ts`.
- The seed users (`seed-dev`).

**Your journeys go further than those specs:** one continuous story through the whole Mobilize phase, ending in an approved G4. Note that BE-F, running in parallel, makes an Unknown schedule a G4 missing item (`g4.schedule_unknown`). Give every dependency in your journey complete dates, or a mitigation, so your G4 approval does not depend on BE-F.

## Binding rules

- **Users and data.** Use the synthetic dev users that seed-dev creates, and **distinct users per role**:
  - TL submits;
  - FIN validates and records funding;
  - SP approves selection and G4;
  - the capacity owner (BO or TO) commits demand;
  - AUD is read-only.

  Every business decision in the journeys is a synthetic demo record that approves nothing real. Label it so in comments. Product gate G4 never implies any engineering gate.
- **Bilingual.** Every journey runs in **chromium-en and chromium-ar** and asserts translated text, not English text, in Arabic.
- **Through the UI.** Drive the screens, not the API, except for setup that P2 already covers (G1–G3), which may use the API helpers the P2 specs use.
- **Screenshots and accessibility.** Take EN and AR screenshots at each milestone, and run axe on each new screen state with 0 serious or critical issues.

## Journeys, in this order

1. **Sequencing (REQ-PB-004, -006, -007, -022).**
   - Before G1, submitting an initiative is refused with the translated G1 reason, and readiness lists the missing diagnostic areas.
   - After G1 (approved with the three confirmations), submitting without an outcome/KPI link is refused with 'Outcome before activity'. With the link, it is accepted.
   - In End-to-End mode, launching a funded initiative before G2/G3 approval is refused with 'North Star, outcomes and target state not yet approved'. After G2 and G3, the launch succeeds.
2. **Prioritization (REQ-PB-047/048/049, REQ-S09-001/003/005).**
   - Score 5,4,3,2,1 and see **3.30**, and **57.5** in the 0–100 view with its label.
   - A weight set totalling 95% is refused.
   - Weight-set v2 (risk/compliance 10, strategic fit 15) is approved by SP, and the ranking history shows **'weight version 2'** as the cause.
   - An override without a reason is refused.
   - The initiative is selected but not yet funded, and shows **'Selected - unfunded'**.
3. **Roadmap and dependencies (REQ-PB-050/051/052, REQ-S09-006/008).**
   - The four waves are shown verbatim.
   - Moving a milestone updates the timeline, the table and the board, and a stale concurrent edit shows the 409 banner.
   - A→B→C→A is refused, naming the cycle.
   - A predecessor finishing after the needed-by date is flagged.
4. **Business case and T09 (REQ-PB-053/054/055/056/057, REQ-S05-005, REQ-S08-007).**
   - The ten sections, and lines with one class each.
   - The roll-up counts each line once.
   - Instantiating the revenue example previews **100000 SAR**.
   - Monthly ARPU with an annual population is refused.
   - FIN validates the baseline and the formula version. The author cannot.
5. **Capacity and funding (REQ-PB-059, REQ-S09-003/004).**
   - Demand above capacity shows the conflict indicator.
   - The capacity owner commits demand.
   - FIN or SP records an approved funding decision, and the initiative shows Funded.
6. **G4 end to end (REQ-PB-019, REQ-PB-046, REQ-S04-006, REQ-DLV-035).**
   - TL submits G4 while items are missing. The refusal lists **'Owners'**, **'Finance validation'** and the initiative names, translated in AR.
   - Fix them, and TL resubmits.
   - A non-approver deciding gets 403, and the submitter deciding gets 403.
   - A decision on a superseded submission gets 409.
   - SP approves, and the phase advances to Transform.
7. **AUD read-only pass.** AUD sees every P3 screen with no enabled write control.

## Acceptance (real output in the handback)

1. `apps/web/e2e/p3-journeys.spec.ts` passes in chromium-en and chromium-ar, **twice**: once with the locale unset and once with `C.UTF-8`.
2. The whole product e2e suite (`apps/web/e2e`) passes in both projects, in both settings. Report the counts per spec and project.
3. These all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
   - `pnpm --filter @mth/design-tokens run check:contrast`
4. `pnpm test` passes in both locale settings.
5. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-FE-D-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-FE-D-evidence/`. Include:

- each journey and the acceptance texts it asserts;
- the e2e counts;
- every product fix you made, with its test;
- every backend defect you found, with its reproduction;
- the screenshot list.
