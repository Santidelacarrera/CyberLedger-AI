import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Pool } from 'pg';
import { migrate } from '../db/db';
import { AuditService, canonical, hashEntry } from './audit.service';
import { EVENT_SEVERITY, eventsWithSeverity, severityOf } from './events';
import { EventLogService, SUMMARY_MAX_EVENTS } from './eventlog.service';

const VERIFY = join(__dirname, '../../scripts/verify-audit-export.js');

async function seed(a: AuditService) {
  await a.record('sara', 'action.created', 'a1', { action: 'destroy' });
  await a.record('luis', 'action.approved', 'a1', { role: 'secops' });
  await a.record('system', 'action.failed', 'a1', { error: 'boom' });
  await a.record('system', 'action.rolled_back', 'a1', {});
  await a.record('root', 'policy.published', '2', {});
  await a.record('sara', 'ingest', 'x', { zeta: 1, alpha: { b: 2, a: 1 } }); // key order must not matter
}

function suite(name: string, make: () => Promise<{ audit: AuditService; done: () => Promise<void> }>) {
  describe(`audit query (${name})`, () => {
    let audit: AuditService, done: () => Promise<void>;
    beforeAll(async () => { ({ audit, done } = await make()); await seed(audit); });
    afterAll(async () => done());

    it('returns newest first with total and paging', async () => {
      const p = await audit.query({ limit: 2, offset: 1 });
      expect(p.total).toBe(6);
      expect(p.items.map((e) => e.event)).toEqual(['policy.published', 'action.rolled_back']);
      expect(p.limit).toBe(2); expect(p.offset).toBe(1);
    });
    it('filters by actor, event, subject (AND)', async () => {
      expect((await audit.query({ actor: 'system' })).total).toBe(2);
      expect((await audit.query({ event: 'action.approved' })).items[0].actor).toBe('luis');
      expect((await audit.query({ subject: 'a1', actor: 'sara' })).total).toBe(1);
      expect((await audit.query({ subject: 'nope' })).total).toBe(0);
    });
    it('filters by severity, info = everything not classified', async () => {
      expect((await audit.query({ severity: 'critical' })).items.map((e) => e.event)).toEqual(['action.rolled_back']);
      expect((await audit.query({ severity: 'warning' })).total).toBe(1);
      expect((await audit.query({ severity: 'notice' })).total).toBe(1);
      expect((await audit.query({ severity: 'info' })).total).toBe(3);
    });
    it('filters by date range (inclusive) and rejects bad dates', async () => {
      const all = await audit.query({ limit: 500 });
      const mid = all.items[2].at;
      expect((await audit.query({ from: mid, to: mid })).total).toBeGreaterThan(0);
      expect((await audit.query({ from: '2999-01-01' })).total).toBe(0);
      expect((await audit.query({ to: '2000-01-01' })).total).toBe(0);
      await expect(audit.query({ from: 'not-a-date' })).rejects.toThrow(RangeError);
    });
    it('clamps limit/offset and tolerates garbage', async () => {
      expect((await audit.query({ limit: 99999 })).limit).toBe(500);
      expect((await audit.query({ limit: -4 })).limit).toBe(1);
      expect((await audit.query({ limit: NaN, offset: 'x' as any }))).toMatchObject({ limit: 100, offset: 0 });
    });
    it('keeps the hash chain valid regardless of JSON key order', async () => {
      expect(await audit.verify()).toEqual({ ok: true });
    });
    it('exports NDJSON that the standalone script verifies, and detects tampering', async () => {
      const text = (await new EventLogService(audit, {} as any).exportNdjson());
      const dir = mkdtempSync(join(tmpdir(), 'aud-'));
      const f = join(dir, 'a.ndjson');
      writeFileSync(f, text);
      expect(JSON.parse(execFileSync('node', [VERIFY, f]).toString())).toEqual({ ok: true, checked: 6 });
      const lines = text.trim().split('\n');
      const bad = JSON.parse(lines[1]); bad.actor = 'mallory';
      lines[1] = JSON.stringify(bad);
      writeFileSync(f, lines.join('\n') + '\n');
      const r = spawnSync('node', [VERIFY, f]);
      expect(r.status).toBe(1); expect(JSON.parse(r.stdout.toString())).toMatchObject({ ok: false, brokenAt: 2 });
      expect(spawnSync('node', [VERIFY, join(dir, 'missing')]).status).toBe(2);
    });
  });
}

