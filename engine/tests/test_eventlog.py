from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi.testclient import TestClient

import app.main as m
from app.eventlog import AuditEvent, detect_anomalies, scrub, severity_of, summarize_events
from app.llm import narrate_events
from app.synthetic import generate

T0 = datetime(2026, 9, 1, 10, 0, tzinfo=timezone.utc)


def ev(seq, minutes, actor, event, subject=None, data=None, seconds=0):
    return AuditEvent(seq=seq, at=T0 + timedelta(minutes=minutes, seconds=seconds), actor=actor, event=event,
                      subject=subject, data=data or {})


def codes(events, **kw):
    return {a.code for a in detect_anomalies(events, **kw)}


def test_synthetic_is_deterministic_and_seed_sensitive():
    assert generate(7, 5, "normal") == generate(7, 5, "normal")
    assert generate(7, 5, "normal") != generate(8, 5, "normal")
    assert [e["seq"] for e in generate(3, 3)] == list(range(1, len(generate(3, 3)) + 1))


def test_normal_scenario_has_no_anomalies_and_incident_is_high():
    normal = summarize_events([AuditEvent(**e) for e in generate(7, 14, "normal")])
    assert normal.risk_level == "low" and normal.anomalies == []
    assert normal.actions.failed == 0 and normal.actions.rolled_back == 0
    inc = summarize_events([AuditEvent(**e) for e in generate(7, 14, "incident")])
    assert inc.risk_level == "high"
    assert {"ROLLBACK", "REPEATED_FAILURE", "FAST_APPROVAL", "OFF_HOURS_DECISION", "APPROVER_CONCENTRATION",
            "POLICY_CHANGE", "POLICY_BLOCKS"} <= {a.code for a in inc.anomalies}
    assert inc.anomalies[0].severity == "high"  # ordered by severity


def test_counts_and_median_decision_time():
    events = [ev(1, 0, "sara", "action.created", "a"), ev(2, 30, "sara", "action.approved", "a", {"role": "secops"}),
              ev(3, 40, "fede", "action.approved", "a", {"role": "finops"}),  # second approval must not skew the median
              ev(4, 0, "sara", "action.created", "b"), ev(5, 90, "luis", "action.rejected", "b"),
              ev(6, 41, "system", "action.done", "a")]
    s = summarize_events(events)
    assert (s.actions.created, s.actions.approved, s.actions.rejected, s.actions.done) == (2, 2, 1, 1)
    assert s.median_decision_seconds == (30 * 60 + 90 * 60) / 2
    assert s.by_actor == {"sara": 3, "fede": 1, "luis": 1, "system": 1}
    assert s.period_start == T0 and s.total_events == 6


def test_each_rule_fires_alone():
    assert codes([ev(1, 0, "sara", "action.rolled_back", "a")]) == {"ROLLBACK"}
    assert codes([ev(1, 0, "system", "action.failed", "a"), ev(2, 1, "system", "action.failed", "a")]) == {"REPEATED_FAILURE"}
    assert codes([ev(1, 0, "system", "action.failed", "a")]) == set()
    assert "FAST_APPROVAL" in codes([ev(1, 0, "sara", "action.created", "a"), ev(2, 0, "luis", "action.approved", "a", seconds=3)])
    assert "FAST_APPROVAL" not in codes([ev(1, 0, "sara", "action.created", "a"), ev(2, 5, "luis", "action.approved", "a")])
    night = datetime(2026, 9, 1, 23, 30, tzinfo=timezone.utc)
    assert "OFF_HOURS_DECISION" in codes([AuditEvent(seq=1, at=night, actor="luis", event="action.approved", subject="a")])
    assert "OFF_HOURS_DECISION" not in codes([AuditEvent(seq=1, at=night, actor="system", event="action.approved", subject="a")])
    assert codes([ev(1, 0, "root", "policy.published", "3")]) == {"POLICY_CHANGE"}
    assert codes([ev(i, i, "sara", "action.blocked_by_policy", f"r{i}") for i in range(3)]) == {"POLICY_BLOCKS"}
    assert codes([ev(i, i, "sara", "ingest", f"i{i}") for i in range(5)]) == {"INGEST_BURST"}
    assert codes([ev(i, i * 30, "sara", "ingest", f"i{i}") for i in range(5)]) == set()


def test_stuck_pending_uses_period_end_or_explicit_now():
    created = [ev(1, 0, "sara", "action.created", "a")]
    assert "STUCK_PENDING" not in codes(created)  # nothing after it: reference is its own timestamp
    assert "STUCK_PENDING" in codes(created, now=T0 + timedelta(hours=73))
    assert "STUCK_PENDING" not in codes(created + [ev(2, 5, "luis", "action.approved", "a", seconds=30)], now=T0 + timedelta(days=9))


def test_concentration_is_per_role_and_needs_volume():
    def appr(n, actors):
        return [ev(i, i, actors[i % len(actors)], "action.approved", f"s{i}", {"role": "secops"}, seconds=30) for i in range(n)]
    assert "APPROVER_CONCENTRATION" in codes(appr(5, ["luis"]))
    assert "APPROVER_CONCENTRATION" not in codes(appr(4, ["luis"]))
    assert "APPROVER_CONCENTRATION" not in codes(appr(6, ["luis", "sara"]))


