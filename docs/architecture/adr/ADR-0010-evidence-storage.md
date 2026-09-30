# ADR-0010: Evidence storage adapter (filesystem first, optional S3-compatible later)

- **Status:** Proposed for DG1 (interface only in P1; implementation P2/P6). **Date:** 2026-09-30. **Author:** solution-architect.
- **Requirements:** REQ-S16-006, REQ-S19-019, master prompt §13 (evidence repository).

## Decision

1. **Interface `EvidenceStore`** in the API `evidence` module:
   - `put(stream, {contentType, maxBytes}) → {key, sha256, size}`;
   - `get(key) → stream`;
   - `head(key)`;
   - `delete(key)`, reserved for an approved retention job only.

   Keys are opaque UUIDv7-based paths, never user filenames. Metadata (evidence record, owner, parent record, checksum, version, review status) lives in PostgreSQL. Bytes live in the store.
2. **Filesystem adapter first** (`EVIDENCE_STORAGE_DRIVER=filesystem`):
   - Writes to a private directory (`EVIDENCE_STORAGE_PATH`, a Docker volume). It is never under the web root and never served statically.
   - Writes are atomic (temporary file, fsync, rename) and the checksum is computed during the write.
   - Downloads and previews go through an API route that applies the **parent record's authorization** (ADR-0006) and sets `Content-Disposition: attachment` plus a safe `Content-Type`.
   - There are never public or pre-signed URLs to the client in the filesystem mode.
3. **Optional S3-compatible adapter (P6, only if IT approves an object store).**
   - Client: AWS SDK for JavaScript v3 (`@aws-sdk/client-s3`, **Apache-2.0**) against IT's endpoint.
   - Not added to the dependency set in P1 (no unused dependencies).
4. **Licence flags (L-flags)**, recorded for procurement (details in the discovery doc §5):
   - **L-1:** the MinIO **server** is **AGPL-3.0**. MinIO also changed its community distribution in 2025 (binaries/images and console features) [UNVERIFIED; needs a current check].
     - Do **not** bundle MinIO in the product package.
     - If IT already runs an S3-compatible store, the product connects to it.
     - For local S3-adapter testing, pick a store only after licence review. Candidates: SeaweedFS (Apache-2.0), Ceph RGW (LGPL-2.1/3), Garage (AGPL-3.0, same concern as MinIO).
   - **L-2:** the MinIO JavaScript SDK (`minio`) is Apache-2.0 and acceptable. The AWS SDK is preferred because it is vendor-neutral.
   - **L-3:** a cloud object store such as AWS S3 or Azure Blob would be an external SaaS dependency. It is only acceptable if Mobily IT explicitly approves it, and never mandatory (§19 portability).
5. **Upload restrictions (P2/P6):** an allow-list of MIME types checked by magic bytes, size limits, filename sanitisation, and an optional antivirus hook (ICAP/ClamAV adapter) configurable by IT.

## Consequences

- Backups must cover both the database and the evidence volume (§19 item 9). The data-migration manifest carries the evidence keys and checksums (§19 item 11).

## Verification evidence

No P1 dependency. Licence facts are [UNVERIFIED] and must be re-checked when the P6 adapter is chosen (discovery doc §5).
