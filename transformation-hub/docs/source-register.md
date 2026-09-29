# Source register (build-time)

> This is the **build-time** source register for the engineering work. The platform itself implements a runtime Source
> Register (`source_record` / `source_claim` tables, Document & Evidence Center) with the same fields (spec §2).
> Verification status vocabulary: **Confirmed / Historical-unverified / Proposed / Assumed / Conflicting / Unknown**.

## Sources

| source_id | Type | Filename | Version | Checksum | Owner | Upload date | Report date (in source) | As-of date | Extraction date | Extraction status |
|---|---|---|---|---|---|---|---|---|---|---|
| SRC-001 | Specification (text) | `docs/MASTER_PROMPT.md` (user-supplied master prompt, English edition) | 1.0 | see git blob | User (Mobily corporate transformation / PMO) | 2026-09-29 | 2026-09-29 | 2026-09-29 | 2026-09-29 | Performed (verbatim copy) |
| SRC-002 | Image | `IMG_B65D893D-6B73-4D57-85DF-6B72BA10C15D.jpeg` (project tracker) | Unknown | Unknown | User | **Not available in the build environment** | Unknown | Unknown | — | **NOT PERFORMED** — the file was not attached to the session; searched the filesystem, not found |
| SRC-003 | Excel workbook (original tracker) | Not supplied | — | — | User | Not available | — | — | — | NOT PERFORMED |

## Claims (from SRC-001's description of SRC-002 — second-hand; the image itself was not read)

Per spec §2 the summary of the image in the master prompt is used **only as preliminary requirements**. None of these
claims changes any current project status in the platform (AT-01).

| claim_id | Source | Location | Extracted value | Confidence | Verification status | Reviewer | Source-reported value | Confirmed value | Conflict |
|---|---|---|---|---|---|---|---|---|---|
| CLM-001 | SRC-001 (describing SRC-002) | §2, title line | Initiative title "N4 — Unlock delayering potential (e.g., DCs)" | Medium (second-hand) | Historical-unverified | — | as stated | — | none known |
| CLM-002 | SRC-001 | §2 bullet 1 | Heading: DC strategy definition, separation approvals, diligence activities | Medium | Historical-unverified | — | as stated | — | — |
| CLM-003 | SRC-001 | §2 bullet 2 | Heading: Go-to-Market and Target Operating Model | Medium | Historical-unverified | — | as stated | — | — |
| CLM-004 | SRC-001 | §2 bullet 3 | Heading: phased financial carve-out / standalone financial statements | Medium | Historical-unverified | — | as stated | — | — |
| CLM-005 | SRC-001 | §2 bullet 4 | Heading: legal & regulatory requirements and DCCo establishment; references to CST, ATA, TSA, MSA | Medium | Historical-unverified | — | abbreviations as stated; expansions **not** assumed | — | — |
| CLM-006 | SRC-001 | §2 bullet 5 | Heading: separation of additional data centers and completion of associated requirements | Medium | Historical-unverified | — | as stated | — | — |
| CLM-007 | SRC-001 | §2 bullet 6 | Heading: business plan and valuation | Medium | Historical-unverified | — | as stated | — | — |
| CLM-008 | SRC-001 | §2 bullet 7 | Heading: partner engagement, JV structuring, diligence, agreements, closing | Medium | Historical-unverified | — | as stated | — | — |
| CLM-009 | SRC-001 | §2 paragraph 2 | The image shows historical statuses such as "Completed" and "On Track" | Low (statuses not itemised) | Historical-unverified | — | "Completed", "On Track" (unassigned to items) | — | Must not be applied as current status |
| CLM-010 | SRC-001 | §2 paragraph 2 | Site/person/partner names, detailed dates, small figures and percentages exist in the image but are unclear | Low | Unknown | — | not extracted | — | — |

## How these sources were used

- CLM-001…CLM-008 shaped the **proposed** DC Carve-out template (gates G0–G7, 12 workstreams, WBS) — every generated
  activity carries `status = draft`, `verificationStatus = proposed`.
- CLM-009 is represented in the demo sandbox as a `source_claim` with `verification_status = historical_unverified`
  that is **not applied** to any record (acceptance test AT-01).
- No person, partner, site, date, figure or percentage from the image was used.

## Next steps when real sources become available (runtime procedure)

1. Upload through **Document & Evidence Center → Sources** on an approved environment (not this build environment).
2. The platform records checksum, owner, report date, as-of date and extraction date separately.
3. Extracted claims are shown side-by-side with current records as **proposed changes**; nothing is merged without an
   authorized reviewer (`sources.claim.review` / `sources.claim.apply`). Previous sources are preserved.
