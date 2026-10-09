// zod mirrors of the P4 tasks-tag schemas: My Work items and the in-app inbox (docs/api/openapi.yaml; ADR-0025 §4;
// T-DG4-BE-A). Items carry an i18n message key and parameters, never a sentence (S-6).
import { z } from "zod";
import { timestamp, uuid, version } from "./common.ts";
import { businessDate } from "./kpi.ts";

export const relativeLinkPath = z.string().regex(/^\/[^/\\]/, "validation.link_path");
export const messageParams = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));
export const workItemStatus = z.enum(["open", "done", "cancelled"]);

export const workItem = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid.nullable(),
  kind: z.string(),
  assigneeUserId: uuid,
  subjectType: z.string(),
  subjectId: uuid,
  linkPath: relativeLinkPath,
  messageKey: z.string(),
  messageParams,
  dueDate: businessDate.nullable(),
  periodLabel: z.string().nullable(),
  status: workItemStatus,
  completedAt: timestamp.nullable(),
  completedBy: uuid.nullable(),
  createdAt: timestamp,
  version,
});
export type WorkItem = z.infer<typeof workItem>;
export const workItemPage = z.strictObject({ items: z.array(workItem), nextCursor: z.string().nullable() });

export const inboxNotification = z.strictObject({
  id: uuid,
  transformationId: uuid.nullable(),
  workItemId: uuid.nullable(),
  linkPath: relativeLinkPath,
  messageKey: z.string(),
  messageParams,
  readAt: timestamp.nullable(),
  createdAt: timestamp,
  version,
});
export type InboxNotification = z.infer<typeof inboxNotification>;
export const inboxPage = z.strictObject({
  items: z.array(inboxNotification),
  nextCursor: z.string().nullable(),
  unreadCount: z.number().int().min(0),
});
