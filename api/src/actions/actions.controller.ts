import { BadRequestException, Body, Controller, Get, Header, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuditQuery, AuditService } from '../audit/audit.service';
import { EventLogService } from '../audit/eventlog.service';
import { Public, Roles } from '../auth/auth';
import { IngestService } from '../ingest/ingest.service';
import { MetricsService } from '../metrics/metrics.service';
import { EvidenceService } from '../evidence/evidence.service';
import { PolicyBody, PolicyService } from '../policy/policy.service';
import { ActionsService } from './actions.service';

const badQuery = (e: Error) => { throw new BadRequestException(e.message); };

@Controller()
export class ActionsController {
  constructor(
    private readonly svc: ActionsService, private readonly audit: AuditService, private readonly eventlog: EventLogService, private readonly policy: PolicyService,
    private readonly ingestSvc: IngestService, private readonly evidence: EvidenceService, private readonly metrics: MetricsService,
  ) {}

  @Public() @Get('health') health() { return { status: 'ok' }; }

  @Header('content-type', 'text/plain; version=0.0.4') @Roles('admin') @Get('metrics') metricsText() { return this.metrics.render(); }
  @Get('summary') summary() { return this.svc.summary(); }
  @Get('actions') list() { return this.svc.list(); }
  @Get('actions/:id') get(@Param('id') id: string) { return this.svc.get(id); }
  @Post('actions/:id/dry-run') dryRun(@Param('id') id: string, @Req() r: any) { return this.svc.dryRun(id, r.user); }
  @Roles('secops', 'finops') @Post('actions/:id/approve') approve(@Param('id') id: string, @Req() r: any) { return this.svc.approve(id, r.user); }
  @Roles('secops', 'finops') @Post('actions/:id/reject') reject(@Param('id') id: string, @Req() r: any) { return this.svc.reject(id, r.user); }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('ingest')
  ingest(@Body() body: Record<string, any>, @Req() r: any) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException();
    return this.ingestSvc.ingest(body, r.user.user);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('collect/aws')
  collectAws(@Body() body: { days?: number; include_iam?: boolean }, @Req() r: any) {
    return this.ingestSvc.collectAws({ days: body?.days, include_iam: body?.include_iam }, r.user.user);
  }

  @Roles('admin') @Get('audit') auditLog(@Query() q: AuditQuery) { return this.audit.query(q).catch(badQuery); }
  @Header('content-type', 'application/x-ndjson') @Roles('admin') @Get('audit/export') auditExport() { return this.eventlog.exportNdjson(); }
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) @Roles('admin') @Get('audit/summary')
  auditSummary(@Query() q: { from?: string; to?: string; explain?: string }) {
    return this.eventlog.summarize({ from: q.from, to: q.to, explain: q.explain === 'true' });
  }
  @Throttle({ default: { limit: 20, ttl: 60_000 } }) @Roles('admin') @Get('audit/summary/synthetic')
  auditSummarySynthetic(@Query() q: { scenario?: string; seed?: string; days?: string; explain?: string }) {
    return this.eventlog.summarizeSynthetic({ scenario: q.scenario, seed: q.seed === undefined ? undefined : Number(q.seed),
      days: q.days === undefined ? undefined : Number(q.days), explain: q.explain === 'true' });
  }
  @Roles('admin') @Get('audit/verify') verify() { return this.audit.verify(); }
  @Get('policy') currentPolicy() { return this.policy.current(); }
  @Roles('admin') @Post('policy') async publish(@Body() body: PolicyBody, @Req() r: any) {
    try { const p = await this.policy.publish(body, r.user.user); await this.audit.record(r.user.user, 'policy.published', String(p.version)); return p; }
    catch (e) { throw new BadRequestException((e as Error).message); }
  }
  @Get('evidence/:key') async evidenceGet(@Param('key') key: string) { return JSON.parse((await this.evidence.get(key)).toString()); }
}
