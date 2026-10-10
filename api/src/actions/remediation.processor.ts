import { Inject } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EXECUTOR, Executor, HealthChecker } from '../executor/executor';
import { ActionsService } from './actions.service';

@Processor('remediation')
export class RemediationProcessor extends WorkerHost {
  constructor(
    private readonly actions: ActionsService,
    private readonly health: HealthChecker,
    @Inject(EXECUTOR) private readonly executor: Executor,
  ) { super(); }

  async process(job: Job<{ id: string }>): Promise<void> {
    const rec = await this.actions.get(job.data.id);
    if (rec.status === 'DONE' || rec.status === 'ROLLED_BACK' || rec.status === 'REJECTED') return; // idempotent re-delivery
    if (rec.status !== 'EXECUTING') await this.actions.setStatus(rec.id, 'EXECUTING'); // else: resumed after a crash
    try {
      await this.executor.apply(rec);
      if (!(await this.health.check(rec.proposal.resource_id))) {
        await this.executor.rollback(rec);
        await this.actions.setStatus(rec.id, 'ROLLED_BACK', 'healthcheck failed after apply');
        return; // do not retry a change that breaks the service
      }
      await this.actions.setStatus(rec.id, 'DONE');
    } catch (e) {
      await this.actions.setStatus(rec.id, 'FAILED', String((e as Error).message)); // BullMQ retries with backoff
      throw e;
    }
  }
}
