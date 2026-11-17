# DG7 round 1, code-security-reviewer: static review notes (T-DG7-REV-CS-RG1)

Candidate sha256:9822d8fe947b572d30a24e1f59798587edd610a0c8b8f81a21eaceeb3233a744, source ddf42ccd2630f3d62f6aaf360ff401bbc2bde025.
Scope: `git diff 944aaf810..ddf42ccd2` outside docs/delivery and trading_agent (471 files, +100637/-2070), read in the
full files it touches. Protected paths (tools/gates, tools/agents, .claude, docs/source): no change in P7.
Line numbers are at ddf42ccd2.

## Configuration bundle (REQ-S19-008; ADR-0065)
- routes.ts: every operation calls requireSomeRight + requireRightAt(organization of the row) before reading or writing;
  validate/commit read the stored object OUTSIDE the transaction (l.274-282), If-Match required (l.270).
- service.ts: createExport/uploadImport re-check the right on reloaded grants inside the transaction (freshRightAt,
  l.404) and audit (config_bundle_export.created, config_bundle_import.uploaded); the object is removed if the
  transaction fails. validate/commit take the configBundleImport advisory lock per organization, lock the row FOR
  UPDATE, check the version, and audit (validated / committed). commit re-plans and refuses config_bundle.plan_changed.
- checkBundle: version first, envelope, per-item contentSha256 and kind schema, duplicate key refusal, size re-check.
- plan.ts: the kind's own right is checked with the reloaded principal (kind_not_permitted); each adapter re-checks it at
  write time: upload_policy (requireAction + commitTimeDenial), branding (holdsBrandingConfigure, the branding §11 and
  contrast rules, publishBranding), job_schedule (job.configure; enabled forced false; outbox event), methodology
  (requireStudioPermission, lockConfigDraft, open-draft re-check; drafts only, never publish), config_review_policy
  (AUD and technical_admin reviewers refused as in updateConfigReviewPolicy). Unportable kinds are refused explicitly
  (unportableKind, 422), never dropped (ADR-0065 Amendment 1).
- Tests: apps/api/test/integration/transfer/config-bundle.test.ts (403, If-Match/409, 422 codes, audit, plan_changed,
  kind_not_permitted) - run in 30-p7-security-integration.log.

## Migration export / import (REQ-S19-014, REQ-S19-016; ADR-0064)
- export/service.ts requireExportRight: migration.export at ORGANIZATION scope (narrower grants refused; export-scope
  test). requestExport: reloaded grants, advisory lock, one active export, audit + outbox in one transaction.
  Manifests are served only for a succeeded export and only when their SHA-256 matches the row (readManifest).
  The manifest carries counts/digests/column names, no row values (packages/db/src/transfer/manifest.ts).
- Installation-wide export by an organization-scope ADM_TECH is the documented design (ADR-0064 §7, Residual 4).
- plan.ts: exclusions come from transfer_table_rule / transfer_column_rule (0133 l.57-90): session, oidc_login_state
  excluded; every *_ref secret reference column unbound. A schema-wide sweep of secret-like column names
  (hash|token|secret|password|key|credential|nonce|verifier) found no unclassified credential:
  inbox_notification.link_token is documented as an opaque identifier, re-authorized on use (0098 l.165);
  automation_rule_version.restricted_token_key (0127) is an internal per-row HMAC key that travels with the data so
  restricted tokens stay valid after transfer; it is not a password hash, session or credential (observation only).
- import.ts: owner role, empty target (E1-E4), audit_event triggers verified enabled (l.251-263) and never disabled
  (only `DISABLE TRIGGER USER` on the OTHER exported tables, re-enabled before commit, l.706/777, one transaction),
  table/column sets compared with the target catalogue (l.686-690), identifiers quoted (quoteIdent), row values bound
  as one JSON parameter through jsonb_populate_recordset (l.453-476): no SQL injection from package content.
- confinedPath (export.ts l.426-433): refuses absolute paths and `..` segments and checks the resolved prefix.
- attachments.ts: copy-in through the EvidenceStore port, refused before any write when the target holds other bytes,
  read back and compared (size, SHA-256).
- rebind.ts: CLI only, strict CSV, conflict checks, guarded hold transition, one identity_rebind_event and audit per line.
- identity: an unbound carried user cannot sign in by OIDC (existing or e-mail binding) or dev login (routes.ts l.275).

