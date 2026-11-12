// The ConfigBundleKindAdapter port and its registry (P7 slice D; ADR-0065 §6; p7-work-split §D.1; T-DG7-BE-F).
//
// transfer imports no domain module: each owning module defines the adapter of its kinds in a file next to the service
// it calls (methodology/config-bundle-adapter.ts, automation/…, admin/…, tasks/…, jobs/…), and the composition root
// (server.ts, the P7 wiring block) registers them here, one line per adapter (the P5 AutomationActionRegistry pattern).
//
// An adapter:
//   - exports its kind's latest PUBLISHED items of an organization, keyed by stable codes (never ids);
//   - validates an item's content against the owning module's schema;
//   - plans one item against the target (create_draft / new_draft / identical / conflict / refused);
//   - writes one item inside the commit's transaction through the owning module's own write path, with the kind's own
//     right re-checked on the caller's reloaded grants, the kind's own audit event, and NEVER a publish: a drafting kind
//     ends as a draft, a job schedule ends disabled (ADR-0065 §5).
// A missing adapter means the kind is not available in this installation (config_bundle.kind_unavailable).
import type { DbOrTx, Tx } from "@mth/db";
import type {
  BundleContext,
  BundleItemInput,
  BundleWriteContext,
  ConfigBundleKind,
  ConfigBundleKindAdapterPort,
  ExportedBundleItem,
  PlannedBundleItem,
  WrittenBundleRecord,
} from "@mth/shared/transfer";
import type { FastifyRequest } from "fastify";
import type { Principal } from "../../access/index.ts";

export type { BundleContext, BundleItemInput };
export type ExportedItem = ExportedBundleItem;
export type PlannedItem = PlannedBundleItem;
export type WrittenRecord = WrittenBundleRecord;
export type WriteContext = BundleWriteContext<Tx, FastifyRequest, Principal>;
/** The port with the API's concrete types (the owning modules alias the same instantiation). */
export type ConfigBundleKindAdapter = ConfigBundleKindAdapterPort<DbOrTx, Tx, FastifyRequest, Principal>;

export interface ConfigBundleAdapterRegistry {
  register(adapter: ConfigBundleKindAdapter): void;
  get(kind: ConfigBundleKind): ConfigBundleKindAdapter | undefined;
  kinds(): readonly ConfigBundleKind[];
}

export function createConfigBundleAdapterRegistry(): ConfigBundleAdapterRegistry {
  const adapters = new Map<ConfigBundleKind, ConfigBundleKindAdapter>();
  return {
    register(adapter) {
      if (adapters.has(adapter.kind)) throw new Error(`config bundle: kind ${adapter.kind} is registered twice`);
      adapters.set(adapter.kind, adapter);
    },
    get: (kind) => adapters.get(kind),
    kinds: () => [...adapters.keys()],
  };
}

/** The process-wide registry the routes read; server.ts registers into it (tests may build their own). */
let current: ConfigBundleAdapterRegistry = createConfigBundleAdapterRegistry();

export function configBundleAdapters(): ConfigBundleAdapterRegistry {
  return current;
}

/** Replaces the registry (server.ts creates a fresh one per buildServer, so two servers in one test never share). */
export function setConfigBundleAdapters(registry: ConfigBundleAdapterRegistry): void {
  current = registry;
}
