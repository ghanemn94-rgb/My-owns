import { Injectable } from '@nestjs/common';
import type { ClaimedJob } from './job-queue.service';

export type JobHandler = (job: ClaimedJob) => Promise<Record<string, unknown> | void>;

/** Modules register job handlers and outbox subscribers here (worker process). */
@Injectable()
export class JobRegistry {
  private readonly handlers = new Map<string, JobHandler>();
  /** outbox event type → job kinds to enqueue */
  private readonly subscriptions = new Map<string, string[]>();

  register(kind: string, handler: JobHandler) {
    if (this.handlers.has(kind)) throw new Error(`Duplicate job handler ${kind}`);
    this.handlers.set(kind, handler);
  }

  subscribe(eventType: string, jobKind: string) {
    const list = this.subscriptions.get(eventType) ?? [];
    if (!list.includes(jobKind)) list.push(jobKind);
    this.subscriptions.set(eventType, list);
  }

  handler(kind: string): JobHandler | undefined {
    return this.handlers.get(kind);
  }

  subscribersOf(eventType: string): string[] {
    return this.subscriptions.get(eventType) ?? [];
  }

  kinds(): string[] {
    return [...this.handlers.keys()];
  }
}
