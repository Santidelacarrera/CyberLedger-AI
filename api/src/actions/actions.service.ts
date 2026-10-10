import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { EXECUTOR, Executor } from '../executor/executor';
import { Notifier } from '../notify/notifier';
import { PolicyService } from '../policy/policy.service';
import { transition } from './action-state';
import { isSatisfied } from './approval';
import { ActionRecord, ActionsRepository } from './actions.repo';

export interface Actor { user: string; role: string }

@Injectable()
export class ActionsService {
  constructor(
    private readonly repo: ActionsRepository,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
    private readonly notifier: Notifier,
    @Inject(EXECUTOR) private readonly executor: Executor,
    @InjectQueue('remediation') private readonly queue: Queue,
  ) {}

  /** Execution is always gated: proposals start as PENDING_APPROVAL. Returns null if an open duplicate exists. */
  async create(proposal: Record<string, any>, actor: string, evidenceKey?: string): Promise<ActionRecord | null> {
    const { roles, blocked } = await this.policy.requiredRoles(proposal);
    if (blocked) { await this.audit.record(actor, 'action.blocked_by_policy', proposal.resource_id, { action: proposal.action }); return null; }
    const now = new Date().toISOString();
    const rec: ActionRecord = {
      id: randomUUID(), dedupeKey: `${proposal.resource_id}:${proposal.action}`, proposal, status: 'PENDING_APPROVAL',
      requiredRoles: roles, approvals: [], evidenceKey, createdAt: now, updatedAt: now,
    };
    if (!(await this.repo.insert(rec))) return null;
    await this.audit.record(actor, 'action.created', rec.id, { action: proposal.action, resource: proposal.resource_id, requiredRoles: roles });
    const p = proposal;
    await this.notifier.send(`🔔 Pending approval: ${p.action} on ${p.resource_id} (saves $${p.monthly_savings}/mo; needs ${roles.join('+')})`);
    return rec;
  }

  list() { return this.repo.list(); }

  async get(id: string): Promise<ActionRecord> {
    const rec = await this.repo.get(id);
    if (!rec) throw new NotFoundException(id);
    return rec;
  }

  async dryRun(id: string, actor: Actor) {
    const rec = await this.get(id);
    const plan = await this.executor.plan(rec);
    await this.audit.record(actor.user, 'action.dry_run', id);
    return { id, plan, monthlySavings: rec.proposal.monthly_savings, paybackMonths: rec.proposal.payback_months };
  }

  async approve(id: string, actor: Actor): Promise<ActionRecord> {
    const rec = await this.get(id);
    if (rec.status !== 'PENDING_APPROVAL') throw new ConflictException(`action is ${rec.status}`);
    if (actor.role !== 'admin' && !rec.requiredRoles.includes(actor.role)) throw new ForbiddenException('role not required for this action');
    if (rec.approvals.some((a) => a.user === actor.user)) throw new ConflictException('already approved by this user');
    rec.approvals.push({ user: actor.user, role: actor.role, at: new Date().toISOString() });
    await this.audit.record(actor.user, 'action.approved', id, { role: actor.role });
    if (isSatisfied(rec.requiredRoles, rec.approvals)) {
      rec.status = transition(rec.status, 'APPROVED');
      await this.repo.save(rec);
      // jobId = action id => enqueueing twice is a no-op; failed attempts retry with exponential backoff
      await this.queue.add('remediate', { id }, { jobId: id, attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true });
      await this.audit.record('system', 'action.queued', id);
    } else await this.repo.save(rec);
    return rec;
  }

  async reject(id: string, actor: Actor): Promise<ActionRecord> {
    const rec = await this.get(id);
    rec.status = transition(rec.status, 'REJECTED');
    await this.repo.save(rec);
    await this.audit.record(actor.user, 'action.rejected', id);
    return rec;
  }

  async setStatus(id: string, to: ActionRecord['status'], error?: string): Promise<void> {
    const rec = await this.get(id);
    if (rec.status !== to) rec.status = transition(rec.status, to);
    rec.error = error ?? null;
    await this.repo.save(rec);
    await this.audit.record('system', `action.${to.toLowerCase()}`, id, error ? { error } : {});
    if (['DONE', 'FAILED', 'ROLLED_BACK'].includes(to))
      await this.notifier.send(`${to === 'DONE' ? '✅' : '⚠️'} ${rec.proposal.action} on ${rec.proposal.resource_id}: ${to}${error ? ` (${error})` : ''}`);
  }

  async summary() {
    const all = await this.repo.list();
    const pending = all.filter((a) => a.status === 'PENDING_APPROVAL');
    const sum = (xs: ActionRecord[]) => Math.round(xs.reduce((s, a) => s + (a.proposal.monthly_savings ?? 0), 0) * 100) / 100;
    return {
      pending: pending.length, pendingSavings: sum(pending),
      realizedSavings: sum(all.filter((a) => a.status === 'DONE')),
      byStatus: all.reduce<Record<string, number>>((m, a) => ((m[a.status] = (m[a.status] ?? 0) + 1), m), {}),
    };
  }
}
