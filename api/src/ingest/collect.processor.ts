import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { cfg } from '../config';
import { IngestService } from './ingest.service';

/** Scheduled collection: COLLECT_CRON enables a repeatable BullMQ job (survives restarts, de-duplicated by key). */
@Processor('collection')
export class CollectProcessor extends WorkerHost implements OnModuleInit {
  private log = new Logger('Collector');
  constructor(private readonly ingest: IngestService, @InjectQueue('collection') private readonly queue: Queue) { super(); }

  async onModuleInit() {
    if (cfg().collectCron) await this.queue.upsertJobScheduler('aws-collect', { pattern: cfg().collectCron }, { name: 'collect-aws', data: {} });
  }

  async process(): Promise<void> {
    const r = await this.ingest.collectAws({}, 'scheduler');
    this.log.log(`collected: ${r.created.length} new actions, ${r.skipped} duplicates`);
  }
}
