import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { Pool } from 'pg';
import { PG } from '../db/db';

export interface AuditEntry { seq: number; at: string; actor: string; event: string; subject?: string; data: any; prevHash: string; hash: string }

export const hashEntry = (prev: string, e: Pick<AuditEntry, 'at' | 'actor' | 'event' | 'subject' | 'data'>) =>
  createHash('sha256').update(JSON.stringify([prev, e.at, e.actor, e.event, e.subject ?? null, e.data])).digest('hex');

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
    return (await this.pool.query('SELECT * FROM audit_log ORDER BY seq')).rows.map((r) => ({
      seq: Number(r.seq), at: new Date(r.at).toISOString(), actor: r.actor, event: r.event, subject: r.subject ?? undefined,
      data: r.data, prevHash: r.prev_hash, hash: r.hash }));
  }

  async verify(): Promise<{ ok: boolean; brokenAt?: number }> {
    let prev = 'GENESIS';
    for (const e of await this.list()) {
      if (e.prevHash !== prev || e.hash !== hashEntry(prev, e)) return { ok: false, brokenAt: e.seq };
      prev = e.hash;
    }
    return { ok: true };
  }
}
