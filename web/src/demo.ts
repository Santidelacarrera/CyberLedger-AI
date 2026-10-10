/** Sample telemetry so a fresh install shows the full flow without cloud credentials. */
const trivy = { ArtifactName: 'payments-api', Results: [{ Vulnerabilities: [
  { VulnerabilityID: 'CVE-2024-3094', PkgName: 'xz-utils', Severity: 'CRITICAL', CVSS: { nvd: { V3Score: 9.8 } } }] }] };
const sarif = { runs: [{ tool: { driver: { rules: [{ id: 'sql-injection', properties: { 'security-severity': '8.8' } }] } },
  results: [{ ruleId: 'sql-injection', message: { text: 'SQL injection in /orders' }, properties: { resourceId: 'orders-svc', exposure: 0.9 } }] }] };
const ce = { ResultsByTime: [{ Groups: [
  ['payments-api', 1800], ['orders-svc', 700], ['batch-staging', 420], ['analytics-etl', 950], ['ghost-vm-17', 130]]
  .map(([k, v]) => ({ Keys: [k], Metrics: { UnblendedCost: { Amount: String(v) } } })) }] };
const inventory_csv = [
  'resource_id,monthly_cost,utilization,cheaper_instance_type,cheaper_monthly_cost,production,kind,idle_days',
  'payments-api,0,0.10,m5.large,650,true,compute,0',
  'orders-svc,0,0.72,,,true,compute,0',
  'batch-staging,0,0.04,,,false,compute,0',
  'analytics-etl,0,0.22,r5.large,380,true,compute,0',
  'svc-old-deploy-key,0,0,,,true,identity,140',
].join('\n');

export const DEMO_INGEST = {
  inventory_csv, cost_explorer: ce, trivy: [trivy], sarif: [sarif], exposure: 0.8, remediation_cost: 250,
  text_scans: { 'repo/payments/.env.bak': 'ANTHROPIC_API_KEY=sk-ant-' + 'x'.repeat(40) },
  llm_usage: { 'key-chatbot-prod': [38, 41, 40, 39, 42, 44, 310] },
};
