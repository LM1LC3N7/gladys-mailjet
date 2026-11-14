// -----------------------------------------------------------------------------
// Entry point: SDK wiring only. MailjetApp (src/app.js) registers its handlers
// BEFORE connect(); /data holds the hourly count, the pause and the refused
// keys (src/store.js); Mailjet is reached through src/mailjet.js.
//
// Environment variables provided by the Gladys supervisor, read by the SDK:
// GLADYS_HOST_API_URL, GLADYS_INTEGRATION_TOKEN, GLADYS_INTEGRATION_SELECTOR.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { MailjetApp } from './src/app.js';
import { createMailjet } from './src/mailjet.js';
import { FileStore } from './src/store.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const gladys = new GladysIntegration();
const app = new MailjetApp({
  gladys,
  logger,
  store: new FileStore(),
  mailjet: createMailjet({
    userAgent: `gladys-mailjet/${version} (+https://github.com/LM1LC3N7/gladys-mailjet)`,
  }),
});

gladys.handleShutdown(() => app.stop());

logger.info('Starting the Mailjet integration...');
app.start().catch((err) => {
  logger.error(`Initial connection failed (${err?.name ?? 'Error'})`);
  process.exit(1);
});
