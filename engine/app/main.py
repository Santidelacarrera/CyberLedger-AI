
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from .correlate import analyze
from .eventlog import AuditEvent, EventSummary, summarize_events
from .ingest.ai_telemetry import detect_token_drift, scan_text
from .ingest.aws import collect_ec2, collect_iam_keys
from .ingest.cost import apply_costs, parse_cost_explorer, parse_inventory_csv
from .ingest.sarif import parse_sarif
from .ingest.trivy import parse_trivy
from .llm import narrate_events, summarize
from .models import AnalyzeRequest, Finding, Portfolio, Proposal, Resource
from .pipeline import run_pipeline
from .synthetic import generate

app = FastAPI(title="CyberLedger Engine")


class IngestRequest(BaseModel):
    inventory_csv: str | None = None
    inventory: list[Resource] = []
    cost_explorer: dict | None = None
    sarif: list[dict] = []
    sarif_resource: str = "unknown"
    trivy: list[dict] = []
    exposure: float = Field(default=0.5, ge=0, le=1)
    text_scans: dict[str, str] = Field(default={}, description="source -> text to scan for leaked AI/cloud keys")
    llm_usage: dict[str, list[float]] = Field(default={}, description="key id -> daily USD cost, last = today")
    remediation_cost: float = Field(default=0, ge=0)
    explain: bool = False


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/analyze", response_model=Proposal)
def analyze_endpoint(req: AnalyzeRequest) -> Proposal:
    p = analyze(req)
    p.llm_summary = summarize(p)
    return p


@app.post("/ingest", response_model=Portfolio)
def ingest(req: IngestRequest) -> Portfolio:
    resources = list(req.inventory) + (parse_inventory_csv(req.inventory_csv) if req.inventory_csv else [])
    if req.cost_explorer:
        resources = apply_costs(resources, parse_cost_explorer(req.cost_explorer))
    findings: list[Finding] = []
    for doc in req.sarif:
        findings += parse_sarif(doc, req.sarif_resource, req.exposure)
    for doc in req.trivy:
        findings += parse_trivy(doc, req.exposure)
    for source, text in req.text_scans.items():
        findings += scan_text(text, source)
    for key_id, series in req.llm_usage.items():
        drift = detect_token_drift(series, key_id)
        if drift:
            resources.append(drift[0])
            findings += drift[1]
    portfolio = run_pipeline(resources, findings, req.remediation_cost)
    if req.explain:
        for p in portfolio.proposals:
            if p.requires_approval:
                p.llm_summary = summarize(p)
    return portfolio


class CollectAwsRequest(BaseModel):
    days: int = Field(default=14, ge=1, le=90)
    include_iam: bool = True
    remediation_cost: float = Field(default=0, ge=0)


@app.post("/collect/aws", response_model=Portfolio)
def collect_aws(req: CollectAwsRequest) -> Portfolio:
    """Pulls live inventory/cost/metrics with the service's own AWS credentials (read-only)."""
    try:
        resources = collect_ec2(days=req.days) + (collect_iam_keys() if req.include_iam else [])
    except (BotoCoreError, ClientError) as e:
        raise HTTPException(502, f"AWS collection failed: {type(e).__name__}: {e}") from e
    return run_pipeline(resources, [], req.remediation_cost)


class SummarizeEventsRequest(BaseModel):
    events: list[AuditEvent] = Field(max_length=5000)
    explain: bool = Field(default=False, description="ask the (local) LLM to rewrite the narrative")


@app.post("/summarize/events", response_model=EventSummary)
def summarize_events_endpoint(req: SummarizeEventsRequest) -> EventSummary:
    """Deterministic summary + anomaly detection of an audit-event list; optional guarded LLM narrative."""
    return summarize_events(req.events, narrate_fn=narrate_events if req.explain else None)


@app.get("/synthetic/events")
def synthetic_events(seed: int = 7, days: int = 14, scenario: str = "normal") -> list[dict]:
    return generate(seed, min(max(days, 1), 60), "incident" if scenario == "incident" else "normal")
