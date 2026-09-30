// Response types of the P1 contract (docs/api/openapi.yaml), taken from the shared zod mirrors so the web and the
// API agree on one definition (ADR-0007).
import type { z } from "zod";
import type {
  AuditEvent,
  BusinessUnit,
  Me,
  Organization,
  Role,
  RoleAssignment,
  Transformation,
  User,
  permissionEntry,
} from "@mth/shared/schemas";

export type { AuditEvent, BusinessUnit, Me, Organization, Role, RoleAssignment, Transformation, User };
export type PermissionEntry = z.infer<typeof permissionEntry>;

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export type TransformationSort =
  | "updatedAt:desc"
  | "updatedAt:asc"
  | "name:asc"
  | "name:desc"
  | "code:asc"
  | "code:desc";
