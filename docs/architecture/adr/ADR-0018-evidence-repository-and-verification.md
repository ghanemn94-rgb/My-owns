# ADR-0018: Evidence repository metadata, content revisions, links and verification state

- **Status:** Accepted for P2 (DG2). Author: solution-architect (T-DG2-ARCH-01 / 01B), 2026-10-02.
- **Requirements:** REQ-S16-013 (Evidence entity), REQ-S13-012 (filename or inaccessible link = unverified), REQ-PB-023 (workstream outputs), REQ-PB-027 (baseline evidence).
- **Builds on:** ADR-0010 (EvidenceStore adapter: filesystem by default, optional S3-compatible store, both inside company infrastructure), ADR-0016 (guards). Physical model: migration `0012`.

## Context

Gate criteria (ADR-0015) must tell evidence that a reviewer actually opened and accepted apart from a filename typed into a field. The master prompt is explicit: evidence that is only a filename or an inaccessible link counts as unverified, and the criterion stays incomplete.

## Decision

1. **`evidence` item**, with `kind`:

| `kind` | Content | Can it be verified? |
|---|---|---|
| `file` | stored bytes, through `evidence_content` | yes |
| `note` | native text, `note_body` | yes |
| `external_link` | `url` (http/https only) | yes |
| `file_reference` | a bare filename, `file_name` | **never**: CHECK `evidence_filename_never_verified` |

   The item also carries: title, description, type, source, owner, observation period, `review_status` (unverified/verified/rejected), `accessibility_status` (unchecked/accessible/inaccessible), and the reviewer fields with `reviewed_content_id`.

2. **`evidence_content`:** append-only file revisions.
   - Each revision holds `storage_key` (the EvidenceStore key; never a public URL), `sha256`, `size_bytes` (≤ 1 GiB hard ceiling; the configured limit is lower), content type, file name, uploader and time.
   - `evidence.current_content_id` points at the latest revision.
   - A new revision resets the item to `unverified`, because a verification is bound to `reviewed_content_id`.

3. **Verification rule:** `review_status = 'verified'` requires all of:
   - `accessibility_status = 'accessible'`;
   - a reviewer ≠ creator (separation of duties);
   - for files, `reviewed_content_id = current_content_id`.

   These are CHECK `evidence_verified_rule` plus the API's `evidence.review` permission check. The reviewer explicitly confirms accessibility (`EvidenceReview.accessibilityStatus`). The API never infers it from a URL.

4. **`evidence_link`:** a polymorphic `(record_type, record_id)` link to any of the 20 allow-listed P2 record types in the same transformation.
   - The trigger `p2_record_ref_guard` refuses a dangling or cross-transformation link.
   - Links are removed with a reason (status `removed`), never deleted.
   - There is one active link per (evidence, record).

5. **Download** goes through the API, which checks `transformation.read`, streams the bytes from the EvidenceStore and sends `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`. There are no public or presigned URLs in P2. Upload is `application/octet-stream` with an `X-File-Name` header. The SHA-256 is computed server-side while streaming.

6. **Gate use:**
   - A criterion with `requires_verified_evidence` is complete only if at least one *verified* evidence item is linked to the record(s) the criterion evaluates.
   - Unverified, rejected, `file_reference` and `inaccessible` items are listed in `unverifiedEvidenceIds` and never count.

## Alternatives considered

- **Evidence attached as jsonb arrays on each record:** rejected. One evidence item supports several records (a market study backs a T01 row and a baseline), and reviewing it once must count everywhere.
- **Inferring accessibility by fetching the URL server-side:** rejected. It is an SSRF risk and needs outbound network access, which the platform refuses (no outbound internet, ADR-0011). Accessibility is a human review fact.
- **Content-addressed dedupe across evidence items:** deferred (P6). `storage_key` is unique per revision.

## Consequences

- The `evidence` API module is new in P2 (ADR-0002 already reserves it). It owns `evidence`, `evidence_content`, `evidence_link` and the EvidenceStore wiring.
- Malware scanning and retention for stored files are P6 (ADR-0010 licence/ops flags). P2 stores files only in the company-controlled store.

## Verification

- **Migration probe P15:** a `file_reference` marked verified is refused.
- **Required integration tests:**
  - review by the creator → 403;
  - verify without `accessible` → 422;
  - a new content revision resets to unverified;
  - a link to another transformation's record → 422;
  - a G1 criterion with only filename evidence → incomplete;
  - AUD write → 403.
