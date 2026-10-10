import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { ActionStatus, transition } from './action-state';

export interface ActionRecord {
  id: string;
  proposal: Record<string, unknown>; // Proposal from the engine (incl. terraform_diff, savings)
  status: ActionStatus;
  approvedBy?: string;
}

@Injectable()
export class ActionsService {
  private store = new Map<string, ActionRecord>(); // TODO: PostgreSQL
  constructor(@InjectQueue('remediation') private readonly queue: Queue) {}

  /** Execution is always gated: proposals start as PENDING_APPROVAL. */
  create(proposal: Record<string, unknown>): ActionRecord {
    const rec: ActionRecord = { id: randomUUID(), proposal, status: 'PENDING_APPROVAL' };
    this.store.set(rec.id, rec);
    return rec;
  }

  list(): ActionRecord[] {
    return [...this.store.values()];
  }

  get(id: string): ActionRecord {
    const rec = this.store.get(id);
    if (!rec) throw new NotFoundException(id);
    return rec;
  }

  async approve(id: string, user: string): Promise<ActionRecord> {
    const rec = this.get(id);
    rec.status = transition(rec.status, 'APPROVED');
    rec.approvedBy = user;
    // jobId = action id => enqueueing twice is a no-op (idempotent); retries with exponential backoff
    await this.queue.add('remediate', { id }, {
      jobId: id, attempts: 5, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true,
    });
    return rec;
  }

  reject(id: string): ActionRecord {
    const rec = this.get(id);
    rec.status = transition(rec.status, 'REJECTED');
    return rec;
  }

  setStatus(id: string, to: ActionStatus): void {
    const rec = this.get(id);
    if (rec.status !== to) rec.status = transition(rec.status, to);
  }
}
