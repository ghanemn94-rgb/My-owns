'use client';

/**
 * Document & Evidence Center client helpers: query keys, the upload-policy query, an upload with progress
 * (XMLHttpRequest — fetch cannot report upload progress), download links and small formatters.
 * The API stays the authority for every check (type, size, scan, ACL); client checks only give early feedback.
 */
import { useQuery } from '@tanstack/react-query';
import { buildPath, documentsRoutes, type RouteResponse } from '@hub/contracts';
import type { Classification } from '@hub/domain';
import { CLASSIFICATIONS, clearanceAllows } from '@hub/domain';
import { ApiError, api, CSRF_COOKIE, CSRF_HEADER, readCookie } from './api';

export type DocumentSummary = RouteResponse<typeof documentsRoutes.listDocuments>['items'][number];
export type DocumentDetail = RouteResponse<typeof documentsRoutes.getDocument>;
export type DocumentVersion = DocumentDetail['versions'][number];
export type SearchHit = RouteResponse<typeof documentsRoutes.searchDocuments>['items'][number];
export type UploadPolicy = RouteResponse<typeof documentsRoutes.uploadPolicy>;
export type UploadResult = RouteResponse<typeof documentsRoutes.uploadVersion>;
export type EvidenceLink = RouteResponse<typeof documentsRoutes.listEvidence>['items'][number];
export type Source = RouteResponse<typeof documentsRoutes.listSources>['items'][number];
export type SourceDetail = RouteResponse<typeof documentsRoutes.getSource>;
export type Claim = SourceDetail['claims'][number];
export type CompareRow = RouteResponse<typeof documentsRoutes.compareSource>['rows'][number];

export const dqk = {
  all: (projectId: string) => ['project', projectId, 'documents'] as const,
  list: (projectId: string, q: object) => ['project', projectId, 'documents', 'list', q] as const,
  search: (projectId: string, q: object) => ['project', projectId, 'documents', 'search', q] as const,
  detail: (projectId: string, documentId: string) => ['project', projectId, 'documents', 'detail', documentId] as const,
  policy: (projectId: string) => ['project', projectId, 'documents', 'policy'] as const,
  evidence: (projectId: string, targetType: string, targetId: string) => ['project', projectId, 'evidence', targetType, targetId] as const,
  evidenceAll: (projectId: string) => ['project', projectId, 'evidence'] as const,
  sources: (projectId: string, q: object) => ['project', projectId, 'sources', q] as const,
  sourcesAll: (projectId: string) => ['project', projectId, 'sources'] as const,
  source: (projectId: string, sourceId: string) => ['project', projectId, 'sources', 'detail', sourceId] as const,
  compare: (projectId: string, sourceId: string) => ['project', projectId, 'sources', 'compare', sourceId] as const,
};

export function useUploadPolicy(projectId: string, enabled = true) {
  return useQuery({
    queryKey: dqk.policy(projectId),
    queryFn: ({ signal }) => api(documentsRoutes.uploadPolicy, { params: { projectId }, signal }),
    staleTime: 5 * 60_000,
    enabled,
  });
}

/** Classifications the user may assign (never above their own clearance — the API enforces it too). */
export function assignableClassifications(clearance: Classification): Classification[] {
  return CLASSIFICATIONS.filter((c) => clearanceAllows(clearance, c));
}

export function downloadHref(projectId: string, documentId: string, versionId: string): string {
  return buildPath(documentsRoutes.downloadVersion.path, { projectId, documentId, versionId });
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export type PreCheck = { ok: true } | { ok: false; reason: 'too_large' | 'empty' | 'type'; limit?: number };

/** Early feedback only: size against the server's configured limit and the extension against the allowlist. */
export function preCheckFile(file: File, policy: UploadPolicy | undefined): PreCheck {
  if (file.size === 0) return { ok: false, reason: 'empty' };
  if (policy && file.size > policy.maxUploadBytes) return { ok: false, reason: 'too_large', limit: policy.maxUploadBytes };
  if (policy && !policy.acceptedTypes.some((t) => t.extensions.includes(fileExtension(file.name)))) return { ok: false, reason: 'type' };
  return { ok: true };
}

export function acceptAttribute(policy: UploadPolicy | undefined): string | undefined {
  return policy ? policy.acceptedTypes.flatMap((t) => t.extensions.map((e) => `.${e}`)).join(',') : undefined;
}

/**
 * Upload one version: raw bytes as application/octet-stream, file name percent-encoded in `x-filename`,
 * browser-declared type in `x-file-type` (untrusted; the server detects the type from the bytes).
 */
export function uploadVersion(
  projectId: string,
  documentId: string,
  file: File,
  opts: { note?: string; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<UploadResult> {
  const url = buildPath(documentsRoutes.uploadVersion.path, { projectId, documentId }) + (opts.note ? `?note=${encodeURIComponent(opts.note)}` : '');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('accept', 'application/json');
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.setRequestHeader('x-filename', encodeURIComponent(file.name));
    if (file.type) xhr.setRequestHeader('x-file-type', file.type);
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) xhr.setRequestHeader(CSRF_HEADER, csrf);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onerror = () => reject(new ApiError({ status: 0, code: 'network.unreachable' }));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    xhr.onload = () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(xhr.responseText || '{}') as Record<string, unknown>;
      } catch {
        /* non-JSON error body (e.g. a proxy page) */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as unknown as UploadResult);
        return;
      }
      const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
      reject(
        new ApiError({
          status: xhr.status,
          code: str(body.code) ?? (xhr.status === 413 ? 'request.too_large' : `http.${xhr.status}`),
          detail: str(body.detail),
          title: str(body.title),
          correlationId: str(body.correlationId) ?? xhr.getResponseHeader('x-correlation-id') ?? undefined,
        }),
      );
    };
    opts.signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

/** 12.3 MB style sizes with the active locale's digits. */
export function formatBytes(n: number | null | undefined, locale: string): string {
  if (n === null || n === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: i === 0 ? 0 : 1 }).format(v)} ${units[i]}`;
}

/** Short, non-identifying label for a partner/clean-team room id (room names are managed by the JV screens). */
export function shortRoom(roomId: string): string {
  return `…${roomId.slice(-6)}`;
}

/** Record types the evidence target picker can browse in this build (others embed <EvidencePanel> on their own screen). */
export const PICKABLE_TARGET_TYPES = ['task', 'milestone', 'deliverable', 'gate_criterion'] as const;
export type PickableTargetType = (typeof PICKABLE_TARGET_TYPES)[number];
