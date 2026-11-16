# Handback T-DG7-DO-K1 (devops-engineer): Keycloak e2e proxy note and the `automation_rule` known-limitations row

- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DO-K1.md`, sha256 `1bd2443e72cc2abb01c4aa57cd6dd362279146eb25f379ef9888839d5d8626c4` (verified with `sha256sum` at the start).
- **Invocation:** run `DG7-T-DG7-DO-K1-devops-engineer-20261114T213603Z-d81585f1`, session `d81585f1-db11-493d-89de-edb3c526ef6a`.
- **Base:** `c2506bf8105b711c09eaf067a0c9bf21458d4f0d` on `claude/mobily-transformation-platform-dg6-regate`. `git status` at the start showed only this run's `docs/delivery/runs/` directory.
- **Time:** started 21:36:14 UTC. Edits were finished by about 21:50; the last check ended at 22:10 UTC (about 34 minutes in total).
- **Read:** `CLAUDE.md`, `docs/delivery/agent-protocol.md`, `p7-work-split.md` §1, §2 and the DOC-B row of §H, ADR-0069 Amendment 2 (A2.2, residual 10), ADR-0065 Amendment 1 (A1.2, A1.3), the ARCH-R7 and BE-F2 handbacks, D-267 and the D-243 to D-266 index lines. `p7-plan.md` was not reread in full (see §4).
- **Environment:** Node 24.21.0 (`/opt/nvm/versions/node/v24.21.0/bin`), `MTH_PNPM_OFFLINE=1`, no network and no Docker daemon (D-243 Q1). Commands ran in the agent's bubblewrap sandbox.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `e2e/support/keycloak-login.ts` | Header only, comments only. The run command now starts with `env -u HTTPS_PROXY -u HTTP_PROXY -u ALL_PROXY -u https_proxy -u http_proxy -u all_proxy`. A new "Proxy" paragraph covers: ADR-0069 A2.2 item 2 and residual 10; unset the variables, or put the IdP host in `NO_PROXY` instead; the evidence (host run 3b failed 4 tests on the 60 s timeout, run 3c passed 4); the mechanism, which is inferred and not verified; the fact that this is a test-host property with no product, Compose or TLS change; and that an unchangeable proxy means BLOCKED, never a pass. |
| `docs/handover/known-limitations.md` | §6 (hand-written): a new `ADR-0065` row for `automation_rule`. It is BE-F2's proposed text plus ADR-0065 A1.3 residual 5. `--write` then regenerated the §3 generated block. |
| `docs/handover/known-limitations.ar-summary.md` | Item 6 under "ترتيب الخطوات": the Arabic summary of the same row. Like the rest of the file, the Arabic is provisional (D-243 Q7). |
| `docs/handover/external-dependencies.json` | Rewritten by `--write`, but its bytes did not change (sha256 `5f2811ad…1bbc` before and after). |
| `docs/delivery/handbacks/DG7/T-DG7-DO-K1-devops-engineer.md`, `…/T-DG7-DO-K1-evidence/*` | This handback and its logs. |

**Where the row's source is.** `tools/release/known-limitations.mjs` generates only §1 (from the `environment.md` residual table plus three decisions), §2 (from the protocol audit) and §3 (provisional Arabic). The `automation_rule` row is an ADR residual, not an external dependency, so its source is the hand-written §6 of `known-limitations.md`. That file and its Arabic summary belong to DOC-B, which is devops (p7-work-split §H), so I edited them directly. I did not touch `environment.md`: it is not in DOC-B's write list, and the row does not belong in its "live integrations" table.

**The exact row added (EN):**

> | ADR-0065 | Automation rules (`automation_rule`) are not carried by configuration bundles: every admin rule names its owner by user id, which has no stable key. An export that names the kind is refused with `config_bundle.unportable_reference`; an imported item of the kind is refused. Automation rule sets (Studio) are carried. A target installation recreates its automation rules by hand, with its own owners (Amendment 1, A1.2; the export screen does not offer the kind). |

**The Arabic summary line (provisional):**

> 6. **قواعد الأتمتة (`automation_rule`):** لا تنقلها حزم الإعدادات في هذا الإصدار، لأن كل قاعدة تسمّي مالكها بمعرّف مستخدم ليس له مفتاح ثابت. يُرفض التصدير الذي يسمّي هذا النوع بالرمز `config_bundle.unportable_reference`، ويُرفض أي عنصر مستورد منه. مجموعات قواعد الأتمتة (Studio) تُنقل. تعيد المنشأة المستهدفة إنشاء قواعد الأتمتة يدوياً بمالكيها (ADR-0065).

The clause "the export screen does not offer the kind" is based on FE-B2 (integrated at `c2506bf81`). There, `ConfigTransferPages.tsx` filters the kinds through `UNPORTABLE_BUNDLE_KINDS`.

**Checksums after the task:**

- `e2e/support/keycloak-login.ts` `445007339f420ae8b9d52882f43a6187ab06198b1121ff1bb59ba7ebe9efb6cf`
- `docs/handover/known-limitations.md` `0001ae17b055258c70d3e6351ccc257e155b775136d92b2a8a4d0ec65a54f9c6`
- `docs/handover/known-limitations.ar-summary.md` `433c5439ba71d97e377c56f42b3d5caa64d46b59b77f3cd8999ff3a01db022d1`
- `docs/handover/external-dependencies.json` `5f2811ad8c9e48bd6fe9572101aa7a901a3e71723ca3c11dd24814b0760c1bbc`

## 2. Behaviour per requirement

- **REQ-S16-007 (Keycloak e2e), ADR-0069 A2.2 item 3 follow-up.** The helper's run instructions now carry ARCH-R7's instruction. This changes no code path: only comments changed, and eslint, typecheck and prettier pass. The Keycloak spec itself was **not run**. It needs a container runtime, and this sandbox has no Docker daemon (D-243 Q1), so it is BLOCKED here. The evidence for the instruction is still the orchestrator's host runs 3b and 3c.
- **REQ-S19-008 / REQ-S19-015 ("Known limitations"), ADR-0065 A1.2 item 6 follow-up.** `known-limitations.md` now discloses the `automation_rule` exclusion in EN, with the AR summary. This fulfils Residual 1's "listed in … known limitations". This task adds no mutation, API, migration or contract change. Nothing under `apps/api/test/support/p7-pending*.ts` relates to it, so no pending entry was removed.

## 3. Checks run (real exit codes; logs in `T-DG7-DO-K1-evidence/`)

| Command | Exit | Result | Log |
| --- | --- | --- | --- |
| `node tools/gates/validate.mjs --historical --stage DG6` (before any edit) | 0 | `PASS gate DG6 (historical)` | `validate-historical-DG6-before.log` |
| `node tools/release/known-limitations.mjs --protocol-audit docs/delivery/handbacks/DG7/T-DG7-DO-I-evidence/protocol-audit-all.json --check` (before `--write`) | 1 | FAIL: §3 was already stale (see below) | `known-limitations-check-1.log` |
| same, `--check` with `--guide` on a copy of **HEAD's** `known-limitations.md` | 1 | the same FAIL, so the staleness predates this task | `known-limitations-check-HEAD-copy.log` |
| same, `--write` | 0 | "wrote … (11 dependencies; report head 119dcd05…)" | `known-limitations-write.log` |
| same, `--check` | 0 | PASS | `known-limitations-check-2.log` |
| `node tools/release/check-handover.mjs --protocol-audit <same report>` | 0 | PASS (index, deployment, summaries, security-links, guides, generated) with warnings that predate this task (H.3 line in `backup-restore.md`, `release-notes.md`, `upgrades.md`) | `check-handover.log` |
| `pnpm -r typecheck` | 0 | all packages Done | `typecheck.log` |
| `pnpm openapi:lint` | 0 | OpenAPI 3.1.1, 965 operations | `openapi-lint.log` |
| `pnpm lint` | 0 | eslint `--max-warnings=0` | `lint.log` |
| `npx eslint --max-warnings=0 e2e/support/keycloak-login.ts` (after a later comment re-wrap) | 0 | clean | `eslint-keycloak-login-after-rewrap.log` |
| `pnpm test` (21:48:30–21:54:52) | 0 | unit-node 205 files / 3022 tests; unit-web 130 / 2179; nocodegen 3 / 259 (+2 skipped) | `pnpm-test.log`, `pnpm-test.start` |
| `QA_PG_PORT=27741 tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts` (22:05:54–22:07:38) | 0 | 111/111 | `contract-integration.log` |
| `node --test tools/release/tests/*.test.mjs licenses/tests/*.test.mjs` | **1** | 464 tests: 458 pass, **4 fail**, 2 skipped (BLOCKED, e.g. T-A11 without a runtime tree) | `release-node-tests.log` |
| `node --test tools/release/tests/seal.test.mjs`, run alone | 0 | 10/10 | `seal-test-isolated.log` |
| `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | see §3.1 | | `prettier.log` |
| `node tools/gates/validate.mjs --historical --stage DG6` (at the end) | see §3.1 | | `validate-historical-DG6-after.log` |

**The §3 staleness at HEAD.** The generated "provisional-arabic" block listed 12 handover files with Arabic text. DO-J's `docs/handover/release-notes.md` (last changed at `3e0cec962`) now also holds Arabic, so the generated list has 13. `--write` added that one line. My §6 and AR-summary edits are outside the generated blocks and do not affect the check.

**The 4 node-test failures.** None comes from this task's changes:

1. **T-A5 `build-from-archive.test.mjs`:** `pnpm install` inside the namespace fails with `EROFS … symlink … /root/.local/share/pnpm/store/v10/projects/…`. The sandbox makes the pnpm store read-only, which is an environment limit. Report it as BLOCKED in this sandbox, not as a pass.
2. **`check-handover.test.mjs` "reports a missing release-notes.md as BLOCKED":** the fixture copies the real `docs/handover`, which has contained `release-notes.md` since DO-J, so the status is PASS. This predates the task and does not depend on my edits.
3. **`check-handover.test.mjs` T-H5 "no guides yet → BLOCKED":** same cause. The copied tree contains DOC-A's `guides/`.
4. **T-M2 `seal.test.mjs` "git status unchanged":** I wrote evidence logs into the repository while the suite ran. Run alone, `seal.test.mjs` passes 10/10.

### 3.1 Final checks

These two ran after this handback was written, so prettier also covered this handback:

- `git ls-files -co --exclude-standard -z | xargs -0 npx prettier --check --ignore-unknown`: **exit 0**, "All matched files use Prettier code style!" (`prettier.log`).
- `node tools/gates/validate.mjs --historical --stage DG6`: **exit 0**, `PASS gate DG6 (historical)` (`validate-historical-DG6-after.log`).
- The only later change is this note. The file was checked again with `npx prettier --check` after the edit.

## 4. Known gaps

1. **The Keycloak e2e was not run here** (no container runtime). The header change is documentation only. Its effect is shown only by the orchestrator's host runs 3b and 3c.
2. **Stale wording elsewhere in `known-limitations.md`, not changed here.** The §4 row for REQ-S16-007 still says the live Keycloak sign-in "has never run in the delivery environment". The §1 `keycloak-e2e` dependency is still `blocked`, generated from `environment.md`. D-267 records host run 3c with 4/4 passing. Changing §1 needs an `environment.md` change (not DOC-B's file) and an orchestrator decision on how the host run counts. I left both unchanged rather than guess.
3. **Two `check-handover.test.mjs` cases (items 2 and 3 above) fail on the current tree.** Their fixtures depend on files that now exist. The fix is to remove `release-notes.md` and `guides/` from the fixture copy before asserting BLOCKED. That is a DOC-B file but outside this task, so it was not changed.
4. `docs/architecture/p7-plan.md` was not reread in full. Only the sections relevant to the two follow-ups were read.

## 5. Open questions and merge instructions

- **Q1 (orchestrator).** Should the §4 REQ-S16-007 wording and the `keycloak-e2e` status (via `environment.md`) be updated now that D-267 records host run 3c? If so, route the `environment.md` row to its owner, then regenerate §1.
- **Q2 (orchestrator).** Should the two stale `check-handover.test.mjs` fixture cases be routed for repair before the freeze?
- **Merge.** Three files plus regenerated output. There are no migrations, contract changes or `p7-pending` changes. Re-run `known-limitations.mjs --check` after any later change to `docs/handover/*.md` that adds Arabic text.
- This is engineering documentation. It grants no G1–G6 business approval and no DG7 gate decision, and product gate G6 does not imply DG7.
