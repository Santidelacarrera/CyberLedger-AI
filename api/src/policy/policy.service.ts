import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG } from '../db/db';

export interface PolicyBody {
  /** actions that need two distinct approvers covering every required role (four-eyes) */
  dualControlActions: string[];
  /** actions that are never executable */
  blockedActions: string[];
  /** security_risk at/above which SecOps must approve */
  secopsRiskThreshold: number;
}
export interface Policy { version: number; createdAt: string; createdBy: string; body: PolicyBody }

export const DEFAULT_POLICY: PolicyBody = {
  dualControlActions: ['destroy', 'revoke_identity'], blockedActions: [], secopsRiskThreshold: 0.3,
};

/** Policies are versioned and append-only: a change creates a new version, history is never rewritten. */
@Injectable()
export class PolicyService {
  private mem: Policy[] = [];
  constructor(@Inject(PG) private readonly pool: Pool | null) {}

  async current(): Promise<Policy> {
    if (!this.pool) return this.mem.at(-1) ?? { version: 0, createdAt: new Date(0).toISOString(), createdBy: 'default', body: DEFAULT_POLICY };
    const r = (await this.pool.query('SELECT * FROM policies ORDER BY version DESC LIMIT 1')).rows[0];
    return r ? { version: r.version, createdAt: new Date(r.created_at).toISOString(), createdBy: r.created_by, body: r.body }
             : { version: 0, createdAt: new Date(0).toISOString(), createdBy: 'default', body: DEFAULT_POLICY };
  }

  async publish(body: PolicyBody, by: string): Promise<Policy> {
    if (!Array.isArray(body.dualControlActions) || !Array.isArray(body.blockedActions) || typeof body.secopsRiskThreshold !== 'number')
      throw new Error('invalid policy');
    if (!this.pool) {
      const p = { version: this.mem.length + 1, createdAt: new Date().toISOString(), createdBy: by, body };
      this.mem.push(p); return p;
    }
    await this.pool.query('INSERT INTO policies (created_by, body) VALUES ($1,$2)', [by, JSON.stringify(body)]);
    return this.current();
  }

  async requiredRoles(proposal: any): Promise<{ roles: string[]; dual: boolean; blocked: boolean }> {
    const { body } = await this.current();
    const roles = new Set<string>();
    if (proposal.security_risk >= body.secopsRiskThreshold || ['revoke_identity', 'throttle_llm'].includes(proposal.action)) roles.add('secops');
    if (proposal.monthly_savings > 0) roles.add('finops');
    if (roles.size === 0) roles.add('secops');
    const dual = body.dualControlActions.includes(proposal.action);
    if (dual) { roles.add('secops'); roles.add('finops'); }
    return { roles: [...roles].sort(), dual, blocked: body.blockedActions.includes(proposal.action) };
  }
}
