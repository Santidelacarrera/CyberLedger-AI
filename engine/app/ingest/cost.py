"""Billing -> Resources. Supports AWS Cost Explorer (GetCostAndUsageWithResources) and a normalized CSV
(columns: resource_id,monthly_cost,utilization[,kind,instance_type,cheaper_instance_type,cheaper_monthly_cost,production,idle_days])."""
import csv
import io
from collections import defaultdict

from app.models import Resource


def parse_cost_explorer(doc: dict, months: int | None = None) -> dict[str, float]:
    """Returns resource_id -> average monthly unblended cost."""
    totals: dict[str, float] = defaultdict(float)
    periods = doc.get("ResultsByTime", [])
    for period in periods:
        for g in period.get("Groups", []):
            totals[g["Keys"][0]] += float(g["Metrics"]["UnblendedCost"]["Amount"])
    n = months or max(len(periods), 1)
    return {k: round(v / n, 2) for k, v in totals.items()}


def _b(v: str) -> bool:
    return str(v).strip().lower() in ("1", "true", "yes", "prod", "production")


def parse_inventory_csv(text: str) -> list[Resource]:
    out = []
    for row in csv.DictReader(io.StringIO(text)):
        out.append(Resource(
            id=row["resource_id"], kind=row.get("kind") or "compute",
            monthly_cost=float(row["monthly_cost"]), utilization=float(row.get("utilization") or 0),
            instance_type=row.get("instance_type") or "unknown",
            cheaper_instance_type=row.get("cheaper_instance_type") or None,
            cheaper_monthly_cost=float(row["cheaper_monthly_cost"]) if row.get("cheaper_monthly_cost") else None,
            production=_b(row.get("production", "true")), idle_days=int(row.get("idle_days") or 0)))
    return out


def apply_costs(resources: list[Resource], costs: dict[str, float]) -> list[Resource]:
    """Overrides inventory cost with billed cost; adds billed-only resources as idle ghosts (utilization 0)."""
    seen = set()
    for r in resources:
        if r.id in costs:
            r.monthly_cost = costs[r.id]
        seen.add(r.id)
    for rid, c in costs.items():
        if rid not in seen:
            resources.append(Resource(id=rid, monthly_cost=c, utilization=0.0, production=False, idle_days=30))
    return resources
