import type { ActionRecord, AuditPage, Policy, PolicyBody, Session, Summary, SummaryResponse } from './types';

/** A JWT (SSO) goes as Bearer; anything else is treated as an API key. */
export const authHeader = (s: Session): Record<string, string> =>
  s.apiKey.split('.').length === 3 ? { authorization: `Bearer ${s.apiKey}` } : { 'x-api-key': s.apiKey };

async function call<T>(s: Session, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(s.baseUrl + path, {
    ...init, headers: { 'content-type': 'application/json', ...authHeader(s), ...(init.headers ?? {}) },
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
  audit: (s: Session, qs: string) => call<AuditPage>(s, `/audit?${qs}`),
  auditSummary: (s: Session, explain: boolean) => call<SummaryResponse>(s, `/audit/summary?explain=${explain}`),
  auditSummarySynthetic: (s: Session, scenario: 'normal' | 'incident', explain: boolean) =>
    call<SummaryResponse>(s, `/audit/summary/synthetic?scenario=${scenario}&explain=${explain}`),
  /** Downloads the NDJSON export (hash-chained, verifiable offline). */
  exportAudit: async (s: Session): Promise<Blob> => {
    const res = await fetch(`${s.baseUrl}/audit/export`, { headers: authHeader(s) });
    if (!res.ok) throw new Error(`${res.status}`);
    return res.blob();
  },
  verifyAudit: (s: Session) => call<{ ok: boolean; brokenAt?: number }>(s, '/audit/verify'),
  policy: (s: Session) => call<Policy>(s, '/policy'),
  publishPolicy: (s: Session, body: PolicyBody) => call<Policy>(s, '/policy', { method: 'POST', body: JSON.stringify(body) }),
  ingest: (s: Session, body: unknown) => call<{ created: string[]; skipped: number }>(s, '/ingest', { method: 'POST', body: JSON.stringify(body) }),
};
