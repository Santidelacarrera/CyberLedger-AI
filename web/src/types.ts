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
