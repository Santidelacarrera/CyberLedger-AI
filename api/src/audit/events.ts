/** Event taxonomy of the audit trail. Keep in sync with engine/app/eventlog.py (SEVERITY) and docs/EVENT_LOG.md. */
export type Severity = 'info' | 'notice' | 'warning' | 'critical';

export const EVENT_SEVERITY: Record<string, Severity> = {
  'action.rolled_back': 'critical',
  'action.failed': 'warning',
  'action.rejected': 'warning',
  'action.blocked_by_policy': 'warning',
  'policy.published': 'notice',
};

export const KNOWN_EVENTS = [
  'ingest', 'collect.aws', 'policy.published',
  'action.created', 'action.approved', 'action.rejected', 'action.queued', 'action.executing',
  'action.done', 'action.failed', 'action.rolled_back', 'action.dry_run', 'action.blocked_by_policy',
] as const;

export const severityOf = (event: string): Severity => EVENT_SEVERITY[event] ?? 'info';

/** Event names of a severity; `info` is "everything not listed above" so new event types default to info. */
export const eventsWithSeverity = (s: Severity): { in?: string[]; notIn?: string[] } =>
  s === 'info'
    ? { notIn: Object.keys(EVENT_SEVERITY) }
    : { in: Object.entries(EVENT_SEVERITY).filter(([, v]) => v === s).map(([k]) => k) };
