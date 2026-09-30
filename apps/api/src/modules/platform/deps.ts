// Dependencies handed to every module's route registration (built once in server.ts).
import type { AppConfig } from "@mth/config";
import type { Db } from "@mth/db";

export interface ModuleDeps {
  readonly db: Db;
  readonly config: AppConfig;
}
