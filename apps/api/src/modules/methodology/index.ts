// methodology (ADR-0002, ADR-0014, ADR-0016 §2): the pinned methodology catalogue (playbook v1.0 seed: T01 dimensions,
// Diagnose workstreams, TOM dimensions, product gate definitions G1-G6 and their criteria, charter scope checks, good
// outcome test) and the label/translation edits of TOM dimensions. Source text is verbatim from the playbook; Arabic is
// a provisional translation. Depends on platform, audit and access only.
export { METHODOLOGY_MODULE, registerMethodologyModule } from "./routes.ts";
export {
  loadGateDefinitions,
  loadMethodologyCatalogue,
  toGateDefinition,
  toTomDimension,
  type MethodologyCatalogue,
} from "./repository.ts";
// P5 slice A (ADR-0039 §1-§4; p5-work-split §A.1; T-DG5-BE-A): the ConfigResolver port, the kind-provider registry,
// the content hash and the Studio draft helpers the other slice A tasks (BE-B, BE-B2, BE-B3, BE-C, KBE-A) build on.
export {
  createConfigResolver,
  loadCatalogue,
  resolvePinnedVersion,
  type CatalogueEntry,
  type ConfigResolver,
  type PinnedVersion,
  type ResolvedElement,
} from "./config-resolver.ts";
export {
  configKindProvider,
  configKindProviders,
  registerConfigKindProvider,
  type AffectedRecordCount,
  type CompatibilityFinding,
  type ConfigElementChange,
  type ConfigKindProvider,
  type ConfigKindProviderHooks,
  type PreviewOutcome,
} from "./kinds.ts";
export { contentSha256 } from "./content-hash.ts";
