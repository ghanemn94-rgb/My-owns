# Handback T-DG7-DOC-B (devops-engineer): deployment guide, operator guide, known limitations, handover index

- **Stage:** DG7 (P7 "Independent transfer and release"), BUILDING. Branch `claude/mobily-transformation-platform-dg6-regate`.
- **Base:** `253b6f1189846d39356ec1e42d54b27b99ff6423` (`git rev-parse HEAD` at start; the working tree had only this run's own run directory untracked).
- **Assignment:** `docs/delivery/assignments/DG7/T-DG7-DOC-B.md`, sha256 `32240d717575c64a26e9598d5931ca9cacf788d1cd816937b698b48ac7f63028` (verified).
- **Invocation:** run `DG7-T-DG7-DOC-B-devops-engineer-20261113T083325Z-cc7121fb`, session `cc7121fb-6dca-4049-ad9a-e3571eebd408`.
- **Time:** start `2026-11-13T08:33:32Z`, end `2026-11-13T09:02Z` (`date -u`), about 29 minutes.
- **Environment:** Node v24.21.0, pnpm (version in `T-DG7-DOC-B-evidence/env.txt`), offline (`MTH_PNPM_OFFLINE=1`), no Docker daemon (D-243 Q1), about 4 GB free disk. No extra checkout was made. Fixture trees were created under `$TMPDIR` by the tests and removed.

Engineering evidence only. This task grants no business, Finance or IT approval. Product gates G1–G6 are business approvals inside the product; product G6 never implies DG7, and this handback says nothing about either gate's state. Accepting the handover is Mobily IT's decision, made outside the platform.

## 1. Files changed

| File | Purpose |
| --- | --- |
| `docs/handover/README.md` (new) | The handover index (ADR-0072 §1): the seven REQ-S19-015 items mapped to files or the archive path `archive:evidence/`; one line per file under `docs/handover/` (including the lines requested by DO-B, DO-F, DO-G, DO-H, DO-J and DOC-C); an Arabic summary section with the provisional line. |
| `docs/handover/deployment.md` (new) | The production deployment guide: the seven §3 topics with their anchors (`domains-and-tls`, `corporate-sso-mapping`, `service-accounts`, `secrets`, `network-boundaries`, `logging`, `monitoring`), plus `before-you-start`, `database`, `evidence-storage`, `worker-settings`, `application-settings`, `compose-service-roles`, `high-availability`, `orchestration-target`, `origin-change`, `first-deployment`, `configuration-keys` (every `.env.example` key → its section), `sources`. B.5 and H.3 texts verbatim. |
| `docs/handover/deployment.ar-summary.md` (new) | Its Arabic summary (provisional, RTL wrapper): purpose, prerequisites, order of steps, external dependencies; B.5 Arabic texts verbatim. |
| `docs/handover/operator-guide.md` (new) | Day-two operation: start, stop, readiness, logs, upgrades and backup entry points, jobs, incident first steps. |
| `docs/handover/operator-guide.ar-summary.md` (new) | Its Arabic summary, which also summarizes `backup-restore.md` and `upgrades.md` (ADR-0072 §2.2). |
| `docs/handover/known-limitations.md` (new) | Known limitations: three generated blocks (external dependencies, the D-249 protocol-audit disclosure, provisional Arabic) and three hand-written sections (the DG6 carry-forward rows of p7-plan §1.4, the carried items of D-253 to D-256, the residuals of ADR-0062 to ADR-0073). |
| `docs/handover/known-limitations.ar-summary.md` (new) | Its Arabic summary. |
| `docs/handover/external-dependencies.json` (new, generated) | 11 `ExternalDependency` entries (the contract schema of ADR-0071); read by `apps/api` at build (About) and by `release-notes.mjs`. |
| `docs/handover/arabic-review.json` (new) | `[]`: no qualified Arabic review has taken place. |
| `docs/handover/security-controls.md` (modified: four link cells only) | HR-01 and HR-02 → `deployment.md#domains-and-tls`; HR-04 → `deployment.md#database` and `backup-restore.md`; HR-06 → `deployment.md#secrets` (D-247 O5). No other byte changed (`git diff` shows 4 lines). |
| `tools/release/known-limitations.mjs` (new) | The generator of ADR-0072 §5: `--protocol-audit <report> (--check \| --write)`; exits 0/1/2. |
| `tools/release/check-handover.mjs` (new) | The guide content checks of ADR-0072 §8: `index` (T-H1), `deployment` (T-H2, T-B14), `summaries` (T-H7), `security-links` (T-H8), `guides` (T-H5 logic), `generated` (T-H3, T-H4, T-H6 by calling the three generators' `--check`); exits 0/1/2. |
| `tools/release/tests/check-handover.test.mjs` (new) | 49 tests: T-H1, T-H2/T-B14, T-H4, T-H7, T-H8, T-H9, T-I14, the T-H5 checker logic on fixtures, and the exit codes. |
| `docs/delivery/handbacks/DG7/T-DG7-DOC-B-evidence/*` | Logs of every check in §3, `sha256.txt` of the deliverables, `env.txt`. |
| this handback | — |

No migration, contract, permission or `p7-pending*.ts` change: DOC-B owns no operation (no `p7-pending-doc-b.ts` exists), so there is no pending entry to remove.

## 2. Behaviour delivered, per requirement

### REQ-S19-011: "the guide covers all seven topics" (T-H2) and the B.5 texts (T-B14)

- `deployment.md` has the seven anchors of ADR-0072 §3. `check-handover.mjs --only deployment` checks that each section exists, is not empty and names a source (a link, a backticked path or a variable name).
- It holds the B.5 texts verbatim (HA statement, sub-path, origin change, readiness, orchestration target), the H.3 corporate-IdP and acceptance texts, the redirect URI `<origin>/api/v1/auth/callback`, the Compose service → role map (the checker requires every service of `deploy/compose/compose.yaml`: `db`, `migrate`, `api`, `worker`, `keycloak`, `smoke`, `load-generate`, `load-sessions`, `backup`), and the orchestration target as an external dependency.
- **"The clean-environment transfer follows it without undocumented steps"** is DO-D's half (`config-trace.mjs`, W10). To make it possible, the guide's `configuration-keys` section maps all 34 keys of `.env.example` to an anchor, and the checker fails if a template key is missing or links no existing anchor. Every anchor that `deploy/scripts/drill/guide-keys.json` cites is checked once that file exists. It does not exist yet, so that part reports **BLOCKED**, never a pass.
- **Corrections to the ADR's "must state" list** (stated here so a reviewer can judge them):
  - ADR-0072 §3 row 3 names the database roles `mth_owner`, `mth_app` **and `mth_worker`**. **No `mth_worker` role exists**: the only mention in the repository is ADR-0072 itself. `db-init/10-mth-roles.sh` creates `mth_owner` and `mth_app`, and the worker connects as `mth_app` (compose `worker` uses `DATABASE_URL_FILE`). The guide states this.
  - Row 2 says "group or claim → role mapping (`identity-saml-broker.md`)". The hub **does not read** `groups` or `roles` claims (`identity-saml-broker.md` §3.5, ADR-0006): roles are explicit scoped assignments. The guide says so, and calls a `groups` claim input for IT's access reviews only.
  - Row 7 names "Administration > Deployment status". **No such screen exists**: `router.tsx` l.598–599 says `getDeploymentStatus` has a client but no screen in P7 (D-254 item 3). The guide names the API operation and states that no screen shows it.
- "accept: Mobily IT (external)": the H.3 acceptance text is in every new document and is never claimed.

### REQ-S19-015: the seven items (T-H1), known limitations (T-H4), Arabic summaries (T-H7)

- **T-H1.** `README.md` maps Guides, Role matrix, Automation guide, Test evidence (`archive:evidence/`, ADR-0062 §2 and ADR-0073), Known limitations, Release notes and Coverage register (`../delivery/requirements.csv`, which the archive ships itself). Every file under `docs/handover/` has a line, including `security-controls.md` (D-247 O3). `release-notes.md` (AN-P7 or the freeze) and `guides/{user,admin}/` (DOC-A, W10) are linked but do not exist yet. They are reported **BLOCKED** ("written later in this release"), never as a pass. Any other missing or unlisted file **FAILs**.
- **T-H4.** `known-limitations.mjs --check` exits 0 with the DO-I report. The generated blocks are as follows.
  - **External dependencies.** 8 rows from the `environment.md` residual table, plus 3 from decisions that are not in that table: D-057 live registry, D-058 live CI, D-243 Q12 orchestration target. A table row the tool does not know, or a known row that is missing, gives exit 2, so a dependency is never silently dropped.
  - **Protocol audit.** The report's head `119dcd05…` and SHA-256 `2614fc6c…f3fd`, the D-249 statement, 28 check × stage lines with their D-249 H1–H11 reference, and the accepted observation F-DG6-952 (C9). The DG7 lines (C3, C5) read "not in D-249 (DG7: disclosed by this release's records)".
  - **Provisional Arabic.** 9 provisional label files, 299 entries, counted with `release-notes.mjs`'s own rule. It also lists every handover Markdown file with Arabic text that `arabic-review.json` does not list.
  - **Checked by tests.** Every p7-plan §1.4 row id, items (a)–(c) and the sweep limits, ADR-0062 to ADR-0073, and D-253 to D-256 appear. A changed report fails `--check` (exit 1).
- **T-H7.** The four IT and operator documents have `.ar-summary.md` pages. Each has the RTL wrapper, the H.3 provisional line (EN and AR) directly under the first heading, the summary-page header, the acceptance text, and the four §2.2 sections. Backup and upgrades are summarized in the operator summary.

### REQ-S16-031, REQ-S21-003 (handover text): T-H8, T-H9, T-I14

- **T-H8.** The four link cells now point at existing anchors; DO-B's `security-controls.test.mjs` (T-G7) passes.
- **T-H9.** `secret-scan.mjs --path docs/handover` exit 0 (24 files) and `claims-scan.mjs` exit 0 (879 files).
  - One Arabic line was reworded after the claims scan flagged it (K2: the Arabic word for a TLS certificate's issuer). The final text passes.
- **T-I14.** Every file under `docs/handover/` is in `manifestFromWorkingTree(REPO, APPROVED_SPEC)`, so the payload secret scan covers it.

### REQ-S16-008: "the docs state the HA limitation"; title "deployment configuration for the actual IT orchestration target when known" (T-B14)

The HA statement is in `deployment.md` (top and `#high-availability`), `operator-guide.md`, `known-limitations.md`, `README.md` and the Arabic summaries. The orchestration target is in `#orchestration-target` and in `external-dependencies.json` (`orchestration-target`, `not_configured`). No manifest is written (D-243 Q12).

### T-H5 (DOC-A's): the checker logic

`check-handover.mjs --only guides` reports "no guides yet" as BLOCKED, exit 2. On fixtures it checks the following:

- equal en/ar file sets;
- equal `##` counts and anchor sets per pair;
- the RTL wrapper and the provisional line, unless `arabic-review.json` lists the file;
- every backticked screen path (`/…`, not `/api/…`) matches a `path:` literal of `router.tsx` or `nav.ts`, where `:param` matches one segment.

DOC-A has to write its guides to that convention.

## 3. Checks run (real exit codes; logs in `docs/delivery/handbacks/DG7/T-DG7-DOC-B-evidence/`)

| # | Command | Result | Log |
| --- | --- | --- | --- |
| 1 | `node tools/gates/validate.mjs --historical --stage DG6` | **exit 0**, "PASS gate DG6 (historical)", 08:46:43–08:48:35Z. **Protocol deviation:** I ran it after implementing, not before (CLAUDE.md asks for it first). Disclosed, not hidden. | `validate-historical-DG6.log` |
| 2 | The H.4 command: `node --test tools/release/tests/check-handover.test.mjs tools/release/tests/role-matrix.test.mjs tools/release/tests/automation-guide.test.mjs` | **exit 0**: 67 tests, 67 pass (49 mine + 9 T-H3 + 9 T-H6), 10 suites, 8.1 s | `h4-command.log` |
| 3 | `node tools/release/known-limitations.mjs --protocol-audit docs/delivery/handbacks/DG7/T-DG7-DO-I-evidence/protocol-audit-all.json --check` | **exit 0** | `known-limitations-check.log` |
| 4 | `node tools/release/check-handover.mjs --protocol-audit <same report>` | **exit 2 (BLOCKED)**, as designed until the freeze: index BLOCKED (release-notes.md, guides/), deployment BLOCKED (guide-keys.json), guides BLOCKED (no guides yet); summaries, security-links and generated PASS; **no FAIL**. Not a pass. | `check-handover-full.log` |
| 5 | `node tools/release/secret-scan.mjs --path docs/handover`; `node tools/release/claims-scan.mjs` | **exit 0**; **exit 0** | `scans.log` |
| 6 | `pnpm -r typecheck` | **exit 0** | `typecheck.log` |
| 7 | `pnpm openapi:lint` | **exit 0** (OpenAPI 3.1.1, 965 operations) | `openapi-lint.log` |
| 8 | `pnpm lint` | **exit 0** | `lint.log` |
| 9 | `git ls-files -co --exclude-standard -z \| xargs -0 npx prettier --check --ignore-unknown` | **exit 0** | `prettier.log` |
| 10 | `pnpm test` | **exit 0**, 08:54:17–08:59:46Z: unit-node 202 files / 2992 tests pass; unit-web 130 / 2175 pass; unit-formula-nocodegen 3 files, 259 pass, 2 skipped. 1-minute load sampled every 30 s (11 samples), peak 4.86, inside the ≤ 8 envelope (environment.md item 6) | `pnpm-test.log`, `pnpm-test-load.log` |
| 11 | `tests/qa/support/with-pg.sh npx vitest run --project integration apps/api/test/integration/contract/contract.test.ts apps/api/test/integration/release` (disposable PostgreSQL 16.15, UTF8, C locale, port 24351) | **exit 0**, 08:59:52–09:01:44Z: 3 files, 124 tests pass (contract 111, `register.test.ts` 9, `about.test.ts` 4). These read `external-dependencies.json` through the register snapshot. I touched no integration test. | `contract.log` |

## 4. Known gaps

1. **guide-keys.json anchors (T-H2 part, T-B14 part):** not checked because DO-D (W10) has not written the file. It is reported BLOCKED. If DO-D needs an anchor I don't have, it requests it in its handback.
2. **T-H5:** only the checker logic is tested here. The real guides are DOC-A's (W10).
3. **`release-notes.md`:** not generated yet (AN-P7's notes, then the freeze). The index links it, and T-H1 reports it BLOCKED until then.
4. **The generated blocks must be regenerated at the freeze.**
   - The protocol-audit block reflects DO-I's fixture report (head `119dcd05…`). The freeze report replaces it: `node tools/release/known-limitations.mjs --protocol-audit <freeze report> --write`, then `--check`.
   - The provisional-Arabic block also changes whenever a handover file with Arabic text is added (DOC-A's `ar/` guides, `release-notes.md`) or a provisional label file changes. `check-handover.mjs`'s `generated` check and the `--check` mode catch this.
5. **Arabic sections inside DO-F's and DO-G's guides (ADR-0072 §2.3).** The Arabic sections of `backup-restore.md` (l.206) and `upgrades.md` (l.223) do not carry the exact H.3 provisional line under their heading. Each says it is provisional in its own words. These files are not mine, so I did not edit them.
   - `check-handover.mjs` prints this as a **warning** and does not fail on it, because ADR-0072 §8's T-H7 wording covers the summary pages, which hold the provisional line.
   - Both files are listed as provisional in known-limitations §3.
6. **Every Arabic text I wrote is provisional.** No qualified reviewer has checked it, and `arabic-review.json` is `[]`.
7. **The guides are checked structurally, not exercised.** The corporate IdP, TLS certificates, the orchestration target and production monitoring are described in them but not exercised (ADR-0072 Residual 2). Compose is not evidence of high-availability readiness.

## 5. Open questions

- **Q1 (orchestrator): `backup-restore.md` and `upgrades.md` provisional line.** Should DO-F's and DO-G's owners add the exact H.3 line under their Arabic section headings (gap 5)? If so, `check-handover.mjs` can then turn the warning into a failure: it is a one-line change in `checkSummaries`.
- **Q2 (architect/orchestrator): ADR-0072 §3 corrections.** Should ADR-0072 §3 be corrected? It names `mth_worker` (no such role), group/claim → role mapping (the hub reads no group claims) and "Administration > Deployment status" (no screen). The guide states the facts, and an ADR amendment is the architect's.
- **Q3 (DOC-C's Q3), answered by implementation.** `check-handover.mjs`'s `generated` check runs `role-matrix.mjs --check` and `automation-jobs.mjs --check`, plus `known-limitations.mjs --check` when given `--protocol-audit`.
- **Q4 (freeze procedure).** The freeze verification should run the H.4 command with `MTH_STRICT_HANDOVER=1`. With that set, the last test requires `check-handover.mjs --protocol-audit <freeze report>` to exit 0, so no BLOCKED is accepted. This sits alongside DO-J's `MTH_STRICT_GUIDES=1`.
- **Q5 (DO-D seam).** `guide-keys.json`: the checker accepts values that are bare anchors (`domains-and-tls`), `deployment.md#anchor` or `docs/handover/deployment.md#anchor`, nested anywhere in the JSON. The `configuration-keys` table of the guide is the intended source for DO-D's key → anchor map.

## Merge instructions

- One commit with every file of §1. No migration, contract or generated-code change. The only modified pre-existing file is `docs/handover/security-controls.md` (four link cells), as H.1 assigns.
- `apps/api`'s build now finds `docs/handover/external-dependencies.json`. The register snapshot gets 11 `externalDependencies` instead of `null`, and About shows the list (FE-C's handback noted it was missing).
- At the freeze: re-run `known-limitations.mjs --write` with the freeze report, then the H.4 command with `MTH_STRICT_HANDOVER=1`.
