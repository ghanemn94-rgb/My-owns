import type { ModuleSeed } from '../../cli/seed-modules';

/** Demo sandbox scenario data for this module (idempotent; uses the module's services). */
export const configSeed: ModuleSeed = {
  name: 'config',
  run: async () => {
    /* implemented by the module owner */
  },
};
