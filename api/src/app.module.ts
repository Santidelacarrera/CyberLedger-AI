import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { ActionsController } from './actions/actions.controller';
import { ActionsRepository } from './actions/actions.repo';
import { ActionsService } from './actions/actions.service';
import { RemediationProcessor } from './actions/remediation.processor';
import { AuditService } from './audit/audit.service';
import { AuthGuard } from './auth/auth';
import { cfg } from './config';
import { pgProvider } from './db/db';
import { EngineClient } from './engine/engine.client';
import { EvidenceService } from './evidence/evidence.service';
import { executorProvider, HealthChecker } from './executor/executor';
import { PolicyService } from './policy/policy.service';

@Module({
  imports: [
    BullModule.forRoot({ connection: cfg().redis }),
    BullModule.registerQueue({ name: 'remediation' }),
  ],
  controllers: [ActionsController],
  providers: [
    pgProvider, executorProvider, ActionsRepository, ActionsService, RemediationProcessor, AuditService,
    PolicyService, EngineClient, EvidenceService, HealthChecker, { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
