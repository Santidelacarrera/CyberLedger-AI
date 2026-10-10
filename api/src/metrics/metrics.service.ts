import { Injectable } from '@nestjs/common';
import { ActionsService } from '../actions/actions.service';

/** Prometheus text exposition. */
@Injectable()
export class MetricsService {
  constructor(private readonly actions: ActionsService) {}
  async render(): Promise<string> {
    const s = await this.actions.summary();
    const lines = ['# TYPE cyberledger_actions gauge', ...Object.entries(s.byStatus).map(([k, v]) => `cyberledger_actions{status="${k}"} ${v}`),
      '# TYPE cyberledger_pending_savings_usd gauge', `cyberledger_pending_savings_usd ${s.pendingSavings}`,
      '# TYPE cyberledger_realized_savings_usd gauge', `cyberledger_realized_savings_usd ${s.realizedSavings}`];
    return lines.join('\n') + '\n';
  }
}
