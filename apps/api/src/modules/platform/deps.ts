// Dependencies handed to every module's route registration (built once in server.ts).
import type { AppConfig } from "@mth/config";
import type { Db } from "@mth/db";

export interface ModuleDeps {
  readonly db: Db;
  readonly config: AppConfig;
}

/**
 * What a module's `register*Module` hook reports to the composition root (D-048). An "active" module delivers P1
 * behaviour; a "scaffold" module exists with its boundary, public interface, wiring hook and own test suite, and its
 * business behaviour arrives in `deliversIn`. A scaffold registers NO routes (a mutating route would owe the full
 * authorization + validation + concurrency + audit + tests invariant and is out of P1 scope).
 */
export interface ModuleRegistration {
  readonly module: string;
  readonly status: "active" | "scaffold";
  readonly deliversIn: string;
  /** Routes the hook registered, as "METHOD /path". Empty for a scaffold. */
  readonly routes: readonly string[];
}
