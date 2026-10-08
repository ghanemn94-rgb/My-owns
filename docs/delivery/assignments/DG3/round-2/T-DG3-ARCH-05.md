# Assignment T-DG3-ARCH-05: repair F-DG3-120: the inheritedApproval annotation on the gate list and the gate view (solution-architect)

## Stage and working tree

- **Stage:** P3 / DG3 (FIXING), repair before review round 2.
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg3/arch-05`, at the integrated `HEAD`. That HEAD is the round-1 candidate `873115d9` plus the round-1 review records, which are not candidate content. `node_modules` is installed and the packages are built. Work only in this tree.
- **Concurrency (D-004):** KBE-D runs alongside you in its own worktree. It owns `eslint.config.js` (the formula override block) and `packages/shared/src/formula/fuzz.test.ts`. Don't touch those.
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG2` first and report the result; it must exit 0.
- **Time:** about 45–60 minutes; the hard limit is about 2 hours. Run `date -u` at the start and at the end.
- **Environment:**
  - Node 24.21.0 is at `/opt/nvm/versions/node/v24.21.0/bin`. Run offline.
  - Chromium is pre-installed; never run `playwright install`.
  - **Your harness ports are 23700–23749 only.**
  - Remove any empty `.claude/.cc-writes` directories inside source folders before you run tests.

## The finding

**F-DG3-120 (Low, REQ-PB-004, raised by the domain reviewer).** Read it in full: `docs/delivery/reviews/DG3/round-1/domain-reviewer.findings.json`.

- **What ADR-0021 §5 says.** An accepted (or pending) inherited approval "never changes `gate_instance.status`, and the gate list keeps showing the gate as `draft` with an `inheritedApproval` annotation".
- **What is built.** No such annotation exists: not in the contract, not in the API, not on the Gates screen. G1 therefore shows as an unqualified draft, although readiness and the Dispensations page show the accepted inherited approval.

## The repair

Build the annotation the ADR promises. Do not delete it from the ADR. Keep everything additive and keep the DG2 gate behaviour byte-stable otherwise.

1. **Contract** (`docs/api/openapi.yaml`, additive).
   - `GateInstance` (the item of `listGates` and the body of `getGate`) gains a nullable `inheritedApproval` object, built from the gate's `gate_dispensation` rows of kind `inherited_approval`:
     - `dispensationId`;
     - `status`: `pending_verification` | `accepted` | `rejected` | `revoked`, following the dispensation;
     - `counts` (boolean): the same rule sequencing uses, ADR-0021 §5;
     - `approvingBody`;
     - `approvedOn`.
   - When there is none, the value is `null`.
   - Update the zod mirror in `packages/shared/src/schemas/gate.ts`.
   - `pnpm openapi:lint` must pass, and the `contract.test.ts` pins must not move.
2. **API** (`apps/api/src/modules/workflows/gates.ts` and its presenter).
   - Fill the annotation from the dispensations. Read them through the `portfolio` facts already injected (`GateFactsProvider`), or through a small read in `workflows`. Never import `portfolio` from `workflows`, so the module graph stays acyclic.
   - `status` stays the gate's own status, e.g. `draft`. The annotation never makes a gate look approved.
   - **Integration test:**
     - a Modular transformation;
     - record an inherited approval for G1 with VERIFIED evidence → the annotation shows `pending_verification` and `counts: false`;
     - the Sponsor accepts it → `accepted` and `counts: true`;
     - G1's `status` stays `draft` throughout, and no `gate_decision` row exists;
     - revoking it → `revoked` and `counts: false`.
3. **Web** (`apps/web/src/pages/gates/GatesPage.tsx` and `GateDetailPage.tsx`).
   - Show the annotation next to the gate's status as a translated, accessible badge, e.g. 'Inherited approval: accepted (does not approve this gate)' or 'Inherited approval: pending verification'. Provide EN and AR keys in `i18n/{en,ar}/gates.json`.
   - **Never** render the gate as approved, and never use the approved colour.
   - Add a web unit test in EN and AR.
4. **Record.**
   - Add a sentence to ADR-0021 §5 stating the contract field.
   - Add a line to `docs/architecture/p3-work-split.md` §9.

## Acceptance (real output in the handback)

1. These all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `pnpm openapi:lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
   - `pnpm --filter @mth/design-tokens run check:contrast`
2. `pnpm test` passes in both locale settings.
3. `QA_PG_PORT=<23700-23749> MTH_PORT_POOL=<the rest> tests/qa/support/with-pg.sh pnpm test:integration` passes. Report the counts.
4. The product e2e suite (`apps/web/e2e`, real stack, `--workers=1`) passes in chromium-en and chromium-ar with the locale unset. Use your ports.
5. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed suite or hook timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-ARCH-05-solution-architect.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-ARCH-05-evidence/`. State the fix for F-DG3-120 and how to verify it.
