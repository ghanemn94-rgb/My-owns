# ADR-0072: P7 handover documentation set: the `docs/handover/` tree, the language rule per document, the seven-topic deployment guide, the generated role matrix, the automation operations guide, the generated known limitations and the guide content checks

- **Status:** Proposed for P7 (DG7). Author: solution-architect (T-DG7-ARCH-05), 2026-11-12. Base `7f2d984a077886c703a6db31329b873dbcf8e06f` on `claude/mobily-transformation-platform-dg6-regate`.
- **Requirements (slice H of `docs/architecture/p7-plan.md`):** REQ-S19-011, REQ-S19-015.
  - The register, About and release notes are ADR-0071.
  - The data and API handover (`docs/handover/{data,api}/`) is ADR-0070.
  - The security-controls matrix is ADR-0063.
- **Sources (quoted):**
  - REQ-S19-011, acceptance: "A18;A22: the guide covers all seven topics, and the clean-environment transfer follows it without undocumented steps". Title: "domains/TLS, corporate SSO mapping, service accounts, secrets, network boundaries, logging and monitoring (handover item 8)". Permissions: "prepare:devops-engineer; accept:Mobily IT (external); view:IT".
  - REQ-S19-015, acceptance: "A18;A28: the package contains all seven items, and the coverage register equals docs/delivery/requirements.csv at the DG7 candidate". Items: "Guides;Role matrix;Automation guide;Test evidence;Known limitations;Release notes;Coverage register". Procedure: "Guides are written in English and Arabic where user-facing and packaged with the release".
  - Master prompt M0359 (handover item 8), M0363 (handover item 12), M0414 ("remaining external configuration dependencies").
  - CLAUDE.md: "Arabic RTL and English LTR for every user-facing string".
  - Playbook: no block concerns the IT handover documents. Nothing below is attributed to it.
- **Decisions applied:**
  - D-243 **Q7** (user): "user and admin guides in EN and AR; IT and operator guides in EN with an Arabic summary page; Arabic not checked by a qualified reviewer is marked provisional".
  - D-243 **Q12**: no manifests for an unknown target.
  - D-243 **Q13**: approved records are never rewritten.
  - **D-247 O3:** "DOC-B adds the `security-controls.md` line to the handover index".
  - **D-247 O5:** "the matrix links to the deployment and backup guides are assigned to DOC-B when those guides exist".
  - **D-249:** the protocol-audit hits are disclosed in the known-limitations guide, generated from DO-I's report.
  - **D-250 O5:** "the corporate IdP stays a disclosed residual (D-049)".
