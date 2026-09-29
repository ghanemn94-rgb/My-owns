import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WorkerService } from './platform/jobs/worker.service';
import { registerJobHandlers } from './jobs';

/** Worker process: outbox dispatch, schedules, durable jobs (runs independently of any browser session). */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  registerJobHandlers(app);
  const worker = app.get(WorkerService);
  worker.start();
  const stop = async () => {
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
