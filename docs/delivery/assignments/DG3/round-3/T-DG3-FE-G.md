# Assignment T-DG3-FE-G: repair F-DG3-170: the inherited-approval badge must wrap inside its card and row (frontend-ux-engineer)

## Stage and working tree

- **Stage:** P3 / DG3 (round 2 under review), repair before review round 3.
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg3/fe-g`.
  - Its `HEAD` is the round-2 candidate `58ef3f47` (source `f49ca16`) plus the round-2 review records, which are not candidate content.
  - `node_modules` is installed and the packages are built. Work only in this tree.
- **Concurrency (D-004):** two round-2 reviewers are still running in the main checkout, which you must not touch. Your worktree is separate.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** about 45–60 minutes; the hard limit is about 2 hours. Run `date -u` at the start and at the end.
- **Environment:**
  - Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
  - Chromium is pre-installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`); never run `playwright install`.
  - **Your harness ports are 23950–23999 only.**
  - Remove any empty `.claude/.cc-writes` directories inside source folders before you run tests.

## The finding

**F-DG3-170 (Medium, REQ-PB-004, raised by the domain reviewer while verifying F-DG3-120).** Read it in full in `docs/delivery/reviews/DG3/round-2/domain-reviewer.findings.json`, with:
- its probe, `docs/delivery/test-evidence/DG3/domain/round-2/dg3-ui-overflow.mjs`;
- the probe's log, `dg3-ui-overflow.log`;
- the screenshots in `screens/*overflow*`.

**What the probe measured:**
- **Gates list.** The `InheritedApprovalBadge` (`apps/web/src/pages/gates/GatesPage.tsx`) is a `status-chip`, and `.status-chip { white-space: nowrap }` (`apps/web/src/styles/app.css`) keeps its text of about 80 characters on one line.
  - On the Gates list it overflows the G1 card at 1024, 1366 and 1920 px: 518 px of badge in a card of about 335 px.
  - In EN the safeguard text "(does not approve this gate)" is clipped.
  - In AR the badge spills over the neighbouring G2 card.
- **Gate view.** On the gate view (`GateDetailPage.tsx`) it makes the document scroll horizontally at 1024 and 1366 px, in EN and AR.

## The repair

1. **Layout.** The badge must wrap inside its card (list) and its row (view), so its full text is always visible, including the disclaimer "(does not approve this gate)" / "(لا يعتمد هذه البوابة)".
   - Do it with a scoped modifier, e.g. `status-chip--wrap`: `white-space: normal`, `max-inline-size: 100%`, `overflow-wrap: anywhere` (or equivalent), with the icon kept aligned. Use logical properties so it works in RTL.
   - **Do not** change the global `.status-chip` nowrap rule. Other chips rely on it.
   - Keep the badge neutral: `status-chip--unknown` and the info icon, never the approved colour or the check icon.
   - Keep its text, its `data-inherited-approval` / `data-counts` attributes, and the unit test's expectations, except where layout requires otherwise.
   - Check the other chips in the same row on the Gates list (readiness, unverified evidence): in the same G1 card they must not overflow either.
2. **A real-browser regression test.** The jsdom unit test cannot see layout. Add a new Playwright spec, `apps/web/e2e/p3-inherited-approval.spec.ts`, on the real stack (`apps/web/e2e/support/with-stack.sh`), in chromium-en and chromium-ar. With synthetic data it must:
   - create a Modular transformation (entry phase mobilize);
   - record an inherited approval for G1 with verified evidence, and have the synthetic Sponsor accept it;
   - open the Gates list and the G1 gate view at viewport widths 1024, 1366 and 1920 (and 390 for a phone, if the page supports it today);
   - assert that the badge box lies within its card or row, that `document.documentElement.scrollWidth <= innerWidth`, and that the full translated badge text, including the disclaimer, is visible (not clipped: `scrollWidth <= clientWidth` on the badge);
   - assert that G1 still shows the neutral 'Not submitted' / 'لم تُقدَّم' chip, and that nothing reads as approved;
   - run axe with 0 serious or critical issues;
   - take screenshots to `apps/web/e2e/screenshots/{en,ar}/p3-inherited-*.png`.

   Follow the conventions of the existing P3 specs (`support/ui.ts`: `signIn`, `apiSession`, `expectAccessible`, `shot`, `trackRequests`).
3. **Run the reviewer's probe as read-only evidence.** Run `docs/delivery/test-evidence/DG3/domain/round-2/dg3-ui-overflow.mjs` against your tree, following its header and harness. **Do not edit it**; if it needs a different port or URL, pass it through the environment.
   - The probe reads `E2E_BASE_URL` and `SHOTS` from the environment. Point `SHOTS` at a scratch directory under `$TMPDIR`, never at the reviewer's evidence folder.
   - Report the outcome: 12/12 expected.
   - If it cannot run in your worktree, say exactly why. Your own spec is then the evidence.

**You may edit:**
- `apps/web/src/pages/gates/{GatesPage,GateDetailPage}.tsx`;
- `apps/web/src/styles/app.css`, for the new modifier only;
- `apps/web/src/pages/gates/inherited-approval.test.tsx`;
- the new spec `apps/web/e2e/p3-inherited-approval.spec.ts` and its screenshots;
- `apps/web/src/i18n/{en,ar}/gates.json`, only if a wording change is needed for fit. If you change wording, keep the disclaimer.

**Do not edit:**
- `apps/api/**`;
- `packages/**`;
- `docs/api/**`;
- any other e2e spec;
- `tools/**`;
- `.claude/**`;
- `docs/source/**`;
- reviews, test evidence or gate records.

## Acceptance (real output in the handback)

1. These all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
   - `pnpm --filter @mth/design-tokens run check:contrast`
2. `pnpm test` passes with the locale unset and with `C.UTF-8`. Report the counts.
3. The new spec passes in chromium-en and chromium-ar.
4. **The whole product e2e suite** (`apps/web/e2e`, real stack, `--workers=1`) passes in chromium-en and chromium-ar, with the locale unset and with `C.UTF-8`.
   - Report the counts per spec.
   - The round-2 baseline is 168 in each setting, plus your new spec.
5. The reviewer's overflow probe gives 12/12 (or the disclosed reason it could not run).
6. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-FE-G-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-FE-G-evidence/`. Include:
- the fix;
- the files changed;
- the checks with exit codes and counts;
- before/after measurements from the probe and your spec;
- EN and AR screenshots.

Leave your changes uncommitted for the orchestrator to integrate.
