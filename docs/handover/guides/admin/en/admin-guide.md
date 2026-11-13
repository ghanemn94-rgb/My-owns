# Mobily Transformation Hub: administrator guide

This guide is for the platform's administrators: access, technical and methodology administrators. It describes the **Administration** screens of this release as they are built. The Arabic version, `../ar/admin-guide.md`, has the same sections and anchors. Installing and operating the servers is in the IT documents next to this folder: `deployment.md`, `operator-guide.md`, `backup-restore.md` and `upgrades.md`.

- Every right below is checked by the server. The interface only hides what you cannot use.
- Nothing an administrator does in the platform is an IT, Finance or business approval. Records of approvals given outside the platform are references only.
- Accepting this handover is a decision of Mobily IT, made outside the platform. This package is engineering evidence, not that acceptance.

## Users and roles {#users-roles}

- **Users** (`/admin/users`) is where an access administrator pre-provisions users, binds their identities and disables accounts. A person who is not provisioned is told at sign-in to contact an access administrator.
- **Role assignments** (`/admin/assignments`) grant a role at a scope, for example an organization or a transformation. Access comes only from roles granted at a scope. Job titles never grant access.
- The roles and their permissions are listed in `../../../role-matrix.md`. These roles and permissions are the platform's configurable starting point, not a Mobily-approved access policy.
- Organizations and business units are at `/admin/organizations`.
- Sensitive grants (`/admin/sensitive-grants`) let one person open one sensitive record. They are created from the record's own page.
- Every change is recorded in the audit trail (`/admin/audit`).

## Identity {#identity}

- **Sign-in settings** (`/admin/identity`) show the sign-in mode (OpenID Connect, or development sign-in, which is not for production), the accepted issuer, the client ID, the scopes, the expected audience, the PKCE method and the claim mapping (subject, email, display name). The client secret shows only as Configured or Not configured, never its value.
- These settings come from the server configuration. They are shown for review and cannot be changed here. IT sets them as `deployment.md` describes.
- Roles come from **Role assignments**, not from the identity provider. At least one administrator must be provisioned and mapped before the first corporate sign-in.
- Sign-in has been tested only with a synthetic identity provider. Connecting the corporate identity provider is an external dependency. Not verified in this release. Mobily IT must supply and test it.
- **Service identities** (`/admin/service-identities`) are the identities that background jobs and connectors use. Each reads only what its grant allows, never as a person.

## Storage {#storage}

- **Storage** (`/admin/storage`) shows the current evidence store: a private file system or an S3-compatible object store, and whether it is set by the server environment or by a saved setting. Evidence never has public URLs: it is always served through the application after an access check.
- A technical administrator can change the storage on this page (endpoint, region, bucket, key prefix, keys) and use **Test these values** before saving. Secret values are never shown again after saving.
- The upload policy (`/admin/upload-policy`) sets the allowed file types and the maximum size.
- An object store that is not configured shows as not configured, never as working.

## Notification channels {#channels}

- **Notifications** (`/admin/notification-channels`) lists the optional channels, such as email (SMTP) and enterprise messaging. Each is off by default and needs IT's endpoint and credentials.
- **Deliveries** (`/admin/notification-deliveries`) lists one row per notification sent to an optional channel. The in-app inbox is not listed, because it always receives every notification.
- A channel's live endpoint is an external dependency. Not verified in this release. Mobily IT must supply and test it.

## Job schedules {#job-schedules}

- **Jobs** (`/admin/jobs`) lists the background jobs with their schedule and whether each is enabled.
- **Job operations** (`/admin/jobs/operations`) shows the recent runs, failures and the worker's heartbeat. A failed job appears in the failure queue (`/admin/automation/failures`) and as an operational exception (`/admin/operations`).
- The retention job `retention.archive` ships disabled. Enable it only after the retention periods are agreed (see "Retention").
- The full job list, with owners and recovery steps, is in `../../../automation-operations.md`.

## Configuration transfer {#config-transfer}

**Configuration transfer** (`/admin/config-transfer`) moves published configuration between installations as a bundle. It needs `config_bundle.export` to export and `config_bundle.import` to import.

1. **Export.** Tick the kinds to export (none ticked exports every kind with a published version), give a reason, and request the export. The bundle appears in the list with its kinds, item count and a download link (`/admin/config-transfer/exports/:configBundleExportId`).
2. **Upload.** In the target installation, upload the JSON file under **Import a bundle**. A file over 5 MiB, or a file that is not JSON, is refused before anything is sent.
3. **Validate.** Open the import (`/admin/config-transfer/imports/:configBundleImportId`) and press **Validate**. The page lists each item with its planned action: New draft, New draft of an existing item, Identical (nothing to do), Conflict or Refused, and the reason.
4. **Commit as drafts.** Only a validated import without conflicts or refused items can be committed. An import with a conflict or a refused item becomes **Invalid** and can never be committed: resolve the cause and upload the bundle again.

