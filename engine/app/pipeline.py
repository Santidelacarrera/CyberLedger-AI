"""Combines inventory + billing + findings into ranked, approval-gated proposals."""
from collections import defaultdict

from .correlate import CRITICAL_RISK, analyze
from .models import AnalyzeRequest, Finding, Portfolio, Resource


def run_pipeline(resources: list[Resource], findings: list[Finding], remediation_cost: float = 0.0) -> Portfolio:
    by_res: dict[str, list[Finding]] = defaultdict(list)
    for f in findings:
        by_res[f.resource_id].append(f)
    # findings for resources missing from inventory still matter: assume unknown cost, in use
    known = {r.id for r in resources}
    leaked = lambda rid: any(f.title.startswith("Leaked ") for f in by_res[rid])  # noqa: E731
    resources = list(resources) + [Resource(id=rid, kind="secret" if leaked(rid) else "compute",
                                            monthly_cost=0, utilization=0.5)
                                   for rid in by_res if rid not in known]
    proposals = [analyze(AnalyzeRequest(resource=r, findings=by_res.get(r.id, []), remediation_cost=remediation_cost))
                 for r in resources]
    proposals.sort(key=lambda p: (p.net_risk, p.monthly_savings), reverse=True)
    return Portfolio(
        proposals=proposals,
        total_monthly_savings=round(sum(p.monthly_savings for p in proposals), 2),
        critical_count=sum(p.security_risk >= CRITICAL_RISK for p in proposals),
        approvals_required=sum(p.requires_approval for p in proposals),
    )
