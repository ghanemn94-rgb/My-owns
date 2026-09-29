import { Logger } from '@nestjs/common';
import { createApp } from './bootstrap';

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
