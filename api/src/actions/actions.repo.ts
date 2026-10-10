import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG } from '../db/db';
import { ActionStatus } from './action-state';

export interface Approval { user: string; role: string; at: string }
export interface ActionRecord {
  id: string;
  dedupeKey: string;
  proposal: Record<string, any>;
  status: ActionStatus;
  requiredRoles: string[];
  approvals: Approval[];
  error?: string | null;
  evidenceKey?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ActionsRepo {
  insert(r: ActionRecord): Promise<boolean>; // false if an open action with same dedupeKey exists
  get(id: string): Promise<ActionRecord | undefined>;
  list(): Promise<ActionRecord[]>;
  save(r: ActionRecord): Promise<void>;
}

const OPEN = ['PENDING_APPROVAL', 'APPROVED', 'EXECUTING'];

@Injectable()
export class ActionsRepository implements ActionsRepo {
  private mem = new Map<string, ActionRecord>();
  constructor(@Inject(PG) private readonly pool: Pool | null) {}

  async insert(r: ActionRecord): Promise<boolean> {
    if (!this.pool) {
      if ([...this.mem.values()].some((x) => x.dedupeKey === r.dedupeKey && OPEN.includes(x.status))) return false;
      this.mem.set(r.id, r);
      return true;
    }
    const res = await this.pool.query(
      `INSERT INTO actions (id,dedupe_key,proposal,status,required_roles,approvals,evidence_key,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) ON CONFLICT DO NOTHING`,
      [r.id, r.dedupeKey, r.proposal, r.status, r.requiredRoles, JSON.stringify(r.approvals), r.evidenceKey ?? null, r.createdAt]);
    return res.rowCount === 1;
  }

  async get(id: string) {
    if (!this.pool) return this.mem.get(id);
    const res = await this.pool.query('SELECT * FROM actions WHERE id=$1', [id]);
    return res.rows[0] && this.row(res.rows[0]);
  }

  async list() {
    if (!this.pool) return [...this.mem.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return (await this.pool.query('SELECT * FROM actions ORDER BY created_at DESC LIMIT 500')).rows.map(this.row);
  }

  async save(r: ActionRecord) {
    r.updatedAt = new Date().toISOString();
    if (!this.pool) { this.mem.set(r.id, r); return; }
    await this.pool.query(
      'UPDATE actions SET status=$2, approvals=$3, error=$4, updated_at=now() WHERE id=$1',
      [r.id, r.status, JSON.stringify(r.approvals), r.error ?? null]);
  }

  private row = (x: any): ActionRecord => ({
    id: x.id, dedupeKey: x.dedupe_key, proposal: x.proposal, status: x.status, requiredRoles: x.required_roles,
    approvals: x.approvals, error: x.error, evidenceKey: x.evidence_key,
    createdAt: new Date(x.created_at).toISOString(), updatedAt: new Date(x.updated_at).toISOString(),
  });
}
