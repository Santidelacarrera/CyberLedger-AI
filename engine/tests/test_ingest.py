import httpx
from fastapi.testclient import TestClient

from app.ingest.ai_telemetry import detect_token_drift, scan_text
from app.ingest.cost import parse_cost_explorer, parse_inventory_csv
from app.ingest.sarif import parse_sarif
from app.ingest.trivy import parse_trivy
from app.llm import summarize
from app.main import app
from app.models import Action
from app.correlate import analyze
from app.models import AnalyzeRequest, Resource

SARIF = {"runs": [{"tool": {"driver": {"rules": [{"id": "R1", "properties": {"security-severity": "9.1"}}]}},
                   "results": [{"ruleId": "R1", "message": {"text": "SQLi"}, "properties": {"resourceId": "api"}},
                               {"ruleId": "X", "level": "note", "message": {"text": "style"}}]}]}
TRIVY = {"ArtifactName": "api", "Results": [{"Vulnerabilities": [
    {"VulnerabilityID": "CVE-1", "PkgName": "openssl", "Severity": "CRITICAL", "CVSS": {"nvd": {"V3Score": 9.8}}},
    {"VulnerabilityID": "CVE-2", "PkgName": "zlib", "Severity": "LOW"}]}]}
CE = {"ResultsByTime": [{"Groups": [{"Keys": ["api"], "Metrics": {"UnblendedCost": {"Amount": "900"}}},
                                    {"Keys": ["ghost"], "Metrics": {"UnblendedCost": {"Amount": "50"}}}]},
                        {"Groups": [{"Keys": ["api"], "Metrics": {"UnblendedCost": {"Amount": "1100"}}}]}]}
CSV = "resource_id,monthly_cost,utilization,cheaper_instance_type,cheaper_monthly_cost,production\napi,0,0.1,m5.large,400,true\n"


def test_sarif_trivy():
    f = parse_sarif(SARIF)
    assert f[0].cvss == 9.1 and f[0].resource_id == "api" and f[1].cvss == 2.5
    t = parse_trivy(TRIVY)
    assert [x.cvss for x in t] == [9.8, 2.0]


def test_cost_and_csv():
    assert parse_cost_explorer(CE) == {"api": 1000.0, "ghost": 25.0}
    assert parse_inventory_csv(CSV)[0].cheaper_monthly_cost == 400


def test_key_scan_redacts():
    key = "sk-ant-" + "a" * 30
    f = scan_text(f"export K={key}", "repo/.env")
    assert len(f) == 1 and key not in f[0].title and f[0].cvss == 9.0


def test_token_drift():
    assert detect_token_drift([10, 11, 9, 10, 12], "k") is None
    res, f = detect_token_drift([10, 11, 9, 10, 90], "k")
    assert res.kind == "llm_usage" and f[0].cvss > 7
    p = analyze(AnalyzeRequest(resource=res, findings=f))
    assert p.action == Action.THROTTLE_LLM and p.monthly_savings > 0


def test_ingest_end_to_end():
    c = TestClient(app)
    body = {"inventory_csv": CSV, "cost_explorer": CE, "sarif": [SARIF], "trivy": [TRIVY],
            "text_scans": {"repo/.env": "AKIA" + "A" * 16}, "remediation_cost": 300}
    r = c.post("/ingest", json=body).json()
    top = r["proposals"][0]
    assert top["action"] == "patch_and_rightsize" and top["monthly_savings"] == 600
    actions = {p["resource_id"]: p["action"] for p in r["proposals"]}
    assert actions["repo/.env"] == "revoke_identity"
    assert r["approvals_required"] >= 1 and r["total_monthly_savings"] >= 600


def test_llm_fallback_and_ollama(monkeypatch):
    p = analyze(AnalyzeRequest(resource=Resource(id="a", monthly_cost=10, utilization=0.05, production=False)))
    assert summarize(p) is None
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    ok = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"response": " done "})))
    assert summarize(p, ok) == "done"
    bad = httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(500)))
    assert summarize(p, bad) is None
