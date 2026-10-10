import { Injectable, Logger } from '@nestjs/common';
import { cfg } from '../config';

/** Best-effort webhook notifications (Slack-compatible). Never throws: notification failure must not block remediation. */
@Injectable()
export class Notifier {
  private log = new Logger('Notifier');
  async send(text: string): Promise<void> {
    const url = cfg().webhookUrl;
    if (!url) return;
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }), signal: AbortSignal.timeout(5000) });
      if (!r.ok) this.log.warn(`webhook ${r.status}`);
    } catch (e) { this.log.warn(`webhook failed: ${(e as Error).message}`); }
  }
}
