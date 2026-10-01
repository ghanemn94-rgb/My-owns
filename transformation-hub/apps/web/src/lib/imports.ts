'use client';

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { buildPath, importsRoutes, type RouteQuery, type RouteResponse, type ServerMessageDto } from '@hub/contracts';
import { useI18n, type MessageKey } from '@/i18n/provider';
import { ApiError, CSRF_COOKIE, CSRF_HEADER, api, readCookie } from './api';
import { useProjectContext } from './project-context';

/**
 * Import wizard (spec §17; REQ-INT-001..005, REQ-INT-015, REQ-SRC-009) — types, query keys, hooks, the raw upload and the
 * translation of the server's row / file messages (codes + parameters → `imports.messages.<code>`). The API re-checks
 * everything; the screen only offers what the batch detail says the caller may do.
 */
type R = typeof importsRoutes;
export type ImportPolicy = RouteResponse<R['importPolicy']>;
export type ImportSummary = RouteResponse<R['listImports']>['items'][number];
export type ImportDetail = RouteResponse<R['getImport']>;
export type ImportRow = RouteResponse<R['listImportRows']>['items'][number];
export type ImportTarget = ImportSummary['target'];

export const ik = {
  root: (pid: string) => ['imports', pid] as const,
  policy: (pid: string) => ['imports', pid, 'policy'] as const,
  list: (pid: string, q: object) => ['imports', pid, 'list', q] as const,
  batch: (pid: string, id: string) => ['imports', pid, 'batch', id] as const,
  rows: (pid: string, id: string, q: object) => ['imports', pid, 'rows', id, q] as const,
};

export const importsHref = (projectId: string, batchId?: string) => `/projects/${projectId}/reports/imports${batchId ? `/${batchId}` : ''}`;

export function useImportsRefresh() {
  const qc = useQueryClient();
  const { projectId } = useProjectContext();
  return useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ik.root(projectId) });
  }, [qc, projectId]);
}

export function useImportPolicy() {
  const { projectId, can } = useProjectContext();
  return useQuery({ queryKey: ik.policy(projectId), queryFn: ({ signal }) => api(importsRoutes.importPolicy, { params: { projectId }, signal }), enabled: can('imports.batch.read'), staleTime: 300_000 });
}

export function useImports(query: RouteQuery<R['listImports']>) {
  const { projectId, can } = useProjectContext();
  return useQuery({
    queryKey: ik.list(projectId, query),
    queryFn: ({ signal }) => api(importsRoutes.listImports, { params: { projectId }, query, signal }),
    enabled: can('imports.batch.read'),
    placeholderData: (prev) => prev,
    // A batch being parsed by the worker moves on by itself.
    refetchInterval: (q) => (q.state.data?.items.some((b) => b.status === 'uploaded') ? 2000 : false),
  });
}

export function useImport(batchId: string) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: ik.batch(projectId, batchId),
    queryFn: ({ signal }) => api(importsRoutes.getImport, { params: { projectId, batchId }, signal }),
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === 'uploaded' ? 1500 : false),
  });
}

export function useImportRows(batchId: string, query: RouteQuery<R['listImportRows']>, enabled: boolean) {
  const { projectId } = useProjectContext();
  return useQuery({
    queryKey: ik.rows(projectId, batchId, query),
    queryFn: ({ signal }) => api(importsRoutes.listImportRows, { params: { projectId, batchId }, query, signal }),
    enabled,
    placeholderData: (prev) => prev,
  });
}

/** Raw upload (application/octet-stream) with the target, classification and an optional superseded source. */
export function uploadImport(
  projectId: string,
  file: File,
  query: { target: ImportTarget; classification: string; supersedesSourceId?: string },
  opts: { onProgress?: (fraction: number) => void } = {},
): Promise<ImportSummary> {
  const qs = new URLSearchParams({ target: query.target, classification: query.classification, ...(query.supersedesSourceId ? { supersedesSourceId: query.supersedesSourceId } : {}) });
  const url = `${buildPath(importsRoutes.uploadImport.path, { projectId })}?${qs.toString()}`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('accept', 'application/json');
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) xhr.setRequestHeader(CSRF_HEADER, csrf);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiError({ status: 0, code: 'network.unreachable' }));
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(xhr.responseText || '{}') as Record<string, unknown>;
      } catch {
        /* non-JSON error body */
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body as unknown as ImportSummary);
      const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
      reject(
        new ApiError({
          status: xhr.status,
          code: str(body.code) ?? (xhr.status === 413 ? 'imports.upload.too_large' : `http.${xhr.status}`),
          detail: str(body.detail),
          title: str(body.title),
          correlationId: str(body.correlationId) ?? xhr.getResponseHeader('x-correlation-id') ?? undefined,
        }),
      );
    };
    xhr.send(file);
  });
}

/** Translates import row / file messages; parameters that are field names, record types or reasons are translated too. */
export function useImportMessages() {
  const { t, formatList } = useI18n();
  const field = useCallback((f: string) => t(`imports.fields.${f}` as MessageKey), [t]);
  return useCallback(
    (m: ServerMessageDto) => {
      const p: Record<string, string | number> = { ...m.params };
      if (typeof p.field === 'string') p.field = field(p.field);
      if (typeof p.fields === 'string') p.fields = formatList(p.fields.split(', ').map(field));
      if (typeof p.key === 'string') p.key = t(`imports.keys.${p.key}` as MessageKey);
      if (typeof p.reason === 'string') p.reason = t(`imports.governed.${p.reason}` as MessageKey);
      if (typeof p.type === 'string') p.type = t(`imports.recordTypes.${p.type}` as MessageKey);
      // `value`, `code`, `host`, `function` are data from the file or record codes: shown as they are.
      return t(`imports.messages.${m.code}` as MessageKey, p);
    },
    [t, field, formatList],
  );
}

/** Wizard step of a batch (for the stepper). */
export function importStep(status: ImportSummary['status']): number {
  switch (status) {
    case 'uploaded':
      return 1;
    case 'parsed':
      return 2;
    case 'validated':
      return 3;
    case 'submitted':
      return 4;
    default:
      return 5;
  }
}
