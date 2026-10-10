from fastapi import FastAPI

from .correlate import analyze
from .models import AnalyzeRequest, Proposal

app = FastAPI(title="CyberLedger Engine")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/analyze", response_model=Proposal)
def analyze_endpoint(req: AnalyzeRequest) -> Proposal:
    return analyze(req)
