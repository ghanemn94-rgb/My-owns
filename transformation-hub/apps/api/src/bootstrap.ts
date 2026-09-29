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
  // bodyParser: false — Nest's default would also register urlencoded, letting a cross-site HTML form post to public routes
  // (login CSRF, SEC-P1-07). Only JSON and raw octet-stream (uploads) are accepted.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: opts.logger ?? ['error', 'warn', 'log'], bodyParser: false });
  if (config.trustProxy !== false) app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } }));
  app.use(cookieParser());
  // API responses carry project data: never cache them in browsers or intermediaries (C-26, SEC-P1-08).
  app.use((_req: unknown, res: { setHeader(k: string, v: string): void }, next: () => void) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    next();
  });
  app.useBodyParser('json', { limit: '1mb' });
  // Raw uploads (documents/imports): only application/octet-stream, bounded by HUB_MAX_UPLOAD_MB.
  app.useBodyParser('raw', { type: 'application/octet-stream', limit: config.storage.maxUploadBytes });
  await app.init();
  const c = checkContracts(app);
  if (config.nodeEnv !== 'production' && (c.missing.length || c.unbound.length)) {
    throw new Error(`Contract check failed. Unimplemented routes: [${c.missing.join(', ')}]; handlers without contract: [${c.unbound.join(', ')}]`);
  }
  return { app, config };
}
