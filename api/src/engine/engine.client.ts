import { Injectable } from '@nestjs/common';
import { cfg } from '../config';

@Injectable()
export class EngineClient {
  async ingest(body: unknown): Promise<any> {
    const res = await fetch(`${cfg().engineUrl}/ingest`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`engine ${res.status}: ${await res.text()}`);
    return res.json();
  }
}
