'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationsRoutes, type RouteQuery, type RouteResponse } from '@hub/contracts';
import { useI18n, type MessageKey, type StatusEnum } from '@/i18n/provider';
import { api } from './api';

/**
 * In-app notifications (REQ-PLT-008, REQ-INT-012). The API lists only the reader's own notifications whose source they can
 * still see (re-checked at read time); module notifications carry a code + parameters translated here, AI messages carry
 * their own (platform-marked) text.
 */
type R = typeof notificationsRoutes;
export type NotificationItem = RouteResponse<R['listMyNotifications']>['items'][number];
export type NotificationChannel = RouteResponse<R['myChannels']>['items'][number];

export const nk = {
  root: ['notifications'] as const,
  list: (q: object) => ['notifications', 'list', q] as const,
  unread: ['notifications', 'unread'] as const,
  channels: ['notifications', 'channels'] as const,
};

export function useNotifications(query: RouteQuery<R['listMyNotifications']>) {
  return useQuery({ queryKey: nk.list(query), queryFn: ({ signal }) => api(notificationsRoutes.listMyNotifications, { query, signal }), placeholderData: (prev) => prev });
}

/** Unread count for the bell (refreshed every minute and when the window regains focus). */
export function useUnreadCount() {
  return useQuery({ queryKey: nk.unread, queryFn: ({ signal }) => api(notificationsRoutes.unreadCount, { signal }), refetchInterval: 60_000, refetchOnWindowFocus: true });
}

export function useChannels() {
  return useQuery({ queryKey: nk.channels, queryFn: ({ signal }) => api(notificationsRoutes.myChannels, { signal }), staleTime: 300_000 });
}

export function useNotificationsRefresh() {
  const qc = useQueryClient();
  return useCallback(async () => {
    await qc.invalidateQueries({ queryKey: nk.root });
  }, [qc]);
}

/** Parameters that are enum values of a known vocabulary (translated), by message code. */
const ENUM_PARAM: Record<string, Partial<Record<string, StatusEnum>>> = {
  'notifications.change_request.decided': { status: 'changeRequestStatuses' },
  'notifications.decision.outcome': { status: 'decisionStatuses' },
};

/** The notification's text in the UI language (module notifications) or its stored text (AI messages). */
export function useNotificationText() {
  const { t, tStatus } = useI18n();
  return useCallback(
    (n: NotificationItem) => {
      if (!n.messageCode) return n.title;
      const p: Record<string, string | number> = { ...(n.messageParams ?? {}) };
      for (const [k, vocab] of Object.entries(ENUM_PARAM[n.messageCode] ?? {})) if (typeof p[k] === 'string' && vocab) p[k] = tStatus(vocab, p[k] as string);
      if (typeof p.outcome === 'string') p.outcome = t(`notifications.outcomes.${p.outcome}` as MessageKey);
      if (typeof p.problem === 'string') p.problem = t(`notifications.problems.${p.problem}` as MessageKey);
      if (typeof p.adapter === 'string') p.adapter = t(`integrations.adapters.${p.adapter}.name` as MessageKey);
      return t(`notifications.messages.${n.messageCode}` as MessageKey, p);
    },
    [t, tStatus],
  );
}
