import { detectDangerousSignature } from '@hub/domain';

export interface ScanResult {
  /** `clean` is reserved for a configured enterprise scanner; the built-in check never returns it. */
  status: 'clean' | 'quarantined' | 'not_scanned';
  detail: string;
  engine: string;
}

/** Malware scanner adapter (ADR-0010). An enterprise scanner (ClamAV / Mobily's engine) plugs in here in P6/P7. */
export interface MalwareScanner {
  readonly engine: string;
  /** True only for a real anti-malware engine that has been configured and verified. */
  readonly enterprise: boolean;
  scan(bytes: Buffer): Promise<ScanResult>;
}

export const MALWARE_SCANNER = Symbol('MALWARE_SCANNER');

/**
 * Built-in MINIMAL signature check — NOT an anti-malware engine. Quarantines the EICAR test signature and
 * executable/script signatures; everything else is `not_scanned` (never "clean") because no enterprise scanner is
 * configured in this environment.
 */
export class BuiltInSignatureScanner implements MalwareScanner {
  readonly engine = 'builtin-signature-check';
  readonly enterprise = false;

  async scan(bytes: Buffer): Promise<ScanResult> {
    const hit = detectDangerousSignature(bytes);
    if (hit) return { status: 'quarantined', detail: `${hit.kind}: ${hit.detail}`, engine: this.engine };
    return {
      status: 'not_scanned',
      detail: 'No enterprise malware scanner configured. Built-in signature check (EICAR, executable, script) found nothing — the file is NOT certified clean.',
      engine: this.engine,
    };
  }
}
