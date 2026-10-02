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
