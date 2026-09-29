import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { loadConfig } from './platform/config';
import { checkContracts } from './platform/contract-check';

/** Build the HTTP application (shared by main.ts and integration tests). */
export async function createApp(opts: { logger?: false } = {}) {
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: opts.logger ?? ['error', 'warn', 'log'], bodyParser: true });
  if (config.trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  await app.init();
  const c = checkContracts(app);
  if (config.nodeEnv !== 'production' && (c.missing.length || c.unbound.length)) {
    throw new Error(`Contract check failed. Unimplemented routes: [${c.missing.join(', ')}]; handlers without contract: [${c.unbound.join(', ')}]`);
  }
  return { app, config };
}
