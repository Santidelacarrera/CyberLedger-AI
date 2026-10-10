import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ActionsService } from './actions.service';

@Processor('remediation')
export class RemediationProcessor extends WorkerHost {
  constructor(private readonly actions: ActionsService) { super(); }

  async process(job: Job<{ id: string }>): Promise<void> {
    const { id } = job.data;
    this.actions.setStatus(id, 'EXECUTING');
    try {
      await this.applyIdempotently(id);
      await this.healthcheck(id); // zero-downtime guard
      this.actions.setStatus(id, 'DONE');
    } catch (e) {
      this.actions.setStatus(id, 'FAILED'); // BullMQ retries with backoff
      throw e;
    }
  }

  private async applyIdempotently(_id: string): Promise<void> { /* TODO: terraform apply w/ state lock */ }
  private async healthcheck(_id: string): Promise<void> { /* TODO: probe service; throw to roll back */ }
}