- An import creates drafts that go through the normal review and publishing. It never publishes anything.
- Branding, the notification policy, review policies and the upload policy have no draft stage: committing applies them as a change. Job schedules are imported disabled.
- If someone else changed the import meanwhile, the page reloads it and shows the reason. Check it and act again.

## Data export and migration status {#data-export}

**Data export** (`/admin/migration/exports`, right `migration.export`). A migration export copies this whole installation, with its ids, links, audit history and evidence, into a package in IT-controlled storage. It never contains sessions, tokens or secret values.

1. Enter a **Reason** (3 to 1000 characters; it is recorded in the audit trail) and press **Request export**. Only one export can be queued or running at a time.
2. The list shows each export's status: Queued, Running, Succeeded or Failed, each with a label and an icon. Counts not known yet show **Unknown**, never 0.
3. After **Succeeded**, the export's page (`/admin/migration/exports/:migrationExportId`) offers **Download manifest** and **Download attachment manifest**. A failed export shows its failure reason.
4. An export of demonstration data is labelled **Synthetic demo data**.

Before an export, IT stops the source's worker and waits for an empty queue (`operator-guide.md`).

**Migration status** (`/admin/migration/imports`, right `migration_import.read`). Imports and identity rebinds are run by IT with the migration tools. This page is read-only.

- Each import shows its reconciliation result: **Counts and checksums match** or **Differences found**. Its reconciliation report (`/admin/migration/imports/:migrationImportId/reconciliations/:migrationReconciliationId`) lists differing tables first and every attachment difference.
- **Identity rebind** (`/admin/migration/identity-rebinds`) lists each moved account as **Not linked: cannot sign in**, **Linked to a new identity** or **Same identity confirmed**.

A transfer moves data or configuration. It never grants a business, Finance or IT approval.

## Retention {#retention}

**Status in this release.** The Retention screens are not built in this release. **Retention** (`/admin/retention`) and its sub-pages show the "not available yet" page. The retention rules work through the platform's API, with the rights `retention.read`, `retention.configure` and `retention.run` (archived records, runs and classes), and `backup.read` (backup sets). The behaviour below is what the API applies.

- Each record class has a retention action: **Keep**, **Archive** or **Archive, then delete**. Every class starts as "Keep". Business records, audit and snapshots are always kept. Periods must be agreed with Mobily IT.
- A period that is not set reads **Not set (IT to agree)**.
- **IT approval reference.** Record the reference of the approval Mobily IT gave outside this platform, for example a change ticket. Saving it does not approve anything.
- **Effect on the inbox.** Archived read notifications can no longer be marked unread. With "Archive, then delete" they disappear from the inbox.
- **Dry run first.** A dry run shows what a run would archive or delete. Nothing is changed. A run's status is Queued, Running, Succeeded or Failed.
- **Backup sets.** Backups and restores are run by IT with the backup scripts (`../../../backup-restore.md`). The list is read-only. If none was reported, it says "No backup set has been reported yet."
- The retention job ships disabled (see "Job schedules").

## Requirement register and About {#register-about}

- **Requirement register** (`/admin/requirements`) lists the requirements of this release and their delivery status, read-only. The register is maintained in the repository. Filter by Class, Status, Area and Final gate. The filters are kept in the address, so a filtered view can be shared. A requirement's details open at `/admin/requirements/:reqId`.
- The line "Register snapshot: … rows, SHA-256 …" identifies the register file this build contains.
- These are engineering delivery states, not business approvals. Register texts are kept in English, as in the repository, also on the Arabic screen.
- **About this release** (`/admin/about`) shows the application and API contract versions, the requirements by status, the unfinished items with their missing dependency, the clauses that complete after the engineering gate, and the remaining external configuration dependencies.
- A value the build does not contain shows **Unavailable** or "Unknown: this build did not include the list.", never zero or "none".

## Deployment status {#deployment-status}

- The deployment status has no screen in this release. It is available through the API to holders of `operations.read`. It reports the origin and base path, the applied schema version, the evidence storage (ok, fail or unknown) and the worker (alive, stale or unknown). An unknown value is never reported as working.
- The health and readiness endpoints, and how IT monitors them, are described in `../../../deployment.md` (section "Monitoring") and `../../../operator-guide.md`.

## External dependencies {#external}

These items are outside the platform and are not verified in this release. Mobily IT must supply and test them:

- the corporate identity provider;
- the object store for evidence, if one is used;
- SMTP and enterprise messaging;
- the corporate data sources of the connectors;
- the AI endpoint, if one is used.

The complete, current list is in `../../../known-limitations.md` and on **About this release**.
