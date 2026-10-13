import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Pool } from 'pg';
import { PG } from '../db/db';
import { eventsWithSeverity, Severity } from './events';

export interface AuditEntry { seq: number; at: string; actor: string; event: string; subject?: string; data: any; prevHash: string; hash: string }

export interface AuditQuery {
  actor?: string; event?: string; subject?: string; severity?: Severity;
  from?: string; to?: string; limit?: number; offset?: number;
}
export interface AuditPage { items: AuditEntry[]; total: number; limit: number; offset: number }

export const MAX_PAGE = 500;
const clampInt = (v: unknown, def: number, min: number, max: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
};

/** Recursively sorts object keys. Postgres jsonb does not preserve key order, so the hash must not depend on it. */
export const canonical = (v: any): any =>
  Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;

export const hashEntry = (prev: string, e: Pick<AuditEntry, 'at' | 'actor' | 'event' | 'subject' | 'data'>) =>
  createHash('sha256').update(JSON.stringify([prev, e.at, e.actor, e.event, e.subject ?? null, canonical(e.data)])).digest('hex');

/** Append-only, hash-chained audit trail (tamper-evident; Postgres triggers also forbid UPDATE/DELETE). */
@Injectable()
export class AuditService {
  private mem: AuditEntry[] = [];
  private chain: Promise<unknown> = Promise.resolve();
  constructor(@Inject(PG) private readonly pool: Pool | null) {}

  record(actor: string, event: string, subject?: string, data: any = {}): Promise<void> {
    const run = async () => {
      const at = new Date().toISOString();
      if (!this.pool) {
        const prev = this.mem.at(-1)?.hash ?? 'GENESIS';
        this.mem.push({ seq: this.mem.length + 1, at, actor, event, subject, data, prevHash: prev, hash: hashEntry(prev, { at, actor, event, subject, data }) });
        return;
      }
      const c = await this.pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('LOCK TABLE audit_log IN EXCLUSIVE MODE');
        const prev = (await c.query('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1')).rows[0]?.hash ?? 'GENESIS';
        // normalise `at` to ms precision, matching what Postgres returns on read
        await c.query('INSERT INTO audit_log (at,actor,event,subject,data,prev_hash,hash) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [at, actor, event, subject ?? null, JSON.stringify(data), prev, hashEntry(prev, { at, actor, event, subject, data })]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    };
    const p = this.chain.then(run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  async list(): Promise<AuditEntry[]> {
    if (!this.pool) return [...this.mem];
    return (await this.pool.query('SELECT * FROM audit_log ORDER BY seq')).rows.map(this.toEntry);
  }

  /** Filtered, newest-first page. Filters are combined with AND. Dates are ISO strings (inclusive). */
  async query(q: AuditQuery = {}): Promise<AuditPage> {
    const limit = clampInt(q.limit, 100, 1, MAX_PAGE), offset = clampInt(q.offset, 0, 0, 1e9);
    const sev = q.severity ? eventsWithSeverity(q.severity) : undefined;
    const from = q.from ? new Date(q.from) : undefined, to = q.to ? new Date(q.to) : undefined;
    if ((from && isNaN(+from)) || (to && isNaN(+to))) throw new RangeError('invalid date');
    if (!this.pool) {
      const rows = this.mem.filter((e) =>
        (!q.actor || e.actor === q.actor) && (!q.event || e.event === q.event) && (!q.subject || e.subject === q.subject) &&
        (!sev || (sev.in ? sev.in.includes(e.event) : !sev.notIn!.includes(e.event))) &&
        (!from || new Date(e.at) >= from) && (!to || new Date(e.at) <= to)).reverse();
      return { items: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
    }
    const where: string[] = [], args: unknown[] = [];
    const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace('$?', `$${args.length}`)); };
    if (q.actor) add('actor = $?', q.actor);
    if (q.event) add('event = $?', q.event);
    if (q.subject) add('subject = $?', q.subject);
    if (sev?.in) add('event = ANY($?)', sev.in);
    if (sev?.notIn) add('NOT (event = ANY($?))', sev.notIn);
    if (from) add('at >= $?', from.toISOString());
    if (to) add('at <= $?', to.toISOString());
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = Number((await this.pool.query(`SELECT count(*) FROM audit_log ${w}`, args)).rows[0].count);
    const rows = (await this.pool.query(`SELECT * FROM audit_log ${w} ORDER BY seq DESC LIMIT ${limit} OFFSET ${offset}`, args)).rows;
    return { items: rows.map(this.toEntry), total, limit, offset };
  }

  private toEntry = (r: any): AuditEntry => ({
    seq: Number(r.seq), at: new Date(r.at).toISOString(), actor: r.actor, event: r.event, subject: r.subject ?? undefined,
    data: r.data, prevHash: r.prev_hash, hash: r.hash });

  async verify(): Promise<{ ok: boolean; brokenAt?: number }> {
    let prev = 'GENESIS';
    for (const e of await this.list()) {
      if (e.prevHash !== prev || e.hash !== hashEntry(prev, e)) return { ok: false, brokenAt: e.seq };
      prev = e.hash;
    }
    return { ok: true };
  }
}
