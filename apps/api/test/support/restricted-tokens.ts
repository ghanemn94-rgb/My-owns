// T-DG6-BE-Z15 (D-233, F-DG6-640): the expected restricted condition token `[restricted:<tag>:<k>]` of a rule-version
// row at a given row version, for integration tests that assert the exact token text. The tag is computed with the
// API's own `restrictedTokenTag` from the row's id and its secret key, read from the disposable database (the key is
// never served, so a test that only uses the API takes every token from a response instead).
import type { DbOrTx } from "@mth/db";
import { automationRestrictedToken } from "@mth/shared/schemas";
import { restrictedTokenTag } from "../../src/modules/automation/versions.ts";

export interface RestrictedTokens {
  /** Loads the issuing row (`ruleId`, `versionNo`) once; call it after the version row exists. */
  register(ruleId: string, versionNo?: number): Promise<void>;
  /** The token of position `k` issued by the registered row at row version `version`. */
  tok(ruleId: string, version: number, k: number, versionNo?: number): string;
}

export function restrictedTokens(db: () => DbOrTx): RestrictedTokens {
  const issuers = new Map<string, { id: string; key: Buffer }>();
  return {
    async register(ruleId, versionNo = 1) {
      const row = await db()
        .selectFrom("automation_rule_version")
        .select(["id", "restricted_token_key"])
        .where("automation_rule_id", "=", ruleId)
        .where("version_no", "=", versionNo)
        .executeTakeFirstOrThrow();
      issuers.set(`${ruleId}/${versionNo}`, { id: row.id, key: row.restricted_token_key });
    },
    tok(ruleId, version, k, versionNo = 1) {
      const issuer = issuers.get(`${ruleId}/${versionNo}`);
      if (issuer === undefined) throw new Error(`restrictedTokens: ${ruleId}/${versionNo} is not registered`);
      return automationRestrictedToken(
        restrictedTokenTag({ id: issuer.id, version, restricted_token_key: issuer.key }),
        k,
      );
    },
  };
}
