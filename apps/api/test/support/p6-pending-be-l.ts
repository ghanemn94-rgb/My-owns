// P6 operations without a route yet, owned by backend task T-DG6-BE-L (slice B: connectors, configuration and mappings; ADR-0055 §1)
// (docs/architecture/p6-work-split.md §B/A). Remove an entry in the same change that registers its route and exercises it in
// the contract test. Must be empty when the DG6 candidate freezes. Only the owning task edits this file.
export const P6_PENDING_BE_L: readonly string[] = [
  "listConnectors",
  "createConnector",
  "getConnector",
  "putConnector",
  "enableConnector",
  "disableConnector",
  "testConnector",
  "getConnectorMappings",
  "putConnectorMappings",
];
