import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WorkerService } from './platform/jobs/worker.service';
import { registerJobHandlers } from './jobs';
import { ensureDefaultOrgSchedules } from './platform/jobs/platform.jobs';

process.on('unhandledRejection', (reason) => {
  Logger.error(`unhandledRejection: ${reason instanceof Error ? reason.message : String(reason)}`, 'process');
});

let stopping = false;
const RETRY_MS = Number(process.env.HUB_WORKER_ORG_RETRY_MS ?? 15000);

/**
 * The default organization's platform schedules need the organization, which exists only after the bootstrap (or the
 * demo seed) has run. The worker must not crash-loop before that — orchestrators start it together with the API — so it
 * keeps its loop running (heartbeat, health) and retries until the organization appears.
 */
async function ensureSchedulesWhenReady(app: Awaited<ReturnType<typeof NestFactory.createApplicationContext>>) {
  for (let attempt = 0; !stopping; attempt++) {
    try {
      await ensureDefaultOrgSchedules(app);
      if (attempt > 0) Logger.log('organization found — default platform schedules ensured', 'worker');
      return;
    } catch (e) {
      if (attempt === 0 || attempt % 20 === 0) Logger.warn(`waiting for the organization before creating platform schedules: ${(e as Error).message}`, 'worker');
      await new Promise((r) => setTimeout(r, RETRY_MS).unref());
    }
  }
}

/** Worker process: outbox dispatch, schedules, durable jobs (runs independently of any browser session). */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  registerJobHandlers(app);
  const worker = app.get(WorkerService);
  worker.start();
  void ensureSchedulesWhenReady(app);
  const stop = async () => {
    stopping = true;
    Logger.log('worker stopping', 'worker');
    await worker.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('worker failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
