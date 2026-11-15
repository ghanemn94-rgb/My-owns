// qa-verifier probe only (untracked, removed after the probe): the root config with a sequencer that runs the files in QA_ORDER.
import { mergeConfig } from "vitest/config";
import { BaseSequencer } from "vitest/node";
import base from "./vitest.config.ts";
class GivenOrder extends BaseSequencer {
  async sort(files: any[]) {
    const order = (process.env.QA_ORDER || "").split(",");
    const id = (f: any) => String(f.moduleId ?? f[1] ?? f);
    const rank = (f: any) => { const i = order.findIndex((o) => id(f).endsWith(o)); return i < 0 ? 99 : i; };
    return [...files].sort((a, b) => rank(a) - rank(b));
  }
}
export default mergeConfig(base, { test: { sequence: { sequencer: GivenOrder }, fileParallelism: false } });
