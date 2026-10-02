// People on a transformation: owner pickers and names (REQ-PB-012, REQ-S10-008). Candidates are the transformation
// team (GET /transformations/{id}/scoped-assignments) plus the signed-in user. Display names come from GET /users/{id}
// where the caller may read users; otherwise a person is shown by their team role, never as a blank or a raw id alone.
import { useQueries } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/client.ts";
import { keys, shouldRetry, useTeam } from "../api/queries.ts";
import type { User } from "../api/types.ts";
import { useMe } from "../auth/session.tsx";
import { Unknown } from "./Badges.tsx";

export interface Person {
  readonly id: string;
  readonly label: string;
}

/** Short, non-identifying suffix so two team members with the same role stay distinguishable. */
const shortId = (id: string) => id.slice(-4);

/** Team members (and me) with readable labels, for <select> options and name lookups. */
export function usePeople(tid: string): {
  people: readonly Person[];
  byId: ReadonlyMap<string, Person>;
  /** The person's display name where readable (session or GET /users/{id}); otherwise null. */
  nameOf: (id: string) => string | null;
  loading: boolean;
} {
  const { t } = useTranslation();
  const me = useMe();
  const team = useTeam(tid);
  const ids = [...new Set([me.user.id, ...(team.data ?? []).map((a) => a.assignment.userId)])];
  const users = useQueries({
    queries: ids
      .filter((id) => id !== me.user.id)
      .map((id) => ({
        queryKey: keys.user(id),
        queryFn: () => api.get<User>(`/api/v1/users/${id}`),
        retry: shouldRetry,
        staleTime: 60_000,
      })),
  });
  const names = new Map<string, string>([[me.user.id, me.user.displayName]]);
  for (const q of users) if (q.data) names.set(q.data.id, q.data.displayName);
  const roles = new Map<string, string[]>();
  for (const a of team.data ?? []) {
    const list = roles.get(a.assignment.userId) ?? [];
    if (!list.includes(a.assignment.roleCode)) list.push(a.assignment.roleCode);
    roles.set(a.assignment.userId, list);
  }
  const people = ids.map((id): Person => {
    const roleText = (roles.get(id) ?? [])
      .map((r) => t(`transformations.audit.role.${r}`, { defaultValue: r }))
      .join(", ");
    const name = names.get(id);
    const label = name
      ? roleText
        ? `${name} (${roleText})`
        : name
      : t("common.people.teamMember", { roles: roleText || t("common.value.unknown"), ref: shortId(id) });
    return { id, label: id === me.user.id ? `${label} · ${t("common.people.me")}` : label };
  });
  return {
    people,
    byId: new Map(people.map((p) => [p.id, p])),
    nameOf: (id) => names.get(id) ?? null,
    loading: team.isPending,
  };
}

/** A person's name from the team lookup; Not assigned for null; Unknown for someone outside the visible team. */
export function PersonName({ id, people }: { id: string | null | undefined; people: ReadonlyMap<string, Person> }) {
  const { t } = useTranslation();
  if (!id) return <span className="muted">{t("common.value.notAssigned")}</span>;
  const p = people.get(id);
  if (p) return <span>{p.label}</span>;
  return <Unknown hint={t("common.value.notVisible")} />;
}
