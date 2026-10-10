import { Injectable } from '@nestjs/common';
import { ActionsService } from '../actions/actions.service';
import { AuditService } from '../audit/audit.service';
import { EngineClient } from '../engine/engine.client';
import { EvidenceService } from '../evidence/evidence.service';

@Injectable()
export class IngestService {
  constructor(private readonly engine: EngineClient, private readonly actions: ActionsService,
              private readonly evidence: EvidenceService, private readonly audit: AuditService) {}

  /** Turns an engine portfolio into approval-gated actions; open duplicates are skipped. */
  async toActions(portfolio: any, actor: string, evidenceKey: string, event: string) {
    const created: string[] = []; let skipped = 0;
    for (const p of portfolio.proposals.filter((p: any) => p.requires_approval)) {
      const rec = await this.actions.create(p, actor, evidenceKey);
      rec ? created.push(rec.id) : skipped++;
    }
    await this.audit.record(actor, event, evidenceKey.slice(0, 8), { created: created.length, skipped });
    return { created, skipped, totalMonthlySavings: portfolio.total_monthly_savings, criticalCount: portfolio.critical_count, proposals: portfolio.proposals };
  }

  /** Raw secrets scanned by the engine (text_scans) are never persisted as evidence. */
  async ingest(body: Record<string, any>, actor: string) {
    const { text_scans, ...safe } = body;
    const key = await this.evidence.put(JSON.stringify({ ...safe, scanned_sources: Object.keys(text_scans ?? {}) }));
    return this.toActions(await this.engine.ingest(body), actor, key, 'ingest');
  }

  async collectAws(opts: { days?: number; include_iam?: boolean }, actor: string) {
    const portfolio = await this.engine.collectAws(opts);
    const key = await this.evidence.put(JSON.stringify({ source: 'aws', opts, portfolio }));
    return this.toActions(portfolio, actor, key, 'collect.aws');
  }
}
