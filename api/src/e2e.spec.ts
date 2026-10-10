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
      .overrideProvider(EngineClient).useValue({ ingest: async () => PORTFOLIO }).compile();
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
});
