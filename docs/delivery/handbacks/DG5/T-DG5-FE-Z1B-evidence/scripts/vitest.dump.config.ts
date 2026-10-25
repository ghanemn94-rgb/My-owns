import webConfig from "/home/user/wt/dg5-fe-z1/apps/web/vitest.config.ts";
const c: any = { ...webConfig, root: "/home/user/wt/dg5-fe-z1/apps/web" };
c.test = { ...c.test, globals: true, setupFiles: ["/var/tmp/mth-run.IVngdx/claude-0/repro/dump-hook.ts", "/home/user/wt/dg5-fe-z1/apps/web/test/setup.ts"] };
export default c;
