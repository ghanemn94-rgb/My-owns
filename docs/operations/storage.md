# Evidence storage: private filesystem and the optional S3-compatible object store (P6)

This guide is for Mobily IT. It covers where evidence files and export files are kept, and how to switch new uploads
to an S3-compatible object store that IT runs. It also covers what IT has to supply, how the hub tests a setting
before saving it, and which external store a test team can use. Design: ADR-0010 (evidence store) and ADR-0054 §2
(the S3-compatible adapter). Requirement: REQ-S16-006 (M0311). Decisions: D-195 Q2 and Q6, D-197 item 2.

> **Scope and honesty.**
>
> - **Not tested against a live object store.** The S3-compatible adapter has been run only against the in-process,
>   SigV4-verifying test fake (`apps/api/test/support/fake-s3.ts`) through the contract suite. It has not been run
>   against an IT object store, AWS S3 or the external store named in §6. The live IT object store is a **residual**
>   (`docs/delivery/environment.md`, "P6 residuals").
> - **No approval.** "IT-approved store" names a configuration slot that Mobily IT fills. Nothing in this repository
>   claims that IT approved, connected or tested a store.
> - **Not high availability.** A Compose demonstration is not proof of high-availability production readiness. The
>   object store's own durability, replication, backup and encryption at rest are IT's responsibility.
> - Product gate G6 never implies engineering gate DG7, and DG7 never implies any G1–G6 business approval.

## 1. The two drivers

| Driver | Where the bytes live | Default | Configured by |
|---|---|---|---|
| `filesystem` | A private directory (`EVIDENCE_STORAGE_PATH`, default `/var/lib/mth/evidence`; the `evidence` volume in Compose, uid 10001, mode 0700). Never web-served. | **Yes**, in every shipped profile | Environment (ADR-0011): `EVIDENCE_STORAGE_DRIVER=filesystem`, `EVIDENCE_STORAGE_PATH` |
| `s3` | A private bucket in an S3-compatible object store that IT runs | No | The **storage setting** (Administration > Storage, §3), with credentials held as secret references (§4) |

Both drivers implement the same `EvidenceStore` port, and both pass the same contract suite
(`apps/api/src/modules/evidence/stores/contract.ts`; the suite runs once per adapter in
`apps/api/test/integration/evidence/store-contract.test.ts`).

**Evidence is never served from a public URL, in either mode** (ADR-0010 §2, D-195 Q2, A12):

- The adapter never creates a pre-signed URL, never sets an object ACL, and returns no URL from any method.
- Every download goes through the API route that checks the caller's access to the parent record (ADR-0051 §4). The
  API streams the bytes itself and never redirects to the store.
- Links the hub hands out (for example the deep link in a notification) are API paths that are re-authorized when
  opened, never object-store URLs.
- `GET /api/v1/admin/storage` always reports `publicUrls: false`.
- The bucket must therefore **not** be public (§2), and the browser never needs a network route to the store. Only
  the API (and, for export files, the worker) talk to it.

**Which store holds a file.** Each `evidence_content` row records the driver that wrote its bytes
(`storage_driver`, `filesystem` or `s3`; migration `0102`). Reads open the store the row names. Changing the
setting affects **new uploads only**: files uploaded earlier stay readable from the filesystem, so the evidence
volume must stay mounted and backed up after a switch. P6 does not copy existing files between stores.

## 2. What Mobily IT supplies for the object store

| Item | Notes |
|---|---|
| **Endpoint** | `https://…` for any real store. The schema accepts `http://` only so that the local test fake can run. Use a private, internal endpoint; the API must be able to reach it (§7). |
| **Region** | The store's region name (lower case, for example `me-central-1`, or the value an S3-compatible store expects, often `us-east-1`). |
| **Bucket** | Pre-created by IT, **private**, with public access blocked and no public bucket policy or object ACLs. The hub never creates buckets. Name rule: `^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`. |
| **Key prefix** (optional) | Every object key lives under it, for example `mth/prod`. Rule: `^[a-z0-9][a-z0-9_/-]{0,99}$`. Keys below it are opaque `organization/transformation/evidence/uuid` identifiers, never user file names. |
| **Addressing** | Path-style (`forcePathStyle: true`) is the default and suits most S3-compatible stores. Use virtual-hosted style only if the store requires it. |
| **Access key pair** | A dedicated, least-privilege identity for the hub only. Its two values go into the secret store IT uses (§4), never into the hub's database or this repository. |
| **TLS trust** | If the store's certificate is issued by a corporate CA, the runtime must trust that CA. Node.js reads extra CA certificates from the file named by `NODE_EXTRA_CA_CERTS` at process start. This repository has **not** exercised that against a corporate CA. Certificate verification is never switched off. |
| **Encryption, versioning, retention, replication** | The store's own features, configured by IT. The adapter does not depend on them and does not set them. |