- **Builds on:**
  - ADR-0062 (the archive's `docs/` copies `docs/handover/**` and `docs/delivery/requirements.csv`; test evidence in `evidence/`);
  - ADR-0063 (secret and claims scans; `security-controls.md`);
  - ADR-0066, ADR-0068 (backup and upgrade guides);
  - ADR-0069 (the guide anchors that `guide-keys.json` cites; the B.5 guide texts);
  - ADR-0070 (`docs/handover/{data,api}/`);
  - ADR-0071 (`external-dependencies.json`, the release notes).
- **Two gate systems.** The handover is engineering documentation. Mobily IT's acceptance of it is external ("accept:Mobily IT (external)"). No guide may state or imply an IT, business or Finance approval, a certification, or that DG7 follows from product G6 (p7-work-split §2 rule 8).

## Context

1. `docs/handover/` holds one file today: `security-controls.md` (DO-B, D-247). Its rows HR-01, HR-02, HR-04 and HR-06 refer to "the deployment guide (ADR-0072)" and "the backup guide (ADR-0066)" in plain text, because those guides do not exist yet.
2. Operations material exists as `docs/operations/*.md` (DG1–DG6): `configuration`, `identity-saml-broker`, `monitoring`, `storage`, `restricted-network`, `health-readiness`, `notifications`, `clean-start` and `dependency-audit`. Each covers part of the deployment topics. None is the handover deployment guide.
3. The role defaults live in `packages/shared/src/permissions.ts` (`ROLES`). `packages/db/src/seed.test.ts` pins their parity with the seed migrations. `docs/analysis/permissions-matrix.md` is a design record by stage, not a role × permission table.
4. Provisional Arabic UI texts are listed in `apps/web/src/i18n/provisional-ar-p6.ts` and the `provisional-ar.ts` files (p7-plan §1.4).
5. Worker jobs are registered in `apps/worker/src/handlers/index.ts` (`DOMAIN_HANDLERS`) plus the platform handlers. Schedules come from `/admin/job-schedules`, and service identities from ADR-0053.

## Decision

### 1. The tree

| Path | Item (REQ-S19-015 / M0359) | Owner | Language (§2) | Generated? |
| --- | --- | --- | --- | --- |
| `docs/handover/README.md` | index of every file below, with the seven REQ-S19-015 items mapped to files | DOC-B | EN + AR summary | no; checked by T-H1 |
| `docs/handover/deployment.md` | the production deployment guide, seven topics (handover item 8) | DOC-B | EN | no; checked by T-H2 |
| `docs/handover/deployment.ar-summary.md` | its Arabic summary | DOC-B | AR (provisional) | no |
| `docs/handover/operator-guide.md` (+ `.ar-summary.md`) | day-two operation: start, stop, readiness, logs, the upgrade and backup entry points, incident first steps | DOC-B | EN + AR summary | no |
| `docs/handover/backup-restore.md` | backup and restore (ADR-0066) | DO-F | EN (the AR summary is a section of `operator-guide.ar-summary.md`) | no |
| `docs/handover/upgrades.md` | upgrades (ADR-0068) | DO-G | EN (summary as above) | no |
| `docs/handover/automation-operations.md` (+ `.ar-summary.md`) | the automation operations guide | DOC-C | EN + AR summary | job table generated (§6) |
| `docs/handover/role-matrix.md` | the role matrix | DOC-C | EN and AR column headers and role names | **yes** (§4) |
| `docs/handover/known-limitations.md` (+ `.ar-summary.md`) | known limitations | DOC-B | EN + AR summary | **sections generated** (§5) |
| `docs/handover/external-dependencies.json` | the remaining external configuration dependencies (M0414) | DOC-B | data | **yes** (§5.1) |
| `docs/handover/release-notes.md` | release notes | DO-J | EN with an AR summary section | **yes** (ADR-0071 §5) |
| `docs/handover/security-controls.md` | security-controls matrix | DO-B (exists) | EN | no; its own test |
| `docs/handover/data/**`, `docs/handover/api/**` | schema, API and connector handover | DO-H | EN | partly (ADR-0070) |
| `docs/handover/guides/user/{en,ar}/*.md` | user guide | DOC-A | EN and AR in full | no; checked by T-H5 |
| `docs/handover/guides/admin/{en,ar}/*.md` | admin guide (including configuration transfer and retention) | DOC-A | EN and AR in full | no; checked by T-H5 |
| `docs/handover/final-report.template.md` | final delivery report template | DO-J (ADR-0073) | EN | no |

- **Coverage register.** It is not copied into `docs/handover/`. The archive ships `docs/delivery/requirements.csv` itself (ADR-0062 §2), which makes "equals docs/delivery/requirements.csv at the DG7 candidate" true by identity, and A28 checks the bytes (ADR-0073). `README.md` names its archive path.
- **Test evidence.** It is in the archive's `evidence/` (ADR-0062), and `README.md` names it.

### 2. The language rule (D-243 Q7)

1. **User and admin guides: English and Arabic in full.**
   - Each `en/<file>.md` has an `ar/<file>.md` with the same file name.
   - Each pair has the same number of `##` headings and the same explicit anchors (`{#anchor}` ids or the HTML `id` the guide uses), so a link works in both.
   - The Arabic files are written right to left.
2. **IT and operator documents: English, with an Arabic summary page.** These are deployment, the operator guide, backup and restore, upgrades, automation operations and known limitations.
   - The summary pages are `*.ar-summary.md`. Backup and upgrades are summarized inside the operator summary.
   - Each summary states the purpose, the prerequisites, the order of steps, and the external dependencies of its document.
3. **The provisional marker.**
   - Every Arabic file, or Arabic section inside an English file, carries the exact line of p7-work-split §H.3 (EN and AR) directly under its first heading, unless the file is listed in `docs/handover/arabic-review.json`. That file holds entries `{ path, reviewer, date }` for a check by a qualified Arabic reviewer. It is empty in this release: no such review has taken place, and no agent may add an entry.
   - The B.5 guide texts of ADR-0069 and the §H.3 texts are given in English and provisional Arabic, and DOC-B uses them verbatim.
4. **Directionality.** Arabic Markdown files start with `<div dir="rtl" lang="ar">` and end with `</div>`, so renderers that honour HTML show them right to left. Code, paths and commands stay inside LTR code spans.

### 3. The deployment guide (REQ-S19-011; seven topics)

`docs/handover/deployment.md` has these sections, with these explicit anchors. T-H2 checks each anchor, and checks that each section is not empty and names its sources.

| # | Topic | Anchor | Must state (sources) |
| --- | --- | --- | --- |
| 1 | Domains and TLS | `domains-and-tls` | `APP_BASE_URL` (an https origin; root path only, the B.5 sub-path text); TLS termination at IT's proxy or load balancer (HR-01); database TLS parameters (HR-02, `configuration.md`); the origin-change text (B.5) |
| 2 | Corporate SSO mapping | `corporate-sso-mapping` | OIDC settings (`OIDC_*`, Administration > Identity); the redirect URI `<origin>/api/v1/auth/callback`; group or claim → role mapping (`identity-saml-broker.md`); identity rebind after a transfer (`mth-db rebind-identity`, ADR-0064); at least one mapped administrator before first sign-in (D-243 Q5); **the corporate IdP is an external dependency, not verified in this release** (D-049, D-250 O5) |
| 3 | Service accounts | `service-accounts` | the database roles `mth_owner`, `mth_app` and `mth_worker` and what each may do; the worker's service identities (ADR-0053); the evidence store's account (S3 or file system, `storage.md`); the bootstrap administrator (`mth-db bootstrap`, refused on a non-empty database) |
| 4 | Secrets | `secrets` | every secret variable of `.env.example` as a `NAME_FILE` entry; `SecretProvider` references for connector secrets (named, never shown); rotation (HR-06); no secret in images, logs or the repository (the ADR-0063 scans) |
| 5 | Network boundaries | `network-boundaries` | inbound: the API port behind TLS only; outbound: none required (`restricted-network.md`, `compose.no-egress.yaml`); optional egress per connector, SMTP, enterprise messaging, the AI endpoint and object storage, each off by default; `/readyz` is public, everything else needs a session |
| 6 | Logging | `logging` | JSON logs to stdout; the fields; secret redaction; the audit trail is in the database (append-only, ADR-0004), not in the logs; retention of logs is IT's |
| 7 | Monitoring | `monitoring` | `/healthz`, `/readyz` (database, migrations and storage gate; the worker is reported only; B.5 readiness text); the worker heartbeat and operational exceptions (`monitoring.md`); Administration > Deployment status |

The guide also holds:
- the B.5 HA statement and the orchestration-target text (T-B14);
- the Compose service → generic role map;
- every anchor that `deploy/scripts/drill/guide-keys.json` names (DO-D cites them; DOC-B owns them, B.6).

**The "no undocumented step" half** is DO-D's `config-trace.mjs` (ADR-0069 §4). A target key without a guide anchor fails the drill. That is the A18 proof. T-H2 is the structural half.

### 4. The role matrix (generated)

1. **Generator:** `tools/release/role-matrix.mjs` (DOC-C). It imports `packages/shared/src/permissions.ts` with Node 24's built-in type stripping. The import of that file was measured working under Node 24.21.0 in this task (handback §3). The generator has no dependency.
2. **Output `docs/handover/role-matrix.md`:**
   - a role table: code, English name, Arabic name, kind (`source`, `implementation`, `technical_admin`);
   - one table per permission category: rows are permission codes with their English and Arabic descriptions, columns are the 14 roles, cells `✓` or empty.

   The output is deterministic, sorted by code, with no timestamp.
3. **`--check`** regenerates in memory and exits 1 on any byte difference (T-H3). The source is the same object that `seed.test.ts` pins to the migrations, so the handover matrix, the code and the database seeds cannot drift silently.
4. **Header text** (§H.3): the roles and defaults are a configurable starting point, not a Mobily-approved access policy (the seed migrations' own wording).

### 5. Known limitations (generated sections)

`docs/handover/known-limitations.md` has hand-written sections and generated blocks. Each generated block sits between `<!-- generated:<name> begin -->` and `<!-- generated:<name> end -->`. The generator is `tools/release/known-limitations.mjs` (DOC-B), with `--write` and `--check`.

1. **`external-dependencies`.**
   - Source: the residual table of `docs/delivery/environment.md`, read as a named file (D-138). It covers the live IdP, the object store, SMTP, enterprise messaging, the corporate data source, the AI endpoint, the live registry (D-057), the live CI (D-058) and the orchestration target (D-243 Q12).
   - Output: the Markdown block **and** `docs/handover/external-dependencies.json`, an array of `ExternalDependency` (`key`, `title`, `owner`, `status` ∈ `not_configured`, `not_verified`, `blocked`; the contract schema of ADR-0071).
   - The ADR-0071 snapshot and the release notes read that JSON, so About, the release notes and the guide show one list.
2. **`protocol-audit` (D-249).**
   - Source: a `tools/release/protocol-audit.mjs --all --json` report given as `--protocol-audit <file>`. The orchestrator produces it at the freeze, and DO-I's `protocol-audit-all.json` is the fixture.
   - Output: the report's `head` and SHA-256, then one line per check × stage with a hit. Each line gives the check id, the requirement, the stage, the hit count and the disclosure reference (D-249 H1–H11).
   - It then gives the statement that these are disclosed historic observations and that no gate was reopened (user decision, D-249).
   - F-DG6-952 is shown as its accepted observation (C9).
3. **`provisional-arabic`:** from the `provisional-ar*.ts` files, the number of provisional keys per file, plus the guide files without an `arabic-review.json` entry.
4. **Hand-written:** the DG6 carry-forward residuals of p7-plan §1.4. T-H4 requires each source row id to appear: REQ-S16-007, REQ-DLV-038, REQ-S10-002 (items a–c and the sweep limits), REQ-S16-030, REQ-S17-001, REQ-S17-009, REQ-S20-029, REQ-S20-030. It also requires the ADR residual sections of P7 (ADR-0062–ADR-0073), each by ADR number.

### 6. The automation operations guide

`docs/handover/automation-operations.md` (DOC-C) covers:
- a generated job table: job code, owning domain, service identity, default schedule (enabled or disabled), failure handling (retries, the `operations.job_failed` exception ledger, the `automation.job_failed` queue) and recovery (`runJobNow`, `job.repair`);
- the retention job `retention.archive` (ADR-0067; ships disabled; dry run first);
- the transfer export job (ADR-0064);
- the failure queue;
- how to read the heartbeat.

T-H6 asserts that every job name in `DOMAIN_HANDLERS` and the platform handlers appears in the table, and that no name appears there that the worker does not register.

### 7. User and admin guides

Content (DOC-A, written on the finished screens, W10):
- **User guide:** sign-in; My work; a transformation journey through the six phases and the product gates G1–G6 (shown as **business** approvals inside the product); evidence; KPIs and benefits; search; notifications.
- **Admin guide:** users and roles; identity; storage; channels; job schedules; configuration transfer (ADR-0065); data export status (ADR-0064); retention (ADR-0067); requirement register and About (ADR-0071); deployment status (ADR-0069).

Screenshots, if any, use the synthetic demo dataset and are labelled as synthetic. T-H5 checks the guides (§8).

### 8. The guide content checks (one tool, one test file)

`tools/release/check-handover.mjs` (DOC-B) and `tools/release/tests/check-handover.test.mjs`:

| Test | Proves |
| --- | --- |
| T-H1 | `README.md` lists every file under `docs/handover/` and no missing file. It maps each of the seven REQ-S19-015 items to an existing file or archive path, and holds the `security-controls.md` line (D-247 O3). |
| T-H2 | The deployment guide has the seven §3 anchors, each section non-empty and citing at least one source file or variable. It holds the T-B14 texts and the `guide-keys.json` anchors. |
| T-H3 | `role-matrix.mjs --check` exits 0 on the tree, and exits 1 after a permission is added to a fixture copy. |
| T-H4 | `known-limitations.mjs --check` exits 0. Every §5.4 row id and P7 ADR number appears. The protocol-audit block equals the one generated from the given report, and a changed report fails it. |
| T-H5 | For user and admin guides: the `en`/`ar` file sets are equal; each pair has equal `##` heading counts and equal anchor sets; each AR file carries the provisional line unless `arabic-review.json` lists it. Every screen path the guides name exists in `apps/web/src/app/router.tsx`. |
| T-H6 | The automation job table equals the registered handlers (§6). |
| T-H7 | Each IT and operator document has its Arabic summary (§2.2) with the provisional line. |
| T-H8 | `security-controls.md` links HR-01, HR-02, HR-04 and HR-06 to `deployment.md#…` and HR-04 to `backup-restore.md` (D-247 O5). DO-B's matrix test still passes. |
| T-H9 | ADR-0063's secret scan (`payload`) and claims scan run over the tree with `docs/handover/**` in scope and report nothing. Every handover file is in the candidate manifest (ADR-0071 T-I14). |

### 9. Who builds it, and in which wave

| Task (wave) | Files |
| --- | --- |
| DOC-C (W8) | `role-matrix.mjs`, `role-matrix.md`, `automation-operations.md` (+ summary), T-H3, T-H6 |
| DOC-B (W9) | `README.md`, `deployment.md` (+ summary), `operator-guide.md` (+ summary), `known-limitations.md` (+ summary), `external-dependencies.json`, `known-limitations.mjs`, `check-handover.mjs`, the `security-controls.md` links, `arabic-review.json`, T-H1, T-H2, T-H4, T-H7, T-H8, T-H9 |
| DO-F (W8), DO-G (W7) | `backup-restore.md`, `upgrades.md` (index lines requested from DOC-B) |
| DOC-A (W10) | `guides/{user,admin}/{en,ar}/**`, T-H5 runs green on them |
| DO-J (W8) | `release-notes.md` (ADR-0071 §5) |

## Consequences

- The handover has one index, one language rule and one checker. Generated parts cannot drift from their sources: permissions, `environment.md`, the protocol-audit report, the register and the provisional files.
- Arabic is complete where users read it. Arabic is a summary where IT reads it. All of it is labelled provisional until a qualified reviewer checks it, and that check is external.

## Residuals (honest)

1. **All Arabic text in this release is provisional.** No qualified Arabic reviewer has checked it, and `arabic-review.json` ships empty.
2. **The seven-topic guide is checked structurally (T-H2) and by DO-D's drill (no undocumented key).** The corporate IdP, TLS certificates, the orchestration target and production monitoring are described, not exercised: they are external dependencies.
3. **The known-limitations protocol-audit block reflects the report given at the freeze.** Hits found later are not in it.
4. **Markdown RTL depends on the renderer honouring `dir="rtl"`.**

## Alternatives considered

- **Full Arabic IT guides.** Not required by D-243 Q7, and they would add schedule risk (R9).
- **A hand-written role matrix.** Rejected: it would drift from `permissions.ts`.
- **Copying the register into `docs/handover/`.** Rejected: two copies need a parity check. The archive ships the file itself.

## Version evidence (M0314)

No new dependency. The generators use Node built-ins on the pinned Node 24.21.0. `role-matrix.mjs` relies on Node 24's built-in TypeScript type stripping, a Node 24 feature available without a flag in 24.21.0 (measured in this task: the import of `permissions.ts` ran under `node` 24.21.0).
