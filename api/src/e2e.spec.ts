import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Pool } from 'pg';

// Requires redis on :6379 and (optionally) DATABASE_URL pointing at an empty-able postgres.
process.env.API_KEYS = 'ks:sara:secops,kf:fede:finops,ka:root:admin';
process.env.EVIDENCE_DIR = '/tmp/cl-evidence-test';

const PORTFOLIO = {
  total_monthly_savings: 600, critical_count: 1,
  proposals: [
    { resource_id: 'api', action: 'patch_and_rightsize', security_risk: 0.95, financial_waste: 0.9, net_risk: 0.9, monthly_savings: 600,
      requires_approval: true, terraform_diff: '- m5.xlarge\n+ m5.large', terraform_target: 'aws_instance.api', payback_months: 1 },
    { resource_id: 'ok', action: 'no_action', requires_approval: false, monthly_savings: 0 },
  ],
};

const wait = async (fn: () => Promise<boolean>, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return; await new Promise((r) => setTimeout(r, 100)); }
  throw new Error('timeout');
};

describe('e2e: ingest -> approve -> execute', () => {
  let app: INestApplication;
  beforeAll(async () => {
    if (process.env.DATABASE_URL) {
      const p = new Pool({ connectionString: process.env.DATABASE_URL });
      await p.query('DROP TABLE IF EXISTS actions, audit_log, policies, schema_migrations CASCADE').catch(() => undefined); await p.end();
    }
    const { AppModule } = await import('./app.module');
    const { EngineClient } = await import('./engine/engine.client');
    const mod = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EngineClient).useValue({
        ingest: async () => PORTFOLIO,
        summarizeEvents: async (events: any[], explain: boolean) => ({ total_events: events.length, explain, risk_level: 'low' }),
        syntheticEvents: async (q: any) => Array.from({ length: 4 }, (_, i) => ({ seq: i + 1, ...q })),
      }).compile();
    app = mod.createNestApplication(); await app.init();
  });
  afterAll(async () => {
    const { PG } = await import('./db/db');
    const pool = app.get(PG); await app.close(); await pool?.end();
  });

  const http = () => request(app.getHttpServer());

  it('rejects unauthenticated and wrong-role calls', async () => {
    await http().get('/actions').expect(401);
    await http().get('/health').expect(200);
    await http().get('/audit').set('x-api-key', 'ks').expect(403);
  });

  it('flows through dual approval to DONE, deduplicates, and keeps a valid audit chain', async () => {
    const r = await http().post('/ingest').set('x-api-key', 'ks').send({ text_scans: { f: 'AKIAAAAAAAAAAAAAAAAA' } }).expect(201);
    expect(r.body.created).toHaveLength(1);
    const id = r.body.created[0];
    const again = await http().post('/ingest').set('x-api-key', 'ks').send({}).expect(201);
    expect(again.body.created).toHaveLength(0); expect(again.body.skipped).toBe(1);

    const act = (await http().get(`/actions/${id}`).set('x-api-key', 'ks')).body;
    expect(act.requiredRoles).toEqual(['finops', 'secops']);
    const ev = await http().get(`/evidence/${act.evidenceKey}`).set('x-api-key', 'ks').expect(200);
    expect(JSON.stringify(ev.body)).not.toContain('AKIAAAAAAAAAAAAAAAAA');

    const dry = await http().post(`/actions/${id}/dry-run`).set('x-api-key', 'ks').expect(201);
    expect(dry.body.plan).toContain('m5.large');

    await http().post(`/actions/${id}/approve`).set('x-api-key', 'ks').expect(201);
    await http().post(`/actions/${id}/approve`).set('x-api-key', 'ks').expect(409); // same user twice
    expect((await http().get(`/actions/${id}`).set('x-api-key', 'ks')).body.status).toBe('PENDING_APPROVAL');
    await http().post(`/actions/${id}/approve`).set('x-api-key', 'kf').expect(201);

    await wait(async () => (await http().get(`/actions/${id}`).set('x-api-key', 'ks')).body.status === 'DONE');
    const s = (await http().get('/summary').set('x-api-key', 'ks')).body;
    expect(s.realizedSavings).toBe(600);
    expect((await http().get('/audit/verify').set('x-api-key', 'ka')).body).toEqual({ ok: true });
  });

  it('policy versions are published by admin only and can block actions', async () => {
    await http().post('/policy').set('x-api-key', 'ks').send({}).expect(403);
    const p = await http().post('/policy').set('x-api-key', 'ka')
      .send({ dualControlActions: [], blockedActions: ['patch_and_rightsize'], secopsRiskThreshold: 0.3 }).expect(201);
    expect(p.body.version).toBeGreaterThan(0);
    const r = await http().post('/ingest').set('x-api-key', 'ks').send({}).expect(201);
    expect(r.body.created).toHaveLength(0);
  });

  it('exposes the event log: filters, export, AI summary, synthetic demo (admin only)', async () => {
    for (const path of ['/audit', '/audit/export', '/audit/summary', '/audit/summary/synthetic'])
      await http().get(path).set('x-api-key', 'ks').expect(403);
    const page = await http().get('/audit?event=action.created&limit=1').set('x-api-key', 'ka').expect(200);
    expect(page.body.items).toHaveLength(1); expect(page.body.total).toBeGreaterThanOrEqual(1);
    expect(page.body.items[0].event).toBe('action.created');
    const crit = await http().get('/audit?severity=critical').set('x-api-key', 'ka').expect(200);
    expect(crit.body.items.every((e: any) => e.event === 'action.rolled_back')).toBe(true);
    await http().get('/audit?from=garbage').set('x-api-key', 'ka').expect(400);

    const exp = await http().get('/audit/export').set('x-api-key', 'ka').expect(200);
    expect(exp.headers['content-type']).toContain('application/x-ndjson');
    const lines = exp.text.trim().split('\n').map((l) => JSON.parse(l));
    expect(lines.length).toBeGreaterThan(5);
    const { verify } = require('../scripts/verify-audit-export.js');
    expect(verify(exp.text)).toMatchObject({ ok: true });

    const sum = await http().get('/audit/summary?explain=true').set('x-api-key', 'ka').expect(200);
    expect(sum.body).toMatchObject({ source: 'audit_log', truncated: false, summary: { explain: true } });
    expect(sum.body.eventsAnalyzed).toBe(lines.length);
    const before = lines.length;
    const syn = await http().get('/audit/summary/synthetic?scenario=incident&seed=3&days=5').set('x-api-key', 'ka').expect(200);
    expect(syn.body).toMatchObject({ source: 'synthetic', scenario: 'incident', seed: 3, days: 5, eventsAnalyzed: 4 });
    const after = (await http().get('/audit/export').set('x-api-key', 'ka')).text.trim().split('\n').length;
    expect(after).toBe(before); // synthetic data is never written to the real trail
  });
});