**Permissions the access key needs.** These are the S3 operations the adapter calls (`stores/s3.ts`): PutObject,
multipart upload (Create, UploadPart, Complete, Abort), CopyObject, GetObject, HeadObject, DeleteObject and
ListObjectsV2 (to sweep stale temporary `*.part` objects). Expressed as AWS-style IAM actions, this is an
**example** to adapt to the store's own policy language. It has not been tested here.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:AbortMultipartUpload"],
      "Resource": "arn:aws:s3:::<bucket>/<key-prefix>/*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::<bucket>",
      "Condition": { "StringLike": { "s3:prefix": ["<key-prefix>/*"] } }
    }
  ]
}
```

No `s3:PutObjectAcl`, `s3:PutBucketPolicy`, bucket-creation or bucket-administration permission is needed. Grant
none of them.

## 3. Switching to the object store (Administration > Storage)

The storage setting is installation-wide: there is at most one row, `storage_setting`. **With no row, the
environment default applies** (`EVIDENCE_STORAGE_DRIVER`, normally `filesystem`), so a fresh install behaves exactly
as DG5.

| Operation | Permission | What it does |
|---|---|---|
| `GET /api/v1/admin/storage` (`getStorageSetting`) | `storage.configure`, or `operations.read` for read-only (AUD) | The effective driver and its `source` (`environment` or `setting`). For `s3`: the endpoint, region, bucket, prefix, addressing and the two credential **references**, never their values. ETag `0` when nothing has been saved. |
| `POST /api/v1/admin/storage/test` (`testStorageSetting`) | `storage.configure` (ADM_TECH) | Tests a candidate setting (or the saved one when `candidate` is null) outside any database transaction. It writes a probe object, reads it back, compares the checksum and deletes it. For `s3` it also checks that an **unauthenticated read of the probe key is refused**. The result lists each check (`write`, `read_back`, `checksum`, `delete`, `anonymous_read_refused`) as passed, failed or skipped. It never returns a URL or a key. Audit event: `storage_setting.tested`. |
| `PUT /api/v1/admin/storage` (`putStorageSetting`) | `storage.configure` (ADM_TECH) | Saves the setting with a reason of 3–1,000 characters. `If-Match: 0` creates the row; later saves need the current version (428 if missing, 409 if stale). Audit event: `storage_setting.changed`, with the prior and new version. |

Steps:

1. IT creates the bucket and the access key pair (§2), and puts the two secret values into the secret store (§4).
2. A technical administrator (ADM_TECH) opens **Administration > Storage** and enters the endpoint, region, bucket,
   optional prefix, addressing, and the two credential references.
3. They run **Test**, and every check must pass. If `anonymous_read_refused` fails, the bucket or the store allows
   anonymous reads: fix the store before going further.
4. They **Save** with a reason, **within 15 minutes of a passing test of the same values, on the same API process**.
   Otherwise the API answers 422 `storage.test_required`. If several API instances sit behind a load balancer, the
   test and the save must reach the same instance (session affinity, or one instance during the change).
5. New uploads now go to the bucket. Earlier files stay on the filesystem and remain downloadable (§1).

Switching back to `filesystem` is another saved setting. Files written to the bucket while `s3` was active stay
readable from the bucket, so keep the bucket and its credentials while any `s3` row exists.

**Refusals** (problem+json; the English texts are fixed by ADR-0054 §4, and Arabic is shown in the UI):

| Status | Code | When |
|---|---|---|
| 422 | `storage.s3_incomplete` | `s3` without an endpoint, a region, a bucket or both credential references |
| 422 | `storage.secret_ref_invalid` | A credential that is not a `{provider, name}` reference |
| 422 | `storage.test_required` | Saving without a passing test of the same values in the last 15 minutes |
| 422 | `admin.reason_required` | The reason is missing, or not 3–1,000 characters |
| 403 / 404 / 409 / 428 | shared problems | No permission; unknown resource; stale version; missing `If-Match` |
| 503 | `unavailable` | The store cannot be reached or refuses the configured credentials. The upload or download fails, and there is **never** a silent fallback to the other store. |

## 4. Credentials are references, never values

The setting stores `accessKeyRef` and `secretKeyRef` as `{ "provider": "<id>", "name": "<NAME>" }`. The database
checks that each reference has exactly those two keys (`p6_secret_ref_valid`), so a value cannot be stored there. The
value is resolved at request time through the `SecretProvider` registry (ADR-0052 §5; `configuration.md`,
"Secret providers"):

| Provider | Example reference | Where IT puts the value |
|---|---|---|
| `env` | `{ "provider": "env", "name": "MTH_S3_ACCESS_KEY_ID" }` | The variable `MTH_S3_ACCESS_KEY_ID`, or better a file named by `MTH_S3_ACCESS_KEY_ID_FILE` (for example a container secret at `/run/secrets/mth_s3_access_key_id`) |
| `file` | `{ "provider": "file", "name": "mth_s3_secret_access_key" }` | The file `mth_s3_secret_access_key` directly inside `SECRETS_DIR` (for example `/run/secrets`) |
| another id | IT's vault | Only if IT registers its own `SecretProvider` adapter at composition. The product ships no vault adapter. |

The names above are examples: the hub reads whatever names the references give. Provide the values to every process
that opens the store: each **API** instance (uploads, downloads, the test), and the **worker** too if export files
are kept in the object store (§5). A resolved value prints as `[secret]` in logs and responses, and the adapter's
error messages name the operation and the store's error code only, never the endpoint, bucket, key or a credential.
**Rotation:** put the new value under the same name and restart the processes. If the name changes, save a new
setting (test first).

## 5. Export files

Report and register exports are written by the worker to the export-file store (`packages/reporting/src/storage.ts`,
keys `exports/<org>/<job>-a<attempt>.<ext>`). Downloads are proxied by the API, like evidence, and are never public.
Whether export files follow the object-store setting is decided by the Administration > Storage delivery (BE-H2,
p6-work-split §J/C.9). On the tree this guide was written against, export files need the `filesystem` driver (§8).

## 6. An external S3-compatible store for IT testing (not bundled)

D-195 Q6 asks for a licence-reviewed external store that IT can use to test the adapter before connecting its own.
The candidate is **SeaweedFS**. It was checked from its official sources on 2026-10-29 (evidence:
`docs/delivery/handbacks/DG6/T-DG6-DO-C-evidence/seaweedfs-licence-evidence.txt`):

| Fact | Finding | Source |
|---|---|---|
| Licence | **Apache-2.0**. The `LICENSE` file at the repository root is the Apache License 2.0, and the README's "License" section states "Licensed under the Apache License, Version 2.0". | `github.com/seaweedfs/seaweedfs`: `LICENSE` (sha256 `d789d433…ef613`), `README.md` |
| Version | **4.51**. The default branch's `weed/util/version/constants.go` says 4.51, and the Docker Hub tag `4.51` was pushed on 2026-10-26. | `constants.go`; Docker Hub API |
| Image | `chrislusf/seaweedfs`, the image the official README's "Docker" section uses. On 2026-10-29 Docker Hub reported tag `4.51` = `sha256:f7a49e3f3972ebed5be2ed4befa4a0c68eb7bdddba6e692d42729ceb545134b8`. | README; Docker Hub API |
| Support window | **None published** that this check found. **[UNVERIFIED]** | — |
| Not read | The GitHub release page (HTTP 403 from this session) | — |

- SeaweedFS is **not bundled**. It is not in `deploy/compose/compose.yaml`, `deploy/images.lock.json`, the SBOM or the
  licence inventory, and the product never needs it. It is a test aid IT may choose to run. Re-check the licence,
  version and digest when you use it, and pin by digest.
- The "Enterprise Edition" mentioned on the project's site is a separate commercial product, and is not what is named
  here.
- **MinIO server is not used or bundled.** It is licensed AGPL-3.0 (ADR-0010 L-1).
- **No container runtime was available** to this task (the Docker daemon socket refused the connection), so SeaweedFS
  has **not** been run against the hub here.

A test run the way the official README describes it, with credentials read from files instead of typed values
(**example, not executed here**):

```bash
# On an IT test host with Docker. Generate two throwaway values OUTSIDE any repository.
install -d -m 700 ~/.config/mth-s3-test
openssl rand -hex 16 > ~/.config/mth-s3-test/access_key_id
openssl rand -hex 32 > ~/.config/mth-s3-test/secret_access_key
docker run -d --name mth-s3-test -p 127.0.0.1:8333:8333 -v mth-s3-test:/data \
  -e AWS_ACCESS_KEY_ID="$(cat ~/.config/mth-s3-test/access_key_id)" \
  -e AWS_SECRET_ACCESS_KEY="$(cat ~/.config/mth-s3-test/secret_access_key)" \
  -e S3_BUCKET=mth-evidence-test \
  chrislusf/seaweedfs:4.51@sha256:f7a49e3f3972ebed5be2ed4befa4a0c68eb7bdddba6e692d42729ceb545134b8
