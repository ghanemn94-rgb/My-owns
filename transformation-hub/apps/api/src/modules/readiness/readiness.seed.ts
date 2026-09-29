import type { ModuleSeed } from '../../cli/seed-modules';

/** Demo sandbox scenario data for this module (idempotent; uses the module's services). */
export const readinessSeed: ModuleSeed = {
  name: 'readiness',
  run: async () => {
    /* implemented by the module owner */
  },
};
