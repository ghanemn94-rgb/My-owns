// Output adapters of the transformations module's records (ADR-0042 §3, §5; T-DG5-BE-G): `transformation` (the intake
// creates it through the DG1 createTransformation operation), `charter` (linked: drafted through the DG2 charter
// operations) and `tom_canvas_cell` (linked: filled through the DG2 updateTomCanvasCell operation). Verify-and-link only
// (kit.ts header): nothing here writes a transformations table.
import { outputAdapter } from "./kit.ts";

/** `transformation`, create: created since launch, in the instance's organization. */
export const transformationOutput = outputAdapter({ recordType: "transformation", stateColumns: [] });

/**
 * `charter`, link: the charter of the instance's transformation (an organization-scope intake: of the transformation
 * its first step created; kit.inScope checks it).
 */
export const charterOutput = outputAdapter({ recordType: "charter", stateColumns: [] });

/** `tom_canvas_cell`, link: a cell of the transformation's TOM canvas that its owner marked ready (complete). */
export const tomCanvasCellOutput = outputAdapter({
  recordType: "tom_canvas_cell",
  stateColumns: ["status"],
  linked: (r) => r.state["status"] === "ready",
});
