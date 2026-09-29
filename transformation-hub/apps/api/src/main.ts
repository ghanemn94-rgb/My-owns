import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';

// Never let a stray rejection silently kill (or silently continue) the process (ARCH-13).
process.on('unhandledRejection', (reason) => {
  Logger.error(`unhandledRejection: ${reason instanceof Error ? reason.message : String(reason)}`, 'process');
});

async function main() {
  const { app, config } = await createApp();
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
  Logger.log(`${config.appName} API listening on :${config.port} (mode=${config.demoMode ? 'DEMO' : 'standard'}, env=${config.nodeEnv})`, 'bootstrap');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('API failed to start:', e instanceof Error ? e.message : e);
  process.exit(1);
});
