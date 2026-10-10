import type { ActionRecord, Session, Summary } from './types';

async function call<T>(s: Session, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(s.baseUrl + path, {
    ...init, headers: { 'content-type': 'application/json', 'x-api-key': s.apiKey, ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

export const api = {
  actions: (s: Session) => call<ActionRecord[]>(s, '/actions'),
  summary: (s: Session) => call<Summary>(s, '/summary'),
  approve: (s: Session, id: string) => call<ActionRecord>(s, `/actions/${id}/approve`, { method: 'POST' }),
  reject: (s: Session, id: string) => call<ActionRecord>(s, `/actions/${id}/reject`, { method: 'POST' }),
  dryRun: (s: Session, id: string) => call<{ plan: string; monthlySavings: number }>(s, `/actions/${id}/dry-run`, { method: 'POST' }),
  ingest: (s: Session, body: unknown) => call<{ created: string[]; skipped: number }>(s, '/ingest', { method: 'POST', body: JSON.stringify(body) }),
};
