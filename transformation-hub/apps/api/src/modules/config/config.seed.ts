import type { ModuleSeed } from '../../cli/seed-modules';

/**
 * Demo sandbox scenario data for the configuration module: none. The demo projects keep the template default RAG
 * thresholds, no template upgrade and their setup state — no approval, approver or launch is invented (spec §21).
 * The demo projects are created on the latest published template version by the portfolio seed.
 */
export const configSeed: ModuleSeed = {
  name: 'config',
  run: async () => {
    /* intentionally empty — see above */
  },
};
