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

// Order matters: documents → governance → planning → gates → carve-out … (later seeds may reference earlier data).
import { documentsSeed } from '../modules/documents/documents.seed';
import { governanceSeed } from '../modules/governance/governance.seed';
import { planningSeed } from '../modules/planning/planning.seed';
import { gatesSeed } from '../modules/gates/gates.seed';
import { carveoutSeed } from '../modules/carveout/carveout.seed';
import { newcoSeed } from '../modules/newco/newco.seed';
import { readinessSeed } from '../modules/readiness/readiness.seed';
import { financeSeed } from '../modules/finance/finance.seed';
import { jvSeed } from '../modules/jv/jv.seed';
import { aiSeed } from '../modules/ai/ai.seed';
import { reportingSeed } from '../modules/reporting/reporting.seed';
import { importsSeed } from '../modules/imports/imports.seed';
import { integrationsSeed } from '../modules/integrations/integrations.seed';
import { notificationsSeed } from '../modules/notifications/notifications.seed';
import { configSeed } from '../modules/config/config.seed';
DEMO_MODULE_SEEDS.push(
  documentsSeed,
  governanceSeed,
  planningSeed,
  gatesSeed,
  carveoutSeed,
  newcoSeed,
  readinessSeed,
  financeSeed,
  jvSeed,
  aiSeed,
  reportingSeed,
  importsSeed,
  integrationsSeed,
  notificationsSeed,
  configSeed,
);