def test_empty_and_naive_datetimes():
    s = summarize_events([])
    assert s.total_events == 0 and s.risk_level == "low" and s.narrative == "No hay eventos en el periodo."
    naive = AuditEvent(seq=1, at=datetime(2026, 9, 1, 23, 0), actor="luis", event="action.approved", subject="a")
    assert "OFF_HOURS_DECISION" in codes([naive])  # naive timestamps are treated as UTC


def test_severity_mapping_defaults_to_info():
    assert severity_of("action.rolled_back") == "critical" and severity_of("action.failed") == "warning"
    assert severity_of("something.new") == "info"


def test_failure_reasons_are_scrubbed_and_never_leak_into_narrative():
    key = "sk-ant-" + "z" * 40
    events = [ev(1, 0, "system", "action.failed", "a", {"error": f"auth failed with {key}"}),
              ev(2, 1, "system", "action.failed", "a", {"error": "state lock held"})]
    s = summarize_events(events)
    blob = s.model_dump_json()
    assert key not in blob and "[REDACTED]" in blob
    assert scrub("x" * 500) == "x" * 80


# ---- guarded LLM narrative -------------------------------------------------------------------------------

FACTS = {"total_events": 12, "anomalies": ["ROLLBACK"]}
RULES = "Se registraron 12 eventos. Nivel de riesgo HIGH: 1 acción(es) revertida(s)."


def client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def ok(text):
    return client(lambda r: httpx.Response(200, json={"response": text}))


def test_llm_disabled_by_default_and_paid_provider_blocked(monkeypatch):
    assert narrate_events(FACTS, RULES, ok("12 eventos")) is None  # LLM_PROVIDER unset => none
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy")
    called = []
    spy = client(lambda r: called.append(r) or httpx.Response(200, json={"content": [{"text": "12 eventos"}]}))
    assert narrate_events(FACTS, RULES, spy) is None and called == []  # zero-cost rule: no paid API without opt-in
    monkeypatch.setenv("EVENTLOG_ALLOW_PAID_LLM", "1")
    assert narrate_events(FACTS, RULES, spy) == "12 eventos" and len(called) == 1


def test_llm_accepts_grounded_text_and_rejects_invented_numbers(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    assert narrate_events(FACTS, RULES, ok("Hubo 12 eventos y una reversión.")) == "Hubo 12 eventos y una reversión."
    assert narrate_events(FACTS, RULES, ok("Hubo 13 eventos.")) is None  # invented figure
    assert narrate_events(FACTS, RULES, ok("")) is None
    assert narrate_events(FACTS, RULES, client(lambda r: httpx.Response(500))) is None
    assert narrate_events(FACTS, RULES, client(lambda r: httpx.Response(200, json={"nope": 1}))) is None


def test_summary_uses_llm_text_only_when_valid(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    events = [AuditEvent(**e) for e in generate(7, 3, "incident")]
    rules = summarize_events(events)
    assert rules.narrative_source == "rules"
    good = summarize_events(events, narrate_fn=lambda facts, text: "Resumen LLM.")
    assert good.narrative == "Resumen LLM." and good.narrative_source == "llm"
    assert good.anomalies == rules.anomalies and good.actions == rules.actions  # numbers never come from the LLM
    fallback = summarize_events(events, narrate_fn=lambda facts, text: None)
    assert fallback.narrative == rules.narrative and fallback.narrative_source == "rules"


# ---- HTTP ------------------------------------------------------------------------------------------------

def test_endpoints(monkeypatch):
    c = TestClient(m.app)
    events = c.get("/synthetic/events", params={"seed": 7, "days": 14, "scenario": "incident"}).json()
    assert len(events) > 100 and events[0]["seq"] == 1
    r = c.post("/summarize/events", json={"events": events}).json()
    assert r["risk_level"] == "high" and r["narrative_source"] == "rules"
    monkeypatch.setattr(m, "narrate_events", lambda facts, text: "Texto LLM")
    assert c.post("/summarize/events", json={"events": events, "explain": True}).json()["narrative"] == "Texto LLM"
    assert c.post("/summarize/events", json={"events": events, "explain": False}).json()["narrative_source"] == "rules"
    assert c.post("/summarize/events", json={"events": [{"seq": 1}]}).status_code == 422
    too_many = [{"seq": i, "at": "2026-09-01T10:00:00Z", "actor": "a", "event": "ingest"} for i in range(5001)]
    assert c.post("/summarize/events", json={"events": too_many}).status_code == 422
    assert len(c.get("/synthetic/events", params={"days": 999}).json()) > 0  # clamped, not an error


@pytest.mark.parametrize("scenario", ["normal", "incident"])
def test_example_file_matches_generator(scenario):
    import json
    import pathlib
    f = pathlib.Path(__file__).parents[2] / "examples" / f"synthetic-audit-events-{scenario}.json"
    assert json.loads(f.read_text()) == generate(7, 14, scenario)
