// Playbook reader web seams (T-DG5-FE-G; slice I: ADR-0049 §1-§5; D-144 "slices D–K add their own clients"): the
// request paths of the 8 operations of the tag `methodology-reader` (operationId in the comment), their query keys
// under ["p5", "feg", "reader", …], and the read hooks.
//
// Typing: the reader bodies have no @mth/shared zod mirror (BE-Q/BE-Q2 kept them local to the API), so the shapes below
// are written from the OpenAPI components (MethodologyBlock, MethodologyLink, MethodologySearchHit, …), which are the
// source of truth. The verbatim English text is shown as returned; the Arabic is a provisional translation
// (`arProvisional`) and is labelled so. The reader writes nothing; Launch is slice C's `launchProcedureInstance`.
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client.ts";
import { fetchAllPages, shouldRetry } from "../../api/queries.ts";

export type PhaseCode = "diagnose" | "define" | "design" | "mobilize" | "transform" | "realize";
export const PHASE_CODES: readonly PhaseCode[] = ["diagnose", "define", "design", "mobilize", "transform", "realize"];

export interface MethodologyVersionRef {
  readonly versionId: string;
  readonly key: string;
  readonly versionNo: number;
}

export interface MethodologyBlock {
  readonly blockRef: string;
  readonly ordinal: number;
  readonly blockKind: "text" | "table";
  readonly isHeading: boolean;
  readonly sectionBlockRef: string | null;
  readonly phaseCode: PhaseCode | null;
  readonly textEn: string;
  readonly textAr: string;
  readonly arProvisional: boolean;
  readonly guidanceEn: string | null;
  readonly guidanceAr: string | null;
  readonly linkCount: number;
  readonly methodologyVersion: MethodologyVersionRef;
}

export interface MethodologyLink {
  readonly targetKind: "template" | "procedure" | "requirement";
  readonly targetKey: string;
  readonly labelEn: string;
  readonly labelAr: string;
  readonly route: string;
  readonly origin: "seed" | "version";
  readonly launchable: boolean;
}

export interface MethodologyLinkList {
  readonly blockRef: string;
  readonly methodologyVersion: MethodologyVersionRef;
  readonly items: readonly MethodologyLink[];
}

export interface TemplateSourceLink {
  readonly blockRef: string;
  readonly ordinal: number;
  readonly phaseCode: PhaseCode | null;
  readonly excerptEn: string;
  readonly excerptAr: string;
}

export interface TemplateSourceLinkList {
  readonly templateCode: string;
  readonly methodologyVersion: MethodologyVersionRef;
  readonly items: readonly TemplateSourceLink[];
}

export interface SearchHighlight {
  readonly offset: number;
  readonly length: number;
}

export interface MethodologySearchHit {
  readonly blockRef: string;
  readonly phaseCode: PhaseCode | null;
  readonly sectionBlockRef: string | null;
  readonly lang: "en" | "ar";
  readonly snippet: string;
  readonly highlights: readonly SearchHighlight[];
}

export interface MethodologySearchPage {
  readonly items: readonly MethodologySearchHit[];
  readonly nextCursor: string | null;
  readonly methodologyVersion: MethodologyVersionRef;
}

export interface SourceBlockText {
  readonly blockRef: string;
  readonly textEn: string;
  readonly textAr: string;
  readonly arProvisional: boolean;
}

export interface SourceFoundation {
  readonly code: string;
  readonly ordinal: number;
  readonly sourceEn: string;
  readonly sourceAr: string;
  readonly usedForEn: string;
  readonly usedForAr: string;
  readonly sourceRef: string;
}

export interface MethodologyProvenance {
  readonly statement: SourceBlockText;
  readonly connectionNote: SourceBlockText;
  readonly foundations: readonly SourceFoundation[];
  readonly customExtensions: readonly SourceBlockText[];
  readonly realizeNote: SourceBlockText;
  readonly note: { readonly bodyEn: string | null; readonly bodyAr: string | null } | null;
  readonly methodologyVersion: MethodologyVersionRef;
}

export type Provenance = "custom_extension" | "foundation_inspired";
export type QuestionCode = "why_change" | "what_different" | "how_execute" | "how_prove_value";
export const QUESTION_CODES: readonly QuestionCode[] = [
  "why_change",
  "what_different",
  "how_execute",
  "how_prove_value",
];

export interface MethodologyElementProfile {
  readonly elementRef: string;
  readonly kind: string;
  readonly stableKey: string;
  readonly ordinal: number;
  readonly labelEn: string;
  readonly labelAr: string;
  readonly provenance: Provenance;
  readonly provenanceSourceRef: string;
  readonly questionTag: QuestionCode | null;
  readonly sourceRefs: readonly string[];
  readonly overridden: boolean;
}

export interface MethodologyElementProfileList {
  readonly methodologyVersion: MethodologyVersionRef;
  readonly items: readonly MethodologyElementProfile[];
}

export interface GuidingQuestion {
  readonly code: QuestionCode;
  readonly ordinal: number;
  readonly textEn: string;
  readonly textAr: string;
  readonly sourceRef: string;
}

const v1 = "/api/v1/methodology";
const enc = encodeURIComponent;

