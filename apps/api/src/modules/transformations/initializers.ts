// The TransformationInitializer port (ADR-0041 §4; p5-work-split §B.2; T-DG5-BE-D, delivered here because the P5
// wiring did not include it): modules that must set something up when a transformation is created (the forms pin of
// slice B) register a function at composition (server.ts); `createTransformation` calls every registered function in
// its own create transaction, after the DG2-DG4 instantiation, so the record and its setup commit or roll back together.
// transformations imports none of the registering modules (the GateFactsProvider pattern). The DG1 request and response
// are unchanged. An initializer must write its own audit events and do no remote or client I/O (it runs in the tx).
import type { Tx } from "@mth/db";
import type { AuditContext } from "../audit/index.ts";

export interface TransformationInitContext {
  readonly transformationId: string;
  readonly organizationId: string;
  readonly actorUserId: string;
  readonly audit: AuditContext;
}

export type TransformationInitializer = (tx: Tx, ctx: TransformationInitContext) => Promise<void>;

const initializers = new Map<string, TransformationInitializer>();

/** Registers (or replaces, by name) an initializer; registration order is call order. */
export function registerTransformationInitializer(name: string, fn: TransformationInitializer): void {
  initializers.set(name, fn);
}

/** Runs every registered initializer in the caller's create transaction. */
export async function runTransformationInitializers(tx: Tx, ctx: TransformationInitContext): Promise<void> {
  for (const fn of initializers.values()) await fn(tx, ctx);
}
