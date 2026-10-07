// code-security-reviewer DG2 round-17 lint-convention probe (NOT product code). Copied into the disposable probe clone
// at apps/web/src/pages/zzprobe/ and linted with the candidate's eslint.config.js. Each line marked BYPASS-n is a raw
// navigation or raw cache write that the FE15 convention says app code must not do.
import { useQueryClient } from "@tanstack/react-query";
import * as RR from "react-router";
import { useNavigate as useNav } from "react-router";
export function Page() {
  const queryClient = useQueryClient();
  const nav1 = RR.useNavigate(); // BYPASS-1 namespace import
  const nav2 = useNav(); // BYPASS-2 renamed import
  const { setQueryData } = queryClient;
  const action = queryClient; // BYPASS-5 alias named `action`
  return async () => {
    await Promise.resolve();
    setQueryData.call(queryClient, ["k"], 1); // BYPASS-3 destructured
    queryClient["setQueryData"](["k"], 2); // BYPASS-4 computed member
    action.setQueryData(["k"], 3); // BYPASS-5
    void nav1("/a");
    void nav2("/b");
  };
}
