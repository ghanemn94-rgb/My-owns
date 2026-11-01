// F-DG6-120 (REQ-S16-029 "never expose secrets"; ADR-0052 §5): the write-time half of the SecretRef namespace rule.
// Every consumer that stores a SecretRef (connector credentials, webhook signing secrets, the SMTP channel, the S3
// storage settings and the assistant endpoint) calls this after its own shape check and before any row is written, so
// a reference outside its provider's namespace (`secretRefInNamespace`: env only MTH_SECRET_<NAME>, file only a plain
// file name in SECRETS_DIR) is a 400 validation error at the field's pointer. The answer depends on the name alone,
// never on whether the variable or file exists, so it is no existence oracle. The resolve-time half is in secrets.ts.
import { problems } from "./problem.ts";
import {
  SECRET_REF_NAMESPACE_CODE,
  SECRET_REF_NAMESPACE_MESSAGE,
  secretRefInNamespace,
  type SecretRef,
} from "./secrets.ts";

/** 400 validation (`validation.secret_ref_namespace` at `pointer`) when `ref` names a secret outside its namespace. */
export function assertSecretRefInNamespace(ref: SecretRef, pointer: string): void {
  if (!secretRefInNamespace(ref))
    throw problems.validation([{ pointer, code: SECRET_REF_NAMESPACE_CODE, message: SECRET_REF_NAMESPACE_MESSAGE }]);
}
