from fastapi.testclient import TestClient

from app.correlate import analyze
from app.main import app
from app.models import Action, AnalyzeRequest, Finding, Resource


def req(util=0.1, cvss=9.5, exposure=1.0, production=True, **kw):
    return AnalyzeRequest(
        resource=Resource(id="svc", monthly_cost=1000, utilization=util, production=production,
                          cheaper_instance_type="m5.large", cheaper_monthly_cost=400, **kw),
        findings=[Finding(resource_id="svc", title="RCE", cvss=cvss, exposure=exposure)] if cvss else [],
        remediation_cost=600,
    )


def test_critical_oversized_patches_and_rightsizes():
    p = analyze(req())
    assert p.action == Action.PATCH_AND_RIGHTSIZE
    assert p.monthly_savings == 600 and p.payback_months == 1.0
    assert p.requires_approval and "m5.large" in p.terraform_diff


def test_critical_busy_only_patches():
    p = analyze(req(util=0.8))
    assert p.action == Action.PATCH_IN_PLACE and p.monthly_savings == 0


def test_idle_nonprod_is_destroyed():
    p = analyze(req(util=0.05, cvss=0, production=False))
    assert p.action == Action.DESTROY and p.monthly_savings == 1000


def test_stale_identity_revoked():
    r = AnalyzeRequest(resource=Resource(id="k", kind="identity", monthly_cost=0, utilization=0, idle_days=120))
    assert analyze(r).action == Action.REVOKE_IDENTITY


def test_healthy_no_action_needs_no_approval():
    p = analyze(req(util=0.7, cvss=0))
    assert p.action == Action.NO_ACTION and not p.requires_approval


def test_api():
    c = TestClient(app)
    assert c.get("/health").json() == {"status": "ok"}
    assert c.post("/analyze", json=req().model_dump(mode="json")).json()["action"] == "patch_and_rightsize"


def test_stale_identity_has_nonzero_risk():
    p = analyze(AnalyzeRequest(resource=Resource(id="k", kind="identity", monthly_cost=0, utilization=0, idle_days=180)))
    assert p.security_risk == 0.5
