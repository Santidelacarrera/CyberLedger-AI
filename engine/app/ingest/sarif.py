"""SARIF 2.1.0 (Semgrep, CodeQL, Trivy --format sarif) -> Findings."""
from app.models import Finding

_LEVEL_CVSS = {"error": 8.0, "warning": 5.5, "note": 2.5, "none": 0.0}


def _rule_index(run: dict) -> dict:
    rules = run.get("tool", {}).get("driver", {}).get("rules", []) or []
    return {r.get("id"): r for r in rules}


def parse_sarif(doc: dict, default_resource: str = "unknown", exposure: float = 0.5) -> list[Finding]:
    out: list[Finding] = []
    for run in doc.get("runs", []):
        rules = _rule_index(run)
        for res in run.get("results", []):
            rule = rules.get(res.get("ruleId"), {})
            sev = (rule.get("properties", {}) or {}).get("security-severity")
            try:
                cvss = float(sev) if sev is not None else _LEVEL_CVSS.get(res.get("level", "warning"), 5.5)
            except ValueError:
                cvss = _LEVEL_CVSS.get(res.get("level", "warning"), 5.5)
            props = res.get("properties", {}) or {}
            rid = props.get("resourceId") or default_resource
            title = (res.get("message", {}) or {}).get("text") or res.get("ruleId") or "finding"
            out.append(Finding(resource_id=rid, title=title[:200], cvss=min(max(cvss, 0), 10),
                               exposure=float(props.get("exposure", exposure))))
    return out
