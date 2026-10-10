"""Trivy JSON report -> Findings. Resource id = ArtifactName (or Target when absent)."""
from app.models import Finding

_SEV_CVSS = {"CRITICAL": 9.5, "HIGH": 7.5, "MEDIUM": 5.0, "LOW": 2.0, "UNKNOWN": 3.0}


def _cvss(v: dict) -> float:
    best = 0.0
    for src in (v.get("CVSS") or {}).values():
        best = max(best, float(src.get("V3Score") or 0))
    return best or _SEV_CVSS.get(v.get("Severity", "UNKNOWN"), 3.0)


def parse_trivy(doc: dict, exposure: float = 0.5) -> list[Finding]:
    rid = doc.get("ArtifactName", "unknown")
    out: list[Finding] = []
    for result in doc.get("Results", []) or []:
        for v in result.get("Vulnerabilities", []) or []:
            out.append(Finding(resource_id=rid, title=f'{v.get("VulnerabilityID")} in {v.get("PkgName")}',
                               cvss=_cvss(v), exposure=exposure))
        for m in result.get("Misconfigurations", []) or []:
            out.append(Finding(resource_id=rid, title=m.get("Title", "misconfiguration"),
                               cvss=_SEV_CVSS.get(m.get("Severity", "UNKNOWN"), 3.0), exposure=exposure))
    return out
