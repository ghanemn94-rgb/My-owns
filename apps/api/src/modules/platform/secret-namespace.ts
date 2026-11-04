// F-DG6-120 and F-DG6-181 (REQ-S16-029 "never expose secrets"; REQ-S10-004; ADR-0052 §5 and its amendments of
// 2026-11-02 and 2026-11-04; D-209): the write-time half of the SecretRef rules. Every consumer that stores a SecretRef
// (connector credentials, webhook signing secrets, the SMTP channel, the S3 storage settings and the assistant endpoint)
// calls `assertSecretRefsBound` after authorization and its own shape check, and before any row is written:
//  1. the namespace (`secretRefInNamespace`: env only MTH_SECRET_<NAME>, file only a plain file name in SECRETS_DIR):
//     400 validation, `validation.secret_ref_namespace` at the field (not audited; it depends on the name only);
//  2. the binding (`secretBinding` over the process's manifest, SECRET_BINDINGS_FILE): 400 validation, with every
//     failing reference's field error, `validation.secret_ref_not_bound` at the reference (one answer for every cause:
//     unset, set, another organization's, another kind's, unknown) or `validation.secret_ref_host_not_bound` at the host
//     field. The problem carries a `secretRefusal`, which secret-refusals.ts audits as `secret_ref.refused`.
// Neither step asks a provider or reads a variable or file, so neither is an existence oracle. The resolve-time half is
// the registry's `resolve(ref, use)` (secrets.ts).
import {
  activeSecretBindings,
  SECRET_REF_HOST_NOT_BOUND_CODE,
  SECRET_REF_HOST_NOT_BOUND_MESSAGE,
  SECRET_REF_NOT_BOUND_CODE,
  SECRET_REF_NOT_BOUND_MESSAGE,
  secretBinding,
  type SecretConsumer,
  type SecretUseHost,
} from "@mth/config";
import type { DbOrTx } from "@mth/db";
import { organizationCodeLookup } from "./organization-code.ts";
import { problems, type HttpProblem } from "./problem.ts";
import {
  SECRET_REF_NAMESPACE_CODE,
  SECRET_REF_NAMESPACE_MESSAGE,
  secretRefInNamespace,
  type SecretRef,
  type SecretUse,
} from "./secrets.ts";

/** 400 validation (`validation.secret_ref_namespace` at `pointer`) when `ref` names a secret outside its namespace. */
export function assertSecretRefInNamespace(ref: SecretRef, pointer: string): void {
  if (!secretRefInNamespace(ref))
    throw problems.validation([{ pointer, code: SECRET_REF_NAMESPACE_CODE, message: SECRET_REF_NAMESPACE_MESSAGE }]);
}

/** One refused reference of a request, for the `secret_ref.refused` audit event (names only, never a value). */
export interface RefusedSecretRef {
  readonly provider: string;
  readonly name: string;
  readonly reason: "not_bound" | "host_not_bound";
  readonly host?: SecretUseHost;
}

/** What a binding refusal attaches to its 400 problem (audited by secret-refusals.ts). */
export interface SecretRefusal {
  readonly consumer: SecretConsumer;
  readonly organizationId: string | null;
  readonly refs: readonly RefusedSecretRef[];
}

const refusals = new WeakMap<HttpProblem, SecretRefusal>();

/** The binding refusal a problem carries, if any. */
export function secretRefusalOf(problem: HttpProblem): SecretRefusal | undefined {
  return refusals.get(problem);
}

/** One reference of a request and the JSON pointer of its field. */
export interface SecretRefEntry {
  readonly ref: SecretRef;
  readonly pointer: string;
}

/**
 * The write-time check (§D): the namespace of every entry first (400 `validation.secret_ref_namespace`), then the
 * binding of every entry for `use`. All failing references give their field errors in the same 400 `validation`: a
 * `not_bound` one at its own pointer, a `host_not_bound` one at `hostPointer` (once). `use.organizationId` must be the
 * authorized organization of the setting (its stored row's, or on create the validated target). Never asks a provider.
 */
export async function assertSecretRefsBound(
  db: DbOrTx,
  entries: readonly SecretRefEntry[],
  use: SecretUse,
  hostPointer: string | null,
): Promise<void> {
  for (const { ref, pointer } of entries) assertSecretRefInNamespace(ref, pointer);
  if (entries.length === 0) return;
  let organizationCode: string | null = null;
  if (use.organizationId !== null) organizationCode = await organizationCodeLookup(db)(use.organizationId);
  const bindings = activeSecretBindings();
  const errors: { pointer: string; code: string; message: string }[] = [];
  const refused: RefusedSecretRef[] = [];
  let hostReported = false;
  for (const { ref, pointer } of entries) {
    const answer =
      use.organizationId !== null && organizationCode === null
        ? "not_bound"
        : secretBinding(bindings, ref, { consumer: use.consumer, organizationCode, host: use.host });
    if (answer === "bound") continue;
    if (answer === "host_not_bound" && use.host !== null) {
      refused.push({ provider: ref.provider, name: ref.name, reason: answer, host: use.host });
      if (!hostReported) {
        hostReported = true;
        errors.push({
          pointer: hostPointer ?? pointer,
          code: SECRET_REF_HOST_NOT_BOUND_CODE,
          message: SECRET_REF_HOST_NOT_BOUND_MESSAGE,
        });
      }
      continue;
    }
    refused.push({ provider: ref.provider, name: ref.name, reason: "not_bound" });
    errors.push({ pointer, code: SECRET_REF_NOT_BOUND_CODE, message: SECRET_REF_NOT_BOUND_MESSAGE });
  }
  if (errors.length === 0) return;
  const problem = problems.validation(errors);
  refusals.set(problem, { consumer: use.consumer, organizationId: use.organizationId, refs: refused });
  throw problem;
}
