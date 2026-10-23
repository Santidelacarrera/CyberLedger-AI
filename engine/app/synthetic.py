"""Deterministic synthetic audit events (no real data). Used for demos, tests and documentation.

    python -m app.synthetic --seed 7 --days 14 --scenario incident > examples/synthetic-audit-events.json
"""
import argparse
import json
import random
import uuid
from datetime import datetime, timedelta, timezone

from .models import Action

ACTORS = {"secops": ["sara", "luis"], "finops": ["fede", "marta"], "admin": ["root"]}
RESOURCES = ["payments-api", "orders-svc", "batch-staging", "analytics-etl", "ghost-vm-17", "key-chatbot-prod",
             "svc-old-deploy-key", "repo/.env.bak"]
ERRORS = ["terraform apply exited with 1", "state lock held by another run", "healthcheck failed after apply",
          "AccessDenied on ec2:ModifyInstanceAttribute"]
BASE = datetime(2026, 9, 1, 8, 0, tzinfo=timezone.utc)


def generate(seed: int = 7, days: int = 14, scenario: str = "normal") -> list[dict]:
    """scenario: 'normal' (healthy workflow) or 'incident' (rollback, repeated failures, rubber-stamping,
    off-hours decisions, approver concentration, policy change)."""
    rnd = random.Random(seed)  # noqa: S311 - synthetic data, not security-sensitive
    rows: list[tuple[datetime, str, str, str | None, dict]] = []

    def add(at, actor, event, subject=None, data=None):
        rows.append((at, actor, event, subject, data or {}))

    for day in range(days):
        day0 = BASE + timedelta(days=day)
        t = day0 + timedelta(minutes=rnd.randint(0, 20))
        add(t, rnd.choice(["sara", "fede", "scheduler"]), "collect.aws" if rnd.random() < 0.5 else "ingest", f"ev{day:02d}")
        for _ in range(rnd.randint(1, 3)):
            res, act = rnd.choice(RESOURCES), rnd.choice([a.value for a in Action if a != Action.NO_ACTION])
            aid = str(uuid.UUID(int=rnd.getrandbits(128)))
            t = t + timedelta(seconds=rnd.randint(1, 5))
            add(t, "sara", "action.created", aid, {"action": act, "resource": res})
            roles = ["secops", "finops"] if rnd.random() < 0.7 else ["secops"]
            decide = t + timedelta(minutes=rnd.randint(8, 240))
            if rnd.random() < 0.12:
                add(decide, rnd.choice(ACTORS["secops"]), "action.rejected", aid)
                continue
            for role in roles:
                who = rnd.choice(ACTORS[role])
                if scenario == "incident" and role == "secops" and rnd.random() < 0.9:
                    who = "luis"  # approver concentration
                add(decide, who, "action.approved", aid, {"role": role})
                decide += timedelta(minutes=rnd.randint(1, 30))
            add(decide, "system", "action.queued", aid)
            add(decide + timedelta(seconds=2), "system", "action.executing", aid)
            roll = rnd.random()
            if scenario == "normal" or roll < 0.75:
                add(decide + timedelta(seconds=30), "system", "action.done", aid)
            elif roll < 0.9:
                for k in range(2):
                    add(decide + timedelta(seconds=30 * (k + 1)), "system", "action.failed", aid, {"error": rnd.choice(ERRORS)})
                add(decide + timedelta(seconds=120), "system", "action.done", aid)
            else:
                add(decide + timedelta(seconds=30), "system", "action.rolled_back", aid, {"error": "healthcheck failed after apply"})
    if scenario == "incident":
        aid = str(uuid.UUID(int=rnd.getrandbits(128)))
        night = BASE + timedelta(days=days - 1, hours=15, minutes=3)  # 23:03 UTC
        add(night, "sara", "action.created", aid, {"action": "destroy", "resource": "analytics-etl"})
        add(night + timedelta(seconds=4), "luis", "action.approved", aid, {"role": "secops"})  # rubber-stamp, off-hours
        add(night + timedelta(seconds=9), "root", "policy.published", "9", {})
        for i in range(3):
            add(night + timedelta(minutes=i), "sara", "action.blocked_by_policy", f"res-{i}", {"action": "destroy"})
        add(night + timedelta(minutes=5), "fede", "action.created", str(uuid.UUID(int=rnd.getrandbits(128))), {"action": "destroy"})
    rows.sort(key=lambda r: r[0])
    return [{"seq": i + 1, "at": at.isoformat(), "actor": actor, "event": ev, "subject": subj, "data": data}
            for i, (at, actor, ev, subj, data) in enumerate(rows)]


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--scenario", choices=["normal", "incident"], default="normal")
    a = ap.parse_args()
    print(json.dumps(generate(a.seed, a.days, a.scenario), indent=1, ensure_ascii=False))
