# Assignment T-DG3-FE-F: the G4 refusal in the shown language, item by item (frontend-ux-engineer)

## Stage and working tree

- **Stage:** P3 "Mobilization and portfolio" / gate DG3 (BUILDING), the last implementation step before the candidate freezes.
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg3/fe-f`, at the integrated `HEAD`, which contains every P3 task through wave 6. `node_modules` is installed and the packages are built. Work only in this tree.
- **Concurrency (D-004):** BE-G (`apps/api/**` tests and fixes) and the transformation-analyst (`docs/delivery/requirements.csv`) run alongside you. You touch only the files named below.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** about 30–45 minutes; the hard limit is about 2 hours. Run `date -u` at the start and at the end.
- **Environment:**
  - Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
  - Chromium is pre-installed; never run `playwright install`.
  - **Your harness ports are 23500–23549 only.**
  - Remove any empty `.claude/.cc-writes` directories inside source folders before you run tests.

## The defect

FE-D found this by reading the code (`docs/delivery/handbacks/DG3/T-DG3-FE-D-frontend-ux-engineer.md` §5 item 1).

- **What the server sends.** A refused G4 submission is a 422 `gate_criteria_incomplete`. It has **one** `errors[]` entry per incomplete criterion; its `message` is all of that criterion's English labels joined with spaces (ADR-0021 §7, "The refusal shape"). With two in-scope initiatives without owners, the message is `"Owners: INI-01 X Owners: INI-02 Y"`.
- **What the web does wrong.** The refused-submission dialog (`g4Subject` in `apps/web/src/pages/gates/**`) parses that English message. The result:
  - it shows one run-on line;
  - in **Arabic the second "Owners:" stays English**, which breaks the bilingual rule (every user-facing string translated at render time).

## The fix (web only)

Do not parse the joined English `message`.

- On a 422 `gate_criteria_incomplete` for G4, render the refusal **item by item, translated**, from the per-item list the server already provides: `GET /transformations/{id}/gates/G4` → `criteria[].missing[]`, each item with its `code` and `pointer`.
- Refresh that view after the 422 through the session-bound path (`useP3Refresh` or the gate query's own invalidation). Never use `setQueryData`.
- Each item shows the translated label for its `code` (`gates.json` keys `g4__…`), plus the initiative's code and name, or the dependency or case it names, taken from the item's data or pointer. **Never show the English server text in Arabic.**
- If the gate view cannot be loaded, fall back to one translated generic line per criterion (the criterion's title), never to the English message.
- G1–G3 refusals stay as they are; they are DG2-approved.

**Files:** `apps/web/src/pages/gates/**` and its tests, plus `i18n/{en,ar}/gates.json` keys if one is missing. **Do not touch** `apps/api/**`, `packages/**`, `app/**` or `api/**`.

## Tests

- **A web unit test, in EN and AR.** A stubbed 422 with **two** initiatives missing owners, plus a stubbed gate view. The dialog lists two separate items, each translated. The Arabic DOM contains no English label ("Owners", "Finance validation", "Gap link missing").
- **An e2e test,** a new spec `apps/web/e2e/p3-g4-refusal.spec.ts`, on the real stack in chromium-en and chromium-ar:
  - two selected initiatives, both without a workstream lead;
  - TL submits G4;
  - the dialog shows two translated "Owners" items, one per initiative;
  - in AR no English label appears.

  Build the setup the way FE-D's `apps/web/e2e/support/p3-journey-setup.ts` does. Import it read-only; do not edit it.

## Acceptance (real output in the handback)

1. These all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
   - `pnpm --filter @mth/design-tokens run check:contrast`
2. `pnpm test` passes in both locale settings.
3. The new e2e spec **and the whole product e2e suite** (`apps/web/e2e`) pass in both projects and both locale settings. Report the counts per spec.
4. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-FE-F-frontend-ux-engineer.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-FE-F-evidence/`.
