// zod mirrors of the P6 slice E deep-link components (docs/api/openapi.yaml 1.5.0-p6; ADR-0051 §3; REQ-S12-024;
// T-DG6-BE-C). The token is an opaque identifier, never a credential: every resolution re-authorizes the signed-in caller
// against the target. No free-text field.
import { z } from "zod";
import { uuid } from "./common.ts";

/** The DeepLinkToken path parameter: 43 base64url characters (32 random bytes; the 0098 format CHECK). */
export const deepLinkToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "validation.pattern");

/** DeepLinkResolution (200 of resolveDeepLink): where the web route `/l/{token}` navigates. */
export const deepLinkResolution = z.strictObject({
  linkPath: z
    .string()
    .max(500)
    .regex(/^\/[^/\\]/, "validation.link_path"),
  recordType: z.string().nullable(),
  recordId: uuid.nullable(),
});
export type DeepLinkResolution = z.infer<typeof deepLinkResolution>;
