import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ActionsController } from './actions/actions.controller';
import { ActionsService } from './actions/actions.service';
import { RemediationProcessor } from './actions/remediation.processor';

@Module({
  imports: [
    BullModule.forRoot({ connection: { host: process.env.REDIS_HOST ?? 'localhost', port: 6379 } }),
    BullModule.registerQueue({ name: 'remediation' }),
  ],
  controllers: [ActionsController],
  providers: [ActionsService, RemediationProcessor],
})
export class AppModule {}
