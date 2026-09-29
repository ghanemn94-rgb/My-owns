import type { ModuleSeed } from '../../cli/seed-modules';

/** Demo sandbox scenario data for this module (idempotent; uses the module's services). */
export const planningSeed: ModuleSeed = {
  name: 'planning',
  run: async () => {
    /* implemented by the module owner */
  },
};