export const readerPaths = {
  blocks: `${v1}/blocks`, // listMethodologyBlocks
  block: (ref: string) => `${v1}/blocks/${enc(ref)}`, // getMethodologyBlock
  blockLinks: (ref: string) => `${v1}/blocks/${enc(ref)}/links`, // listMethodologyBlockLinks
  templateSourceLinks: (code: string) => `${v1}/templates/${enc(code)}/source-links`, // listTemplateSourceLinks
  search: `${v1}/search`, // searchMethodology
  provenance: `${v1}/provenance`, // getMethodologyProvenance
  elements: `${v1}/elements`, // listMethodologyElements
  guidingQuestions: `${v1}/guiding-questions`, // listGuidingQuestions
};

export type ReaderQuery = Record<string, string>;

/** Drops empty values, so an unset filter is never sent as an empty parameter. */
export function compact(query: Record<string, string | null | undefined>): ReaderQuery {
  const out: ReaderQuery = {};
  for (const [k, v] of Object.entries(query)) if (v) out[k] = v;
  return out;
}

export const readerKeys = {
  all: ["p5", "feg", "reader"] as const,
  blocks: (q: ReaderQuery) => ["p5", "feg", "reader", "blocks", q] as const,
  block: (ref: string, q: ReaderQuery) => ["p5", "feg", "reader", "block", ref, q] as const,
  blockLinks: (ref: string, q: ReaderQuery) => ["p5", "feg", "reader", "block-links", ref, q] as const,
  templateSourceLinks: (code: string, q: ReaderQuery) => ["p5", "feg", "reader", "template-links", code, q] as const,
  search: (q: ReaderQuery) => ["p5", "feg", "reader", "search", q] as const,
  provenance: (q: ReaderQuery) => ["p5", "feg", "reader", "provenance", q] as const,
  elements: (q: ReaderQuery) => ["p5", "feg", "reader", "elements", q] as const,
  guidingQuestions: ["p5", "feg", "reader", "guiding-questions"] as const,
};

/** Every block of the resolved version (165 at most), optionally one phase; read page by page. */
export function useMethodologyBlocks(query: ReaderQuery) {
  return useQuery({
    queryKey: readerKeys.blocks(query),
    queryFn: () => fetchAllPages<MethodologyBlock>(readerPaths.blocks, query),
    retry: shouldRetry,
    staleTime: 300_000,
  });
}

export function useMethodologyBlock(ref: string | undefined, query: ReaderQuery = {}) {
  return useQuery({
    queryKey: readerKeys.block(ref ?? "", query),
    queryFn: () => api.get<MethodologyBlock>(readerPaths.block(ref!), query),
    enabled: Boolean(ref),
    retry: shouldRetry,
  });
}

export function useMethodologyBlockLinks(ref: string | undefined, query: ReaderQuery = {}) {
  return useQuery({
    queryKey: readerKeys.blockLinks(ref ?? "", query),
    queryFn: () => api.get<MethodologyLinkList>(readerPaths.blockLinks(ref!), query),
    enabled: Boolean(ref),
    retry: shouldRetry,
  });
}

export function useTemplateSourceLinks(code: string | undefined, query: ReaderQuery = {}) {
  return useQuery({
    queryKey: readerKeys.templateSourceLinks(code ?? "", query),
    queryFn: () => api.get<TemplateSourceLinkList>(readerPaths.templateSourceLinks(code!), query),
    enabled: Boolean(code),
    retry: shouldRetry,
    staleTime: 300_000,
  });
}

/** One page of search hits; `query.q` must hold 2–200 characters (else the server answers 400 validation.search_query). */
export function useMethodologySearch(query: ReaderQuery | null) {
  return useQuery({
    queryKey: readerKeys.search(query ?? {}),
    queryFn: () => api.get<MethodologySearchPage>(readerPaths.search, query!),
    enabled: query !== null,
    retry: shouldRetry,
  });
}

export function useMethodologyProvenance(query: ReaderQuery = {}) {
  return useQuery({
    queryKey: readerKeys.provenance(query),
    queryFn: () => api.get<MethodologyProvenance>(readerPaths.provenance, query),
    retry: shouldRetry,
    staleTime: 300_000,
  });
}

export function useMethodologyElements(query: ReaderQuery = {}, enabled = true) {
  return useQuery({
    queryKey: readerKeys.elements(query),
    queryFn: () => api.get<MethodologyElementProfileList>(readerPaths.elements, query),
    enabled,
    retry: shouldRetry,
    staleTime: 300_000,
  });
}

export function useGuidingQuestions() {
  return useQuery({
    queryKey: readerKeys.guidingQuestions,
    queryFn: () => api.get<{ items: GuidingQuestion[] }>(readerPaths.guidingQuestions),
    retry: shouldRetry,
    staleTime: 300_000,
  });
}

/**
 * Splits a plain-text snippet into text and highlighted parts by the server's UTF-16 offsets (no HTML is ever
 * received or produced). Overlapping or out-of-range highlights are clipped, never thrown.
 */
export function highlightParts(
  snippet: string,
  highlights: readonly SearchHighlight[],
): { text: string; mark: boolean }[] {
  const parts: { text: string; mark: boolean }[] = [];
  let at = 0;
  for (const h of [...highlights].sort((a, b) => a.offset - b.offset)) {
    const start = Math.max(h.offset, at);
    const end = Math.min(h.offset + h.length, snippet.length);
    if (end <= start) continue;
    if (start > at) parts.push({ text: snippet.slice(at, start), mark: false });
    parts.push({ text: snippet.slice(start, end), mark: true });
    at = end;
  }
  if (at < snippet.length) parts.push({ text: snippet.slice(at), mark: false });
  return parts;
}
