import { z } from 'zod';

/**
 * The web CSP allows no `eval` (script-src has a nonce and 'strict-dynamic', no 'unsafe-eval' in production — see
 * src/proxy.ts). Zod 4 otherwise probes `new Function('')` once to decide whether to compile its parsers; the probe is
 * caught by Zod, but the browser reports it as a CSP violation, which would be noise in security monitoring. Parsers are
 * interpreted instead (found by the P7 private-mode drill's browser check).
 *
 * The bundle holds TWO Zod instances: this ES module import, and Zod's CommonJS build loaded by the workspace packages
 * (@hub/contracts and @hub/domain are compiled to CommonJS). Both are configured.
 */
z.config({ jitless: true });
// eslint-disable-next-line @typescript-eslint/no-require-imports
(require('zod') as typeof import('zod')).config({ jitless: true });
