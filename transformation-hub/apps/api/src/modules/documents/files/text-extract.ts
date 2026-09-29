import { AllowedFileType, TEXT_EXTRACTABLE_TYPES } from '@hub/domain';
import { readZipEntry } from './zip';

export type Extraction =
  | { status: 'performed'; text: string; chunkKind: 'txt' | 'md' | 'csv'; note: string }
  | { status: 'not_performed' | 'failed'; note: string };

/**
 * Text extraction for the retrieval index. Untrusted input: runs with size limits, no network, no macro/formula
 * evaluation, no XML DTD/entity processing (only the five predefined entities and numeric references are decoded).
 * PDF, images, XLSX and PPTX are NOT extracted in this build — reported honestly as `not_performed` (no OCR; unclear
 * OCR must never populate official fields — spec §17).
 */
export function extractText(type: AllowedFileType | null, bytes: Buffer): Extraction {
  if (!type || !TEXT_EXTRACTABLE_TYPES.includes(type)) {
    return { status: 'not_performed', note: `Text extraction is not available for ${type ?? 'this file'} in this build (no PDF/Office/OCR extractor configured)` };
  }
  try {
    if (type === 'txt' || type === 'md' || type === 'csv') {
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
      return { status: 'performed', text, chunkKind: type, note: `UTF-8 ${type}` };
    }
    // docx: paragraphs from word/document.xml; Heading/Title styles become markdown headings (chunk sections).
    const xml = readZipEntry(bytes, 'word/document.xml').toString('utf8');
    if (/<!DOCTYPE/i.test(xml)) return { status: 'failed', note: 'DOCX contains a DTD — refused' };
    const paras = xml.split(/<\/w:p>/).map((p) => {
      const style = /<w:pStyle\s+w:val="([^"]+)"/.exec(p)?.[1] ?? '';
      let raw = '';
      for (const m of p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>/g)) {
        raw += m[1] !== undefined ? m[1] : m[0].startsWith('<w:tab') ? '\t' : '\n';
      }
      const text = decodeXml(raw).trim();
      const level = /^(Heading(\d)|Title)$/i.exec(style);
      return text && level ? `${'#'.repeat(Math.min(6, Number(level[2] ?? 1)))} ${text}` : text;
    });
    const text = paras.filter((p) => p.length > 0).join('\n\n');
    return { status: 'performed', text, chunkKind: 'md', note: 'DOCX paragraphs (built-in bounded extractor)' };
  } catch (e) {
    return { status: 'failed', note: `Extraction failed: ${(e as Error).message}`.slice(0, 300) };
  }
}

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d{1,7});/g, (_, d: string) => safeCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function safeCodePoint(n: number): string {
  return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
}
