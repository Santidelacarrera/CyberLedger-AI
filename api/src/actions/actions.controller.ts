import { BadRequestException, Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { createHash } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { Public, Roles } from '../auth/auth';
import { EngineClient } from '../engine/engine.client';
import { EvidenceService } from '../evidence/evidence.service';
import { PolicyBody, PolicyService } from '../policy/policy.service';
import { ActionsService } from './actions.service';

@Controller()
export class ActionsController {
  constructor(
    private readonly svc: ActionsService, private readonly audit: AuditService, private readonly policy: PolicyService,
    private readonly engine: EngineClient, private readonly evidence: EvidenceService,
  ) {}

  @Public() @Get('health') health() { return { status: 'ok' }; }

  @Get('summary') summary() { return this.svc.summary(); }
  @Get('actions') list() { return this.svc.list(); }
  @Get('actions/:id') get(@Param('id') id: string) { return this.svc.get(id); }
  @Post('actions/:id/dry-run') dryRun(@Param('id') id: string, @Req() r: any) { return this.svc.dryRun(id, r.user); }
  @Roles('secops', 'finops') @Post('actions/:id/approve') approve(@Param('id') id: string, @Req() r: any) { return this.svc.approve(id, r.user); }
  @Roles('secops', 'finops') @Post('actions/:id/reject') reject(@Param('id') id: string, @Req() r: any) { return this.svc.reject(id, r.user); }

  /** Ingest telemetry -> engine analysis -> approval-gated actions. Raw secrets scanned by the engine are never persisted. */
  @Post('ingest')
  async ingest(@Body() body: Record<string, any>, @Req() r: any) {
    if (!body || typeof body !== 'object') throw new BadRequestException();
    const { text_scans, ...safe } = body; // evidence must not contain scanned secrets
    const evidenceKey = await this.evidence.put(JSON.stringify({ ...safe, scanned_sources: Object.keys(text_scans ?? {}) }));
    const portfolio = await this.engine.ingest(body);
    const created: string[] = []; let skipped = 0;
    for (const p of portfolio.proposals.filter((p: any) => p.requires_approval)) {
      const rec = await this.svc.create(p, r.user.user, evidenceKey);
      rec ? created.push(rec.id) : skipped++;
    }
    await this.audit.record(r.user.user, 'ingest', createHash('sha1').update(evidenceKey).digest('hex').slice(0, 8), { created: created.length, skipped });
    return { created, skipped, totalMonthlySavings: portfolio.total_monthly_savings, criticalCount: portfolio.critical_count, proposals: portfolio.proposals };
  }

  @Roles('admin') @Get('audit') auditLog() { return this.audit.list(); }
  @Roles('admin') @Get('audit/verify') verify() { return this.audit.verify(); }
  @Get('policy') currentPolicy() { return this.policy.current(); }
  @Roles('admin') @Post('policy') async publish(@Body() body: PolicyBody, @Req() r: any) {
    try { const p = await this.policy.publish(body, r.user.user); await this.audit.record(r.user.user, 'policy.published', String(p.version)); return p; }
    catch (e) { throw new BadRequestException((e as Error).message); }
  }
  @Get('evidence/:key') async evidenceGet(@Param('key') key: string) { return JSON.parse((await this.evidence.get(key)).toString()); }
}
