"""Risk x Cost correlation: decides patch / rightsize / replace / destroy."""
from .models import Action, AnalyzeRequest, Proposal

IDLE_UTILIZATION = 0.15
OVERSIZED_UTILIZATION = 0.30
CRITICAL_RISK = 0.7


def security_risk(req: AnalyzeRequest) -> float:
    """Max over findings of (cvss/10) * (0.5 + 0.5*exposure), in [0, 1]."""
    base = 0.0
    r = req.resource
    if r.kind in ("identity", "secret"):  # stale credentials are a risk even without a scanner finding
        base = min(r.idle_days / 180, 1.0) * 0.5
    if not req.findings:
        return base
    return max(base, *((f.cvss / 10) * (0.5 + 0.5 * f.exposure) for f in req.findings))


def financial_waste(req: AnalyzeRequest) -> float:
    """Share of monthly spend that is unused capacity, in [0, 1]."""
    r = req.resource
    return round(1 - r.utilization, 4) if r.monthly_cost > 0 else 0.0


def net_risk(sec: float, waste: float) -> float:
    """Integrated net risk: security weighted 70%, waste 30%."""
    return round(0.7 * sec + 0.3 * waste, 4)


def _decide(req: AnalyzeRequest, sec: float) -> tuple[Action, str]:
    r = req.resource
    if r.kind in ("identity", "secret"):
        if r.idle_days >= 90 or sec >= CRITICAL_RISK:
            return Action.REVOKE_IDENTITY, f"{r.kind} inactive {r.idle_days}d / high risk"
        return Action.NO_ACTION, "identity in use and low risk"
    if r.kind == "llm_usage":
        if sec >= 0.4:
            return Action.THROTTLE_LLM, "LLM token drift / key abuse: rotate key and apply spend cap"
        return Action.NO_ACTION, "LLM usage within baseline"
    cheaper = r.cheaper_monthly_cost is not None and r.cheaper_monthly_cost < r.monthly_cost
    if r.utilization <= IDLE_UTILIZATION and sec < 0.3 and not r.production:
        return Action.DESTROY, "idle, low-risk, non-production resource (ghost)"
    if sec >= CRITICAL_RISK:
        if r.utilization <= OVERSIZED_UTILIZATION and cheaper:
            return Action.PATCH_AND_RIGHTSIZE, "critical risk on oversized resource: patch + downsize in one action"
        return Action.PATCH_IN_PLACE, "critical risk on a well-used resource: patch, keep capacity"
    if r.utilization <= OVERSIZED_UTILIZATION and cheaper:
        return Action.REPLACE_CHEAPER, "oversized resource: replace with cheaper instance"
    if sec >= 0.4:
        return Action.PATCH_IN_PLACE, "moderate risk: patch"
    return Action.NO_ACTION, "risk and waste within tolerance"


def _savings(req: AnalyzeRequest, action: Action) -> float:
    r = req.resource
    if action == Action.DESTROY:
        return r.monthly_cost
    if action == Action.THROTTLE_LLM:
        return max(r.monthly_cost - (r.baseline_monthly_cost or 0.0), 0.0)
    if action in (Action.PATCH_AND_RIGHTSIZE, Action.REPLACE_CHEAPER):
        return max(r.monthly_cost - (r.cheaper_monthly_cost or r.monthly_cost), 0.0)
    return 0.0


def _diff(req: AnalyzeRequest, action: Action) -> str:
    r = req.resource
    h = f"# dry-run: {action.value} on {r.id}\n"
    if action in (Action.PATCH_AND_RIGHTSIZE, Action.REPLACE_CHEAPER):
        return h + f'  resource "aws_instance" "{r.id}" {{\n-   instance_type = "{r.instance_type}"\n+   instance_type = "{r.cheaper_instance_type}"\n  }}\n'
    if action == Action.DESTROY:
        return h + f'- resource "aws_instance" "{r.id}" {{ ... }}\n'
    if action == Action.REVOKE_IDENTITY:
        return h + f'- resource "aws_iam_access_key" "{r.id}" {{ ... }}\n'
    if action == Action.THROTTLE_LLM:
        return h + f'  resource "llm_budget" "{r.id}" {{\n-   monthly_cap_usd = null\n+   monthly_cap_usd = {r.baseline_monthly_cost or 0}\n+   rotate_key      = true\n  }}\n'
    if action == Action.PATCH_IN_PLACE:
        return h + f'  resource "aws_instance" "{r.id}" {{\n-   ami = "<vulnerable>"\n+   ami = "<patched>"\n  }}\n'
    return h + "  (no changes)\n"


def _target(req: AnalyzeRequest, action: Action) -> str | None:
    r = req.resource
    if action == Action.NO_ACTION:
        return None
    if action == Action.REVOKE_IDENTITY:
        return f"aws_iam_access_key.{r.id}"
    if action == Action.THROTTLE_LLM:
        return f"llm_budget.{r.id}"
    return f"aws_instance.{r.id}"


def analyze(req: AnalyzeRequest) -> Proposal:
    sec = round(security_risk(req), 4)
    waste = financial_waste(req)
    action, why = _decide(req, sec)
    savings = round(_savings(req, action), 2)
    cost = req.remediation_cost
    payback = round(cost / savings, 2) if savings > 0 and cost > 0 else (0.0 if savings > 0 else None)
    return Proposal(
        resource_id=req.resource.id, action=action, security_risk=sec,
        financial_waste=waste, net_risk=net_risk(sec, waste),
        monthly_savings=savings, one_off_cost=cost, payback_months=payback,
        requires_approval=action != Action.NO_ACTION,  # human-in-the-loop always
        rationale=why, terraform_diff=_diff(req, action), terraform_target=_target(req, action),
    )