## Retention (REQ-S16-024; ADR-0067)
- classes/service.ts updateClass: reloaded grants, retention lock, FOR UPDATE, If-Match, run-in-progress refusal, E.5
  refusals (only operational, unmanaged classes may archive; purge only when every table is purge-eligible; period and
  IT reference required), audit with before/after.
- 0144 retention_purge_record(): SECURITY DEFINER, EXECUTE only to mth_app, refuses non-running runs, non-eligible or
  non-operational classes, append-only tables, unarchived or already-purged rows and rows not past retention; DELETE by
  %I/%L-quoted primary key, exactly one row. Archived rows are read-only (guard triggers). Read endpoints return table
  names and primary keys only.
- worker archive.ts: identifiers through ident(); the age comparison is in SQL against the run's as_of.

## OIDC loopback exception (D-258)
- packages/config/src/load.ts secureIssuerAllowed: production accepts https, or http only when isLoopbackHost (exact
  hostname set: localhost, 127.0.0.1, [::1]); `localhost.evil.example` refused (load.test.ts T-R10). oidc.ts allowHttp
  uses the same function.

## Scanners and allow-lists (DO-J2, DO-E6)
- secret-scan.mjs: allow-list entries are value-hash pinned (rule + valueSha256; path also checked outside history),
  protected paths cannot be covered, stale entries fail. The four entries removed on this branch (two round-6 QA
  grep-pattern entries, guide-keys.json, dockerfile-context.test.mjs) are absent; the history scan passes with no stale
  entry (12-secret-scan-history.log), so the removal is sound.
- DEFECT F-DG7-1011: isNonSecretValue l.89 exempts every value matching /^[a-z0-9_.]+$/ ("an i18n key") before the
  entropy rule, so lower-case hex/alphanumeric secrets (the openssl rand -hex shape of deploy/scripts/init-secrets.sh
  l.48) are never S3 hits; contradicts ADR-0063 §5 residual 1 and security-controls.md SC-13 ("finds ... high-entropy
  assignments"). Reproduction: repro/s3-lowercase-secret-repro.sh (10-...log); probes 13/13b show nothing hidden today.
- scan-assets allow-list: T3 entries pinned by package, file and SHA-256; R1/R3/R5 refused in T1/T2. claims allow-list:
  19 entries, each path + line SHA-256, no globs.

## Image, Compose, backup (DO-E3/E4; REQ-S19-012)
- Dockerfile: adds packages/reporting manifest and a PNPM_HOME install dir; .dockerignore re-includes only
  apps/*/src/**/*secret*.ts(x) and packages/*/src/**/*secret*.ts(x) (source files) and requirements.csv; .env*, *.pem,
  *.key and other *secret* files stay excluded.
- build-from-archive.sh: SHA-256 checked before GNU tar -x (safe defaults).
- restore.sh: every file checksum, same PostgreSQL major, empty target only.
- DEFECT F-DG7-1012: backup.sh sets no umask/chmod for the set (only the scratch WORK dir, l.264-265); the dump is
  0644 in 0755 directories; compose.yaml backup service falls back to ${MTH_BACKUP_ROOT:-/tmp/mth-backups}.
  Reproduction: repro/backup-set-mode-repro.sh (14-...log).
- dry-run.ts: the throw-away database is named <source>_dryrun_<stamp>, created from the source as template, and only
  dropped after this run created it (throwAway assigned after CREATE succeeds, l.421).

## Seal and verify (REQ-DLV-041, REQ-S20-028; ADR-0073)
- seal.mjs outputPathAllowed refuses an output directory inside the payload unless META-excluded or git-ignored.
- verify-seal.mjs: a check that cannot run is BLOCKED, never PASS; REHEARSAL-PASS never counts as A28; tamper cases
  covered by tools/release/tests/verify-seal.test.mjs (run in 20-release-tool-tests-sparse.log, all pass).

## Web (P7 screens)
- No dangerouslySetInnerHTML/innerHTML/eval in the P7 diff; download hrefs are built from internal path helpers and
  uuids. /readyz storage probe is read-only (head), cached 5 s, returns enums only.

## Documentation drift (F-DG7-1013, Low)
- ADR-0071 §5.1 "It reads nothing else" and the §5.2 section list do not include tools/release/release-notes-disclosures.json
  and the "Known limitations disclosed in this release" section the generator writes (release-notes.mjs l.10, 28, 328;
  docs/handover/release-notes.md l.71). D-280 accepted it without an amendment.
