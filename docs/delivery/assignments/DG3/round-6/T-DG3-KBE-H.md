# Assignment T-DG3-KBE-H: repair F-DG3-100 (fifth pass): meet the reviewer's final closure criterion (kpi-benefits-engineer)

## Stage and working tree

- **Stage:** P3 / DG3 (round 5 reviewed), repair before review round 6.
- **Working tree:** a separate git worktree prepared by the orchestrator. It is your current working directory (`--cwd`), on branch `dg3/kbe-h`.
  - Its `HEAD` is the round-5 candidate `dfedd62f` (source `21e2742`) plus the round-5 review records.
  - `node_modules` is installed and the packages are built. Work only in this tree.
- **You own:**
  - `eslint.config.js`, the formula-engine blocks only;
  - `packages/shared/src/formula/**`, tests only. The engine sources may change only mechanically, and with no behaviour change;
  - `docs/architecture/adr/ADR-0024-p3-business-case-and-formula-foundation.md` §6;
  - one appended item in `docs/architecture/p3-work-split.md` §9 (item 28).
- **Preceding gate:** run `node tools/gates/validate.mjs --historical --stage DG2` first; it must exit 0.
- **Time:** about 45 minutes; the hard limit is 2 hours. Run `date -u` at the start and at the end.
- **Environment:**
  - Node 24.21.0 at `/opt/nvm/versions/node/v24.21.0/bin`; Node 22.22.2 at `/opt/node22/bin`. Offline.
  - Ports, if needed: 23100–23149.
  - Remove empty `.claude/.cc-writes` directories in source folders before tests.
  - Never run `git worktree add`.

## The finding and the round-5 verification

**F-DG3-100 (Low, REQ-PB-056)** stays OPEN. Read the round-5 verification in full: `docs/delivery/reviews/DG3/round-5/code-security-reviewer.verifications.json`, with `docs/delivery/test-evidence/DG3/code-security/round-5/` (`probes/rethrow-rule-attack-probe.mjs`, `probes/rethrow-rule-attack-probe-2.mjs`, `generator-swallow-demo.log`).

**What T-DG3-KBE-G closed:**
- W1, W2 and W4;
- every earlier form;
- the catch-shape rule against renaming, shadowing and hijack.

**Why it stays open.** ADR-0024 §6 now makes **absolute** claims:
- 'It cannot handle its own refusal';
- 'So the exception reaches the test…';
- 'This closes a promise reaction…'.

Three self-handling forms on an exercised path pass all three layers:
- **G1:** a generator `try { … } finally { yield 0; }`;
- **G2:** the same, then `it.return(0)`;
- **A1:** `Array.fromAsync` with a destructured `then`.

There is also a minor inaccuracy: the "stricter than no-unsafe-finally" sentence. The scan's brace matcher misses F1.

**The reviewer's final closure criterion.** The reviewer says it will not ask for further enumeration, and either option suffices:
- **(b)** Make §6 exactly true by narrowing the absolute statements to an **enumerated** claim, and state the residual. The residual is that a self-handling form outside the enumerated list, even on an exercised path, is refused by no layer: the run-time analogue of Q1–Q5, with G1, G2 and A1 as examples.
- **(a)** Also refuse G1, G2 and A1 statically, **and** still drop the absolute wording.

## The repair: do BOTH (a) and (b)

1. **(a) Static refusals, in lint and mirrored in the scan,** for every file in the engine's import closure. Refuse:
   - generator functions (`:function[generator=true]`);
   - `YieldExpression`;
   - any `then`, `catch` or `finally` property key, member, computed literal key, or destructured name;
   - `fromAsync`;
   - async iteration (`for await`, `Symbol.asyncIterator`).

   Confirm that the engine uses none of these, and add G1, G2, A1 (and A2) to the scan's probe table.
2. **(b) ADR-0024 §6: remove every absolute claim.**
   - Replace 'It cannot handle its own refusal', 'So the exception reaches the test…' and 'This closes a promise reaction…' with an **enumerated** claim: lint and the scan refuse exactly the listed handler and asynchrony forms (list them).
   - State the residual exactly as the reviewer worded it: a self-handling form outside that list, even on an exercised path, is refused by no layer, with G1, G2 and A1 as historical examples, now also refused statically.
   - Re-read **every** sentence of §6 and remove any other absolute wording ('cannot', 'always', 'never', 'every … reaches') that the code does not strictly guarantee. Prefer 'refuses the listed forms' over 'guarantees'.
3. **The "stricter" sentence.** Either fix the scan's `finally` matcher for F1 (a string or comment containing `}`), or delete the sentence.
4. **`p3-work-split.md` §9:** item 28 under a round-6 heading.

## Proof (real output in the handback)

- In a disposable clone under `$TMPDIR` (never your tree; never edit the reviewer's files), run copies of `rethrow-rule-attack-probe.mjs` (G1 G2), `rethrow-rule-attack-probe-2.mjs` (A1 A2), `swallow-probe.mjs` (W1–W6), `guard-layers-probe.mjs` (S1 S2 S3 V1 V2) and `guard-bypass-probe.mjs` (18 forms).
  - Report the layer that refuses each form.
  - **Expected:** G1, G2 and A1 are refused by lint and the scan, and everything earlier stays refused.
- Quote the final §6 text in the handback, and for each sentence name the code or test that makes it true.

## Acceptance

1. These all exit 0:
   - `pnpm -r typecheck`
   - `pnpm -r build`
   - `pnpm lint`
   - `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`
   - `npx eslint packages/shared/src/formula/ packages/shared/src/value.ts`
2. `pnpm test` passes on Node 24 and Node 22, with the locale unset and with `C.UTF-8`, in both invocations. Report the counts; the round-5 baseline is 1614 + 220 passed, 1 skipped.
3. The integration suite passes: `QA_PG_PORT=<23100-23149> MTH_PORT_POOL=<rest> tests/qa/support/with-pg.sh pnpm test:integration`. The baseline is 793.
4. `node tools/gates/validate.mjs --historical --stage DG2` exits 0.

## Evidence honesty

Report every command with its real exit code. Disclose and explain every non-zero exit, failed or flaky test, or timeout in the logs you cite. Never report a check as passed that did not run.

## Handback

Write `docs/delivery/handbacks/DG3/T-DG3-KBE-H-kpi-benefits-engineer.md`, with logs under `docs/delivery/handbacks/DG3/T-DG3-KBE-H-evidence/`. Leave your changes uncommitted.