suite('memory', async () => ({ audit: new AuditService(null), done: async () => undefined }));

const URL = process.env.DATABASE_URL;
(URL ? suite : (_n: string, _m: any) => undefined)('postgres', async () => {
  const pool = new Pool({ connectionString: URL });
  await pool.query('DROP TABLE IF EXISTS actions, audit_log, policies, schema_migrations CASCADE');
  await migrate(pool);
  return { audit: new AuditService(pool), done: async () => { await pool.end(); } };
});

describe('canonical hashing', () => {
  it('is independent of key order and sensitive to content', () => {
    const e = { at: 't', actor: 'a', event: 'e', subject: 's' };
    expect(hashEntry('p', { ...e, data: { b: 1, a: { d: 1, c: 2 } } })).toBe(hashEntry('p', { ...e, data: { a: { c: 2, d: 1 }, b: 1 } }));
    expect(hashEntry('p', { ...e, data: { a: 1 } })).not.toBe(hashEntry('p', { ...e, data: { a: 2 } }));
    expect(canonical([{ b: 1, a: 2 }])).toEqual([{ a: 2, b: 1 }]);
  });
});

describe('taxonomy', () => {
  it('defaults unknown events to info and partitions severities', () => {
    expect(severityOf('brand.new')).toBe('info');
    expect(severityOf('action.rolled_back')).toBe('critical');
    expect(eventsWithSeverity('info').notIn).toEqual(Object.keys(EVENT_SEVERITY));
    expect(eventsWithSeverity('warning').in).toEqual(['action.failed', 'action.rejected', 'action.blocked_by_policy']);
  });
});

describe('EventLogService', () => {
  const fakeEngine = () => {
    const calls: any[] = [];
    return { calls, engine: {
      summarizeEvents: async (events: any[], explain: boolean) => { calls.push({ n: events.length, explain, events }); return { ok: true }; },
      syntheticEvents: async (q: any) => { calls.push({ synthetic: q }); return Array.from({ length: 3 }, (_, i) => ({ seq: i + 1 })); },
    } as any };
  };

  it('summarizes the requested range and flags truncation', async () => {
    const audit = new AuditService(null);
    for (let i = 0; i < SUMMARY_MAX_EVENTS + 3; i++) await audit.record('u', 'ingest', String(i));
    const { calls, engine } = fakeEngine();
    const svc = new EventLogService(audit, engine);
    const r = await svc.summarize({ explain: true });
    expect(r).toMatchObject({ source: 'audit_log', eventsAnalyzed: SUMMARY_MAX_EVENTS, truncated: true });
    expect(calls[0].explain).toBe(true);
    expect(calls[0].events.at(-1).subject).toBe(String(SUMMARY_MAX_EVENTS + 2)); // newest events kept
    expect((await svc.summarize({ from: '2999-01-01' })).eventsAnalyzed).toBe(0);
    await expect(svc.summarize({ from: 'bad' })).rejects.toThrow('invalid date');
  }, 60_000);

  it('synthetic summaries sanitize inputs and never touch the audit trail', async () => {
    const audit = new AuditService(null);
    const { calls, engine } = fakeEngine();
    const svc = new EventLogService(audit, engine);
    expect(await svc.summarizeSynthetic({})).toMatchObject({ source: 'synthetic', scenario: 'normal', seed: 7, days: 14, eventsAnalyzed: 3 });
    await svc.summarizeSynthetic({ scenario: 'drop table', seed: NaN, days: 9999 });
    expect(calls.filter((c) => c.synthetic).map((c) => c.synthetic)).toEqual([
      { seed: 7, days: 14, scenario: 'normal' }, { seed: 7, days: 60, scenario: 'normal' }]);
    expect((await svc.summarizeSynthetic({ scenario: 'incident' })).scenario).toBe('incident');
    expect(await audit.list()).toEqual([]);
  });
});
