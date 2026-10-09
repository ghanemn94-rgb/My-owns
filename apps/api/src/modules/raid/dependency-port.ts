// RaidDependencyPort (ADR-0031 §2; T-DG4-BE-D): how the raid module writes a RAID Dependency entry, which IS the
// canonical T08 dependency row (REQ-PB-078, M0150 "Avoid duplicate registers that drift"). The implementation is
// `raidDependencyPort` in workflows/t08-dependencies.ts (it reuses T08's DEP-nn code allocation, the dependency-type
// check and the cycle guard under the graph lock); the composition root (server.ts) passes it to registerRaidModule,
// the T08ScheduleFlagsProvider / GateFactsProvider pattern (ADR-0023 §8): raid never imports workflows.
//
// The caller (raid/register.ts) has already authorised the write (raid.edit AND dependency.edit, at commit time),
// validated the body (400) and the RAID rules (422 probability, closed), and checked If-Match. The port does the T08
// rules (422 dependency.*), the write, and the one audit event of the change, all inside the caller's transaction.
import type { DependencyTable, Tx } from "@mth/db";
import type { Selectable } from "kysely";
import type { WriteContext } from "../transformations/index.ts";

export type DependencyRow = Selectable<DependencyTable>;
export type RaidLevelValue = "high" | "medium" | "low";

/** A RAID Dependency entry to create (ADR-0031 §2 mapping). */
export interface RaidDependencyCreate {
  readonly description: string;
  readonly impact: RaidLevelValue;
  readonly ownerUserId: string;
  /** T15 "Due" = the dependency's needed-by date. */
  readonly dueDate: string | null;
  readonly mitigation: string | null;
  /** T08 From initiative; null = `other` (no initiative endpoint). */
  readonly fromInitiativeId: string | null;
  /** T08 To initiative; null = `other`. */
  readonly toInitiativeId: string | null;
  /** A T08 dependency type code; null = `other`. */
  readonly dependencyType: string | null;
}

/** The T15 fields a RAID update may change on a Dependency entry (undefined = unchanged). */
export interface RaidDependencyChanges {
  readonly description?: string;
  readonly impact?: RaidLevelValue;
  readonly ownerUserId?: string;
  readonly dueDate?: string | null;
  readonly mitigation?: string | null;
  /** The register's initiative of a dependency is its To initiative (raid_register); the cycle guard runs again. */
  readonly toInitiativeId?: string | null;
}

export interface RaidDependencyPort {
  /**
   * Takes the transformation's dependency-graph lock, then the row lock (FOR UPDATE), in the T08 order, and returns
   * the row; undefined when no dependency with this id exists in the transformation.
   */
  lock(tx: Tx, transformationId: string, dependencyId: string): Promise<DependencyRow | undefined>;
  /** Creates the canonical dependency row (DEP-nn), audited as `dependency.create`. */
  create(ctx: WriteContext, input: RaidDependencyCreate): Promise<DependencyRow>;
  /** Changes the canonical row (the caller holds `lock`), audited as `dependency.update`. */
  update(ctx: WriteContext, current: DependencyRow, changes: RaidDependencyChanges): Promise<DependencyRow>;
  /** Closes the entry: the dependency becomes `resolved` (the caller holds `lock`); the note is the audit reason. */
  resolve(ctx: WriteContext, current: DependencyRow, closureNote: string): Promise<DependencyRow>;
}
