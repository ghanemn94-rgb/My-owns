// The shape of a domain queue (P4, T-DG4-BE-A): queues/index.ts creates each with the standard bounded retry policy
// (ADR-0008 §4: 5 attempts with exponential backoff from 10 s) and the ops.failed dead-letter queue, unless the spec
// overrides the retry numbers.
export interface QueueSpec {
  readonly name: string;
  readonly retryLimit?: number;
  readonly retryDelaySeconds?: number;
  readonly retryBackoff?: boolean;
}
