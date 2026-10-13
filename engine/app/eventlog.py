"""Event-log analytics: deterministic summary + anomaly rules over the platform's audit trail.

Everything numeric is computed here with plain rules, so the result is reproducible and auditable. A local
LLM may only rephrase the facts (see `narrate`); its output is discarded if it states numbers that are not
in the computed summary."""
import re
import statistics
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from pydantic import BaseModel, Field

from .ingest.ai_telemetry import KEY_PATTERNS

SYSTEM_ACTORS = {"system", "scheduler"}
SEVERITY = {  # unknown events default to "info"
    "action.rolled_back": "critical", "action.failed": "warning", "action.rejected": "warning",
    "action.blocked_by_policy": "warning", "policy.published": "notice",
}
OFF_HOURS = (22, 6)  # UTC: human decisions between 22:00 and 06:00 are flagged
FAST_APPROVAL_SECONDS = 10
STUCK_AFTER = timedelta(hours=72)


class AuditEvent(BaseModel):
    seq: int
    at: datetime
    actor: str
    event: str
    subject: str | None = None
    data: dict = Field(default_factory=dict)


class Anomaly(BaseModel):
    code: str
    severity: str  # low | medium | high
    message: str
    seqs: list[int] = []


class ActionCounts(BaseModel):
    created: int = 0
    approved: int = 0
    rejected: int = 0
    done: int = 0
    failed: int = 0
    rolled_back: int = 0
    blocked_by_policy: int = 0


class EventSummary(BaseModel):
    period_start: datetime | None
    period_end: datetime | None
    total_events: int
    by_event: dict[str, int]
    by_actor: dict[str, int]
    by_severity: dict[str, int]
    actions: ActionCounts
    median_decision_seconds: float | None
    failure_reasons: list[str]
    anomalies: list[Anomaly]
    risk_level: str
    narrative: str
    narrative_source: str = "rules"


def severity_of(event: str) -> str:
    return SEVERITY.get(event, "info")


def scrub(text: str, limit: int = 80) -> str:
    """Event payloads may carry error text: strip anything that looks like a credential, then truncate."""
    for pat in KEY_PATTERNS.values():
        text = pat.sub("[REDACTED]", text)
    return text[:limit]


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _off_hours(dt: datetime) -> bool:
    h = _utc(dt).hour
    return h >= OFF_HOURS[0] or h < OFF_HOURS[1]


def _decision_seconds(events: list[AuditEvent]) -> list[float]:
    created: dict[str, datetime] = {}
    out: list[float] = []
    for e in events:
        if not e.subject:
            continue
        if e.event == "action.created":
            created[e.subject] = e.at
        elif e.event in ("action.approved", "action.rejected") and e.subject in created:
            out.append((e.at - created.pop(e.subject)).total_seconds())  # first decision only
    return out


def detect_anomalies(events: list[AuditEvent], now: datetime | None = None) -> list[Anomaly]:
    out: list[Anomaly] = []
    by_subject: dict[str, list[AuditEvent]] = defaultdict(list)
    for e in events:
        if e.subject:
            by_subject[e.subject].append(e)

    rolled = [e for e in events if e.event == "action.rolled_back"]
    if rolled:
        out.append(Anomaly(code="ROLLBACK", severity="high", seqs=[e.seq for e in rolled],
                           message=f"{len(rolled)} acción(es) revertida(s) tras fallar el healthcheck."))
    repeated = {subj: [e for e in evs if e.event == "action.failed"] for subj, evs in by_subject.items()}
    repeated = {k: v for k, v in repeated.items() if len(v) >= 2}
    if repeated:
        out.append(Anomaly(code="REPEATED_FAILURE", severity="high", seqs=sorted(e.seq for v in repeated.values() for e in v),
                           message=f"{len(repeated)} acción(es) fallaron 2 o más veces (p. ej. {next(iter(repeated))[:8]})."))

    created_at = {e.subject: e.at for e in events if e.event == "action.created" and e.subject}
    approvals = [e for e in events if e.event == "action.approved"]
    fast = [e for e in approvals if e.subject in created_at
            and 0 <= (e.at - created_at[e.subject]).total_seconds() < FAST_APPROVAL_SECONDS]
    if fast:
        out.append(Anomaly(code="FAST_APPROVAL", severity="medium", seqs=[e.seq for e in fast],
                           message=f"{len(fast)} aprobación(es) en menos de {FAST_APPROVAL_SECONDS}s: posible aprobación sin revisión."))

    off = [e for e in events if e.actor not in SYSTEM_ACTORS and e.event in ("action.approved", "action.rejected")
           and _off_hours(e.at)]
    if off:
        out.append(Anomaly(code="OFF_HOURS_DECISION", severity="medium", seqs=[e.seq for e in off],
                           message=f"{len(off)} decisión(es) humana(s) fuera de horario (22:00-06:00 UTC)."))

    by_role: dict[str, list[AuditEvent]] = defaultdict(list)
    for e in approvals:
        if e.actor not in SYSTEM_ACTORS:
            by_role[str(e.data.get("role", "any"))].append(e)
    for role, evs in sorted(by_role.items()):
        actor, n = Counter(e.actor for e in evs).most_common(1)[0]
        if len(evs) >= 5 and n / len(evs) >= 0.8:
            out.append(Anomaly(code="APPROVER_CONCENTRATION", severity="medium", seqs=[e.seq for e in evs if e.actor == actor],
                               message=f"{actor} concentra el {round(100 * n / len(evs))}% de las aprobaciones de {role} ({n}/{len(evs)})."))

    pol = [e for e in events if e.event == "policy.published"]
    if pol:
        out.append(Anomaly(code="POLICY_CHANGE", severity="medium", seqs=[e.seq for e in pol],
                           message=f"{len(pol)} cambio(s) de política publicado(s)."))
    blocked = [e for e in events if e.event == "action.blocked_by_policy"]
    if len(blocked) >= 3:
        out.append(Anomaly(code="POLICY_BLOCKS", severity="low", seqs=[e.seq for e in blocked],
                           message=f"{len(blocked)} propuestas bloqueadas por política."))

    ing = sorted((e for e in events if e.event in ("ingest", "collect.aws")), key=lambda e: e.at)
    for i in range(len(ing) - 4):
        if ing[i + 4].at - ing[i].at <= timedelta(minutes=10):
            out.append(Anomaly(code="INGEST_BURST", severity="low", seqs=[e.seq for e in ing[i:i + 5]],
                               message="5 o más ingestas en 10 minutos."))
            break

    ref = _utc(now) if now else (_utc(max(e.at for e in events)) if events else None)
    if ref:
        decided = {e.subject for e in events if e.event in ("action.approved", "action.rejected")}
        stuck = [s for s, at in created_at.items() if s not in decided and ref - _utc(at) > STUCK_AFTER]
        if stuck:
            out.append(Anomaly(code="STUCK_PENDING", severity="medium", seqs=[],
                               message=f"{len(stuck)} acción(es) sin decisión tras más de 72h."))
    order = {"high": 0, "medium": 1, "low": 2}
    return sorted(out, key=lambda a: (order[a.severity], a.code))


