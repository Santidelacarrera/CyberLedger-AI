import type { AuditFilters, Severity } from './types';

/** Mirrors api/src/audit/events.ts (unknown events are "info"). */
const SEVERITY: Record<string, Severity> = {
  'action.rolled_back': 'critical', 'action.failed': 'warning', 'action.rejected': 'warning',
  'action.blocked_by_policy': 'warning', 'policy.published': 'notice',
};
export const severityOf = (event: string): Severity => SEVERITY[event] ?? 'info';

export const EVENT_TYPES = [
  'ingest', 'collect.aws', 'policy.published', 'action.created', 'action.approved', 'action.rejected', 'action.queued',
  'action.executing', 'action.done', 'action.failed', 'action.rolled_back', 'action.dry_run', 'action.blocked_by_policy',
];

/** Query string with only the filters that are set; dates (yyyy-mm-dd) become inclusive UTC day bounds. */
export function auditQuery(f: AuditFilters, limit: number, offset: number): string {
  const p = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (f.event) p.set('event', f.event);
  if (f.actor?.trim()) p.set('actor', f.actor.trim());
  if (f.severity) p.set('severity', f.severity);
  if (f.from) p.set('from', `${f.from}T00:00:00.000Z`);
  if (f.to) p.set('to', `${f.to}T23:59:59.999Z`);
  return p.toString();
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  if (seconds < 90) return `${Math.round(seconds)} s`;
  if (seconds < 5400) return `${(seconds / 60).toFixed(1)} min`;
  return `${(seconds / 3600).toFixed(1)} h`;
}

export const pageLabel = (offset: number, shown: number, total: number) =>
  total === 0 ? '0 de 0' : `${offset + 1}–${offset + shown} de ${total}`;
