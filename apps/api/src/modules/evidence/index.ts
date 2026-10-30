// evidence (ADR-0002, ADR-0010, ADR-0018): evidence items, append-only content revisions in the EvidenceStore,
// polymorphic links to P2 records, and the verification state. Only `verified` evidence counts toward a product-gate
// criterion; a bare filename (`file_reference`) or an inaccessible link never does (REQ-S13-012).
// Depends on platform, audit and access only.
export { EVIDENCE_MODULE, registerEvidenceModule } from "./routes.ts";
export { loadVerifiedEvidenceFacts, toEvidence, type EvidenceFact } from "./repository.ts";
