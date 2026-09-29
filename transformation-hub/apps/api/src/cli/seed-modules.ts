import type { INestApplicationContext } from '@nestjs/common';
import type { RequestContext } from '../platform/context';

export interface ModuleSeedArgs {
  app: INestApplicationContext;
  dcProjectId: string;
  genProjectId: string;
  /** Run as a demo persona (key as in DEMO_USERS, e.g. 'pm', 'chair') inside one transaction. */
  asUser: <T>(key: string, fn: (ctx: RequestContext) => Promise<T>) => Promise<T>;
  userId: (key: string) => Promise<string>;
  log: (m: string) => void;
}

export interface ModuleSeed {
  name: string;
  run: (args: ModuleSeedArgs) => Promise<void>;
}

/**
 * Demo scenario seeds contributed by modules (each must be idempotent and use the module's services so that
 * validation, authorization, audit and outbox apply). Modules append here as they are implemented.
 */
export const DEMO_MODULE_SEEDS: ModuleSeed[] = [];
