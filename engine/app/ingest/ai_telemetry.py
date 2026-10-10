"""AI-key leak detection and LLM token-drift monitoring."""
import re
import statistics

from app.models import Finding, Resource

KEY_PATTERNS = {
    "anthropic": re.compile(r"sk-ant-[A-Za-z0-9_\-]{20,}"),
    "openai": re.compile(r"sk-(?:proj-)?[A-Za-z0-9_\-]{32,}"),
    "google": re.compile(r"AIza[0-9A-Za-z_\-]{35}"),
    "huggingface": re.compile(r"hf_[A-Za-z0-9]{30,}"),
    "aws": re.compile(r"AKIA[0-9A-Z]{16}"),
}


def redact(secret: str) -> str:
    return secret[:6] + "…" + secret[-2:]


def scan_text(text: str, source: str) -> list[Finding]:
    """Secrets are never returned in clear: titles carry only a redacted preview."""
    out, seen = [], set()
    for provider, pat in KEY_PATTERNS.items():
        for m in pat.finditer(text):
            if m.group(0) in seen:
                continue
            seen.add(m.group(0))
            out.append(Finding(resource_id=source, title=f"Leaked {provider} key {redact(m.group(0))}",
                               cvss=9.0, exposure=1.0))
    return out


def detect_token_drift(daily_cost: list[float], key_id: str, min_ratio: float = 3.0, sigma: float = 3.0
                       ) -> tuple[Resource, list[Finding]] | None:
    """daily_cost: USD/day, last element = today. Drift if today > max(mean+sigma*sd, min_ratio*mean)."""
    if len(daily_cost) < 4:
        return None
    base, today = daily_cost[:-1], daily_cost[-1]
    mean = statistics.fmean(base)
    sd = statistics.pstdev(base)
    if mean <= 0 or today <= max(mean + sigma * sd, min_ratio * mean):
        return None
    ratio = today / mean
    cvss = min(5.0 + ratio, 9.5)
    res = Resource(id=key_id, kind="llm_usage", monthly_cost=round(today * 30, 2), utilization=1.0,
                   baseline_monthly_cost=round(mean * 30, 2))
    return res, [Finding(resource_id=key_id, title=f"LLM spend drift x{ratio:.1f} vs baseline",
                         cvss=cvss, exposure=0.7)]