def _rules_narrative(s: dict) -> str:
    a = s["actions"]
    parts = [f"Se registraron {s['total_events']} eventos"
             + (f" entre {s['period_start']:%Y-%m-%d} y {s['period_end']:%Y-%m-%d}." if s["period_start"] else ".")]
    if s["total_events"] == 0:
        return "No hay eventos en el periodo."
    parts.append(f"Acciones: {a.created} propuestas, {a.approved} aprobaciones, {a.rejected} rechazo(s), "
                 f"{a.done} completadas, {a.failed} fallidas y {a.rolled_back} revertidas.")
    if s["median_decision_seconds"] is not None:
        m = s["median_decision_seconds"]
        parts.append(f"La mediana hasta la primera decisión fue {m / 3600:.1f} h." if m >= 3600 else f"La mediana hasta la primera decisión fue {m / 60:.1f} min.")
    if s["anomalies"]:
        parts.append(f"Nivel de riesgo {s['risk_level'].upper()}: " + " ".join(x.message for x in s["anomalies"][:4]))
    else:
        parts.append("Nivel de riesgo BAJO: sin anomalías detectadas.")
    return " ".join(parts)


def summarize_events(events: list[AuditEvent], now: datetime | None = None, narrate_fn=None) -> EventSummary:
    events = sorted(events, key=lambda e: (e.at, e.seq))
    ev_counts = Counter(e.event for e in events)
    act = ActionCounts(
        created=ev_counts["action.created"], approved=ev_counts["action.approved"], rejected=ev_counts["action.rejected"],
        done=ev_counts["action.done"], failed=ev_counts["action.failed"], rolled_back=ev_counts["action.rolled_back"],
        blocked_by_policy=ev_counts["action.blocked_by_policy"])
    decisions = _decision_seconds(events)
    reasons = Counter(scrub(str(e.data["error"])) for e in events if e.event == "action.failed" and e.data.get("error"))
    anomalies = detect_anomalies(events, now)
    risk = "high" if any(a.severity == "high" for a in anomalies) else "medium" if any(a.severity == "medium" for a in anomalies) else "low"
    facts = dict(
        period_start=events[0].at if events else None, period_end=events[-1].at if events else None,
        total_events=len(events), by_event=dict(ev_counts.most_common()),
        by_actor=dict(Counter(e.actor for e in events).most_common()),
        by_severity=dict(Counter(severity_of(e.event) for e in events).most_common()),
        actions=act, median_decision_seconds=round(statistics.median(decisions), 1) if decisions else None,
        failure_reasons=[r for r, _ in reasons.most_common(3)], anomalies=anomalies, risk_level=risk)
    text, source = _rules_narrative(facts), "rules"
    if narrate_fn and events:
        llm = narrate_fn(facts, text)
        if llm:
            text, source = llm, "llm"
    return EventSummary(**facts, narrative=text, narrative_source=source)


_NUM = re.compile(r"\d+(?:[.,]\d+)?")


def numbers_in(text: str) -> set[str]:
    return {n.replace(",", ".").rstrip("0").rstrip(".") if "." in n.replace(",", ".") else n for n in _NUM.findall(text)}
