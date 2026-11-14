# Handback T-DG7-ARCH-R6: ADR-0069 §5 launcher amendment (solution-architect)

- **Stage:** P7, gate DG7 (BUILDING). Branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `HEAD` `85f6ebe9fb6b7136bd3cbb1670400be449b8dfc8`. The tree was clean apart from two `runs/` directories: this run's, and QA-C's from a parallel run.
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-ARCH-R6.md` (sha256 `37916ead…3efdd`, verified).
- **Invocation:** `DG7-T-DG7-ARCH-R6-solution-architect-20261114T131339Z-a0fbc6f1`, session `a0fbc6f1-ea14-4d2d-9e4a-225b2cd9ae5e`.
- **Time:** start `2026-11-14T13:17:56Z`. Checks ended at about 13:40Z (`date -u`).
- **Evidence:** `docs/delivery/handbacks/DG7/T-DG7-ARCH-R6-evidence/`.
- **Scope:** documentation only. No code, migration, contract, permission or advisory-lock change.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/architecture/adr/ADR-0069-p7-clean-deployment-base-url-readiness-transfer-offline-image-drills.md` | Adds **Amendment 1**: A1.1 (Q1), A1.2 (Q2), A1.3 (Q3) and A1.4 (residuals 8–9). §5's first sentence and §6's `save` bullet are edited in place, each with a pointer to the amendment, and §6 gains an "Image store" bullet. |
| `docs/architecture/p7-work-split.md` | §B.3: the offline drill line now cites A1.1. §B.4 T-B12: the image set is the Compose-run set plus `excluded`, and there is a classic-store exit 3 case. §B.5: one new `image-bundle.sh` exit 3 line. |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-R6-solution-architect.md` | This handback. |
| `docs/delivery/handbacks/DG7/T-DG7-ARCH-R6-evidence/*` | Check logs, plus `docs.diff` (the diff of the two documents, taken before this handback was written). |

## 2. Behaviour per requirement / question

| Item | Decision | Where |
| --- | --- | --- |
| DO-E **Q1** (REQ-S19-018 first half, REQ-S01-006) | **The ADR changes; the drill does not.** The specs run on the stacks their headers name (`with-demo-stack.sh` or `with-stack.sh`). Both stacks start a disposable cluster and the built API serving the built SPA inside the namespace. `ci-e2e-stack.mjs` needs an already running PostgreSQL service (`TEST_DATABASE_ADMIN_URL`), seeds only `seed-dev` and starts one API on `:3000`, so it cannot serve the drill. It stays the CI launcher (ADR-0012). The header-grep grouping is disclosed: a mis-grouped spec fails and never passes falsely. | ADR-0069 §5, A1.1; work-split §B.3 |
| DO-E **Q2** (REQ-S19-018 second half) | The **containerd image store is a precondition** on the load host. `docker info` must show `overlayfs` with driver-type `io.containerd.snapshotter.v1`. On a classic-store host the clause is **BLOCKED** and becomes a release blocker (REQ-S21-003). The orchestrator may switch the store and rerun from step 1. **No re-tagging and no rewritten `image:` lines**, because either would drop the digest pin at start time. | ADR-0069 §6, A1.2; work-split §B.4 T-B12, §B.5 |
| DO-E **Q3** | `save` bundles the lock images that a Compose file runs, plus the app image. On the current lock that is `postgres`, `keycloak` and `mth-app`. The Playwright image (CI-only) and `node-runtime` (its layers travel inside `mth-app`) are listed in a new optional `images.json` key, `excluded`. `mth-image-bundle/1` stays valid because the key is optional. | ADR-0069 §6, A1.3; work-split §B.4 T-B12 |
| `apps/api/test/support/p7-pending*.ts` | No entry belongs to this task, so nothing was removed. | — |

Authorization, validation, concurrency, audit, money, Unknown/Stale and bilingual rules: not applicable. There is no product change.

## 3. Checks run (real exit codes)

Node 24.21.0 (`PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH`), `MTH_PNPM_OFFLINE=1`.

| Command | Exit | Result / log |
| --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6` | 0 | `PASS gate DG6 (historical)` (`validate-historical-DG6.log`). **Order:** it ran after the documents were edited, not before. |
| `pnpm openapi:lint` | 0 | `PASS docs/api/openapi.yaml: OpenAPI 3.1.1, 965 operations` (`openapi-lint.log`) |
| `pnpm lint` | 0 | `lint.log` |
| `pnpm -r typecheck` | 0 | `typecheck.log` |
| `pnpm test` | 0 | Test files 205 + 130 + 3; tests 3022 + 2175 + 259 passed, 2 skipped (`pnpm-test.log`), 13:30–13:38Z |
| `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` | 0 | 111 of 111 (`contract-test.log`). No integration test was touched. |
| `npx prettier --write` on the two edited documents | 0 | Formatting only |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | 0 | 23 batches, all "All matched files use Prettier code style!", no `[warn]` (`prettier-repo.log`), 13:42Z, after this handback was written and formatted. This row's own edit was re-checked (next row). |
| `npx prettier --check` on this handback after its last edit | 0 | "All matched files use Prettier code style!" |

Not run: the Docker behaviour in A1.2. The sandbox has no network and no Docker daemon (D-243 Q1), so that check is **BLOCKED** here.

## 4. Known gaps

1. **A1.2 is not verified against official Docker documentation or by a run.** The sandbox is offline and has no daemon. Two points rest on the engine's store model as I know it:
   - the classic store loses `RepoDigests` on `load`;
   - the containerd store keeps the digest after `load`.

   M0314 evidence for this is **pending** (ADR residual 8). The orchestrator's host run decides, and a contrary result reopens A1.2.
2. **Code follow-ups for DO-E are not done** (documentation-only task):
   - (a) `image-bundle.sh load|verify` detects the classic store and exits 3 with the §B.5 line (A1.2 item 4);
   - (b) `save` selects the Compose-run images and writes `excluded` (A1.3 item 5);
   - (c) the matching T-B12 cases.

   Until they land, the shipped script saves every lock image, so step 1 must pull Playwright. The bundle is larger but correct. A classic store shows up as an exit 1 `(present)` mismatch rather than exit 3. **T-B12 as amended in §B.4 is not met by the shipped tests yet.**
3. **"You run alone" did not hold.** A QA-C run (`DG7-T-DG7-QA-C-qa-verifier-20261114T131344Z-23c9a774`) worked in the same tree during this task. At the end, `git status` shows changes that are **not mine**:
   - `tests/qa/integration/a19-backup-restore-drill.test.ts`, `a22-operational-readiness.test.ts` and `a22-p6-operability.test.ts`;
   - `docs/delivery/test-evidence/DG7/qa/T-DG7-QA-C/`.

   My checks (`pnpm test`, the contract test, lint, typecheck, Prettier) ran on a tree that may already have held some of those edits. I did not touch them. Commit only the files of §1 for this task.
4. `docs/operations/restricted-network.md` (DO-E's file) still describes the bundle as holding "the four images". It should follow A1.3 when follow-up (b) lands. I did not edit it, because it is outside this assignment.

## 5. Open questions

- **Q-R6-1 (orchestrator):** should follow-ups 2(a)–(c) be a DO-E repair task before the freeze? Or should the host run go ahead on the shipped script, with the orchestrator's `docker info` record standing in for (a)?
- **Q-R6-2 (orchestrator):** the T-B12 wording in §B.4 now runs ahead of the shipped tests. If the follow-up is deferred, should T-B12 be marked partially met in the register's evidence?

## Merge instructions

Documentation only. Merge the two documents and this handback. No migration, no contract change, and no conflicts expected.
