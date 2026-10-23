export interface Proposal {
  resource_id: string; action: string; security_risk: number; financial_waste: number; net_risk: number;
  monthly_savings: number; one_off_cost: number; payback_months: number | null; requires_approval: boolean;
  rationale: string; terraform_diff: string; terraform_target?: string | null; llm_summary?: string | null;
}
export interface Approval { user: string; role: string; at: string }
export interface ActionRecord {
  id: string; proposal: Proposal; status: string; requiredRoles: string[]; approvals: Approval[];
  error?: string | null; createdAt: string;
}
export interface Summary { pending: number; pendingSavings: number; realizedSavings: number; byStatus: Record<string, number> }
export interface Session { baseUrl: string; apiKey: string }
export interface AuditEntry { seq: number; at: string; actor: string; event: string; subject?: string; hash: string }
export interface PolicyBody { dualControlActions: string[]; blockedActions: string[]; secopsRiskThreshold: number }
export interface Policy { version: number; createdAt: string; createdBy: string; body: PolicyBody }
export type Severity = 'info' | 'notice' | 'warning' | 'critical';
export interface AuditPage { items: AuditEntry[]; total: number; limit: number; offset: number }
export interface AuditFilters { event?: string; actor?: string; severity?: Severity | ''; from?: string; to?: string }
export interface Anomaly { code: string; severity: 'low' | 'medium' | 'high'; message: string; seqs: number[] }
export interface EventSummary {
  period_start: string | null; period_end: string | null; total_events: number;
  by_event: Record<string, number>; by_actor: Record<string, number>; by_severity: Record<string, number>;
  actions: { created: number; approved: number; rejected: number; done: number; failed: number; rolled_back: number; blocked_by_policy: number };
  median_decision_seconds: number | null; failure_reasons: string[]; anomalies: Anomaly[];
  risk_level: 'low' | 'medium' | 'high'; narrative: string; narrative_source: 'rules' | 'llm';
}
export interface SummaryResponse { source: 'audit_log' | 'synthetic'; scenario?: string; eventsAnalyzed: number; truncated: boolean; summary: EventSummary }
