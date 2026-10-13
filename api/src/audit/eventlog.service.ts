import { BadRequestException, Injectable } from '@nestjs/common';
import { EngineClient } from '../engine/engine.client';
import { AuditEntry, AuditService } from './audit.service';

export const SUMMARY_MAX_EVENTS = 5000; // engine accepts at most this many events per request

@Injectable()
export class EventLogService {
  constructor(private readonly audit: AuditService, private readonly engine: EngineClient) {}

  /** NDJSON, oldest first, one entry per line with its hashes: verifiable offline with scripts/verify-audit-export.js. */
  async exportNdjson(): Promise<string> {
    return (await this.audit.list()).map((e) => JSON.stringify(e)).join('\n') + '\n';
  }

  private inRange(e: AuditEntry, from?: Date, to?: Date) {
    const t = +new Date(e.at);
    return (!from || t >= +from) && (!to || t <= +to);
  }

  /** Summary of the real audit trail (most recent SUMMARY_MAX_EVENTS events of the period). */
  async summarize(opts: { from?: string; to?: string; explain?: boolean }) {
    const from = opts.from ? new Date(opts.from) : undefined, to = opts.to ? new Date(opts.to) : undefined;
    if ((from && isNaN(+from)) || (to && isNaN(+to))) throw new BadRequestException('invalid date');
    const all = (await this.audit.list()).filter((e) => this.inRange(e, from, to));
    const events = all.slice(-SUMMARY_MAX_EVENTS);
    const summary = await this.engine.summarizeEvents(events, !!opts.explain);
    return { source: 'audit_log', eventsAnalyzed: events.length, truncated: all.length > events.length, summary };
  }

  /** Same analysis over generated synthetic events. Nothing is written to the audit trail. */
  async summarizeSynthetic(opts: { scenario?: string; seed?: number; days?: number; explain?: boolean }) {
    const scenario = opts.scenario === 'incident' ? 'incident' : 'normal';
    const seed = Number.isFinite(opts.seed) ? Math.floor(opts.seed!) : 7;
    const days = Math.min(Math.max(Number.isFinite(opts.days) ? Math.floor(opts.days!) : 14, 1), 60);
    const events = await this.engine.syntheticEvents({ seed, days, scenario });
    const summary = await this.engine.summarizeEvents(events.slice(-SUMMARY_MAX_EVENTS), !!opts.explain);
    return { source: 'synthetic', scenario, seed, days, eventsAnalyzed: events.length, truncated: false, summary };
  }
}
