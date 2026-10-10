import { BadGatewayException, Injectable } from '@nestjs/common';
import { cfg } from '../config';

@Injectable()
export class EngineClient {
  ingest(body: unknown): Promise<any> { return this.post('/ingest', body); }
  collectAws(body: unknown): Promise<any> { return this.post('/collect/aws', body); }

  private async post(path: string, body: unknown): Promise<any> {
    const res = await fetch(`${cfg().engineUrl}${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new BadGatewayException(`engine ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  }
}
