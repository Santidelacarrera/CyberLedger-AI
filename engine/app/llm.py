"""Optional LLM narrative for a proposal. The LLM never chooses the action: decisions stay deterministic
and auditable; the model only explains them. Any failure falls back to the rule-based rationale."""
import os

import httpx

from .models import Proposal


def _prompt(p: Proposal) -> str:
    return (
        "You are a SecOps/FinOps analyst. In at most 3 sentences, explain to an approver why this action is "
        "proposed, its security benefit, its financial impact and the main rollback risk. Do not invent data.\n"
        f"resource={p.resource_id} action={p.action.value} security_risk={p.security_risk} "
        f"waste={p.financial_waste} monthly_savings_usd={p.monthly_savings} payback_months={p.payback_months}\n"
        f"rule_rationale={p.rationale}\ndiff:\n{p.terraform_diff}"
    )


def summarize(p: Proposal, client: httpx.Client | None = None) -> str | None:
    provider = os.getenv("LLM_PROVIDER", "none").lower()
    if provider == "none":
        return None
    c = client or httpx.Client(timeout=20)
    try:
        if provider == "ollama":
            r = c.post(os.getenv("OLLAMA_URL", "http://localhost:11434") + "/api/generate",
                       json={"model": os.getenv("LLM_MODEL", "llama3.1"), "prompt": _prompt(p), "stream": False})
            r.raise_for_status()
            return r.json()["response"].strip()
        if provider == "anthropic":
            r = c.post("https://api.anthropic.com/v1/messages",
                       headers={"x-api-key": os.environ["ANTHROPIC_API_KEY"], "anthropic-version": "2023-06-01"},
                       json={"model": os.getenv("LLM_MODEL", "claude-haiku-5-5"), "max_tokens": 300,
                             "messages": [{"role": "user", "content": _prompt(p)}]})
            r.raise_for_status()
            return r.json()["content"][0]["text"].strip()
    except (httpx.HTTPError, KeyError, IndexError, ValueError):
        return None
    return None
