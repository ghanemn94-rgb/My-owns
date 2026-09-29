import { Injectable } from '@nestjs/common';
import { localDate } from '@hub/domain';

/** Injectable clock so tests can pin "now" deterministically. */
@Injectable()
export class Clock {
  private fixed: Date | null = null;

  now(): Date {
    return this.fixed ? new Date(this.fixed) : new Date();
  }

  /** Local business date in a timezone (default Asia/Riyadh). */
  today(timezone = 'Asia/Riyadh'): string {
    return localDate(this.now(), timezone);
  }

  /** Test helper. */
  setFixed(d: Date | null) {
    this.fixed = d;
  }
}