```

The README states that the container behaves like `weed mini`: an S3 endpoint on port 8333, with the bucket created
and those keys valid. Then give the hub the two files through the `file` provider (`SECRETS_DIR`), and set endpoint
`http://<host>:8333`, region `us-east-1`, bucket `mth-evidence-test` and path-style addressing. Then run **Test** (§3).

- Keep the keys set. The README notes that dropping them runs the store without authentication; the hub's test then
  fails `anonymous_read_refused`, as it should.
- This is a single-node test store over plain HTTP. It proves nothing about production durability, TLS or HA.

## 7. Restricted networks

- The hub needs a route **only** to the object-store endpoint (API, and the worker if export files go there). It
  makes no other outbound call for storage: no public CDN, no AWS metadata service (credentials come from the
  references) and no builder-hosted service.
- In the no-egress Compose variant (`compose.no-egress.yaml`, `restricted-network.md`), an internal store must be
  attached to the project's internal network, or reachable on a route IT allows.
- The browser never reaches the store (§1), so no firewall opening for users is needed.

## 8. Status of each piece in this release

This guide was written against tree `135ff1d` (DG6, W7). The status of each piece at that revision:

| Piece | Status at `135ff1d` | Owner |
|---|---|---|
| `EvidenceStore` port; filesystem adapter (`stores/filesystem.ts`, behaviour unchanged) | Delivered | BE-H |
| S3-compatible adapter (`stores/s3.ts`, `@aws-sdk/client-s3` 3.1156.0, Apache-2.0; D-197) | Delivered, tested only against the in-process fake | BE-H |
| One contract suite run against both adapters; the SigV4-verifying fake | Delivered | BE-H |
| `storage_setting`, `storage_setting_change`, `evidence_content.storage_driver` (`0102`); `storage.configure` (`0103`) | Delivered | ARCH-02 |
| Driver selection from the setting row; `storage_driver` written at upload; Administration > Storage operations (§3); export files on the object store (§5) | **Not yet on this tree.** `admin/storage.ts` registers no route, and `EVIDENCE_STORAGE_DRIVER=s3` still answers 503 for every content operation (`evidence/store.ts`). | BE-H2 (p6-work-split §J/C.9), then FE-B for the page |
| A live IT object store | **Residual**: not exercised | Mobily IT |

Until BE-H2 is merged, keep `EVIDENCE_STORAGE_DRIVER=filesystem`. §3–§5 describe the behaviour ADR-0054 §2 fixes for
that delivery. Re-check them against the release notes of the build you install.

## 9. Backup and restore

With the `s3` driver, evidence bytes are split across two places: the filesystem volume (files uploaded before the
switch) and the bucket (files uploaded after). A consistent backup covers the database, the evidence volume and the
bucket (or its versioning or replication policy), all taken for the same point in time. A restore must bring back all
three before users return. Otherwise rows whose bytes are missing fail with 503 when downloaded. The backup and
restore drill is a P7 item (§19). This guide does not claim one was run.
