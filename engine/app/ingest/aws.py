"""Live AWS collector: EC2 inventory + CloudWatch CPU + Cost Explorer (per resource) + IAM access keys.
Read-only calls only. Credentials come from the standard boto3 chain (role/env), never from request bodies."""
from datetime import datetime, timedelta, timezone

import boto3

from app.models import Resource

# Same-family downsize map. Within a family each step down halves the on-demand price.
DOWNSIZE = {
    "m5.4xlarge": "m5.2xlarge", "m5.2xlarge": "m5.xlarge", "m5.xlarge": "m5.large",
    "r5.2xlarge": "r5.xlarge", "r5.xlarge": "r5.large", "c5.2xlarge": "c5.xlarge",
    "c5.xlarge": "c5.large", "t3.xlarge": "t3.large", "t3.large": "t3.medium",
}


def _avg_cpu(cw, instance_id: str, days: int) -> float:
    end = datetime.now(timezone.utc)
    r = cw.get_metric_statistics(
        Namespace="AWS/EC2", MetricName="CPUUtilization", Dimensions=[{"Name": "InstanceId", "Value": instance_id}],
        StartTime=end - timedelta(days=days), EndTime=end, Period=86400, Statistics=["Average"])
    pts = [p["Average"] for p in r.get("Datapoints", [])]
    return round(sum(pts) / len(pts) / 100, 4) if pts else 0.0


def _costs(ce, days: int) -> dict[str, float]:
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=days)
    out: dict[str, float] = {}
    token = None
    while True:
        kw = dict(TimePeriod={"Start": start.isoformat(), "End": end.isoformat()}, Granularity="MONTHLY",
                  Metrics=["UnblendedCost"], GroupBy=[{"Type": "DIMENSION", "Key": "RESOURCE_ID"}])
        if token:
            kw["NextPageToken"] = token
        r = ce.get_cost_and_usage_with_resources(**kw)
        for period in r.get("ResultsByTime", []):
            for g in period.get("Groups", []):
                out[g["Keys"][0]] = out.get(g["Keys"][0], 0.0) + float(g["Metrics"]["UnblendedCost"]["Amount"])
        token = r.get("NextPageToken")
        if not token:
            break
    scale = 30 / days
    return {k: round(v * scale, 2) for k, v in out.items()}


def collect_ec2(session: boto3.Session | None = None, days: int = 14) -> list[Resource]:
    s = session or boto3.Session()
    ec2, cw, ce = s.client("ec2"), s.client("cloudwatch"), s.client("ce", region_name="us-east-1")
    costs = _costs(ce, days)
    out: list[Resource] = []
    for page in ec2.get_paginator("describe_instances").paginate(Filters=[{"Name": "instance-state-name", "Values": ["running"]}]):
        for res in page["Reservations"]:
            for i in res["Instances"]:
                iid, itype = i["InstanceId"], i["InstanceType"]
                tags = {t["Key"]: t["Value"] for t in i.get("Tags", [])}
                cheaper = DOWNSIZE.get(itype)
                cost = costs.get(iid, 0.0)
                out.append(Resource(
                    id=iid, monthly_cost=cost, utilization=_avg_cpu(cw, iid, days), instance_type=itype,
                    cheaper_instance_type=cheaper,
                    cheaper_monthly_cost=round(cost / 2, 2) if cheaper and cost else None,
                    production=tags.get("env", tags.get("Environment", "prod")).lower() in ("prod", "production")))
    return out


def collect_iam_keys(session: boto3.Session | None = None, stale_days: int = 90) -> list[Resource]:
    iam = (session or boto3.Session()).client("iam")
    now = datetime.now(timezone.utc)
    out: list[Resource] = []
    for page in iam.get_paginator("list_users").paginate():
        for u in page["Users"]:
            for k in iam.list_access_keys(UserName=u["UserName"])["AccessKeyMetadata"]:
                if k["Status"] != "Active":
                    continue
                lu = iam.get_access_key_last_used(AccessKeyId=k["AccessKeyId"])["AccessKeyLastUsed"]
                last = lu.get("LastUsedDate") or k["CreateDate"]
                idle = (now - last).days
                if idle >= stale_days:
                    out.append(Resource(id=f'{u["UserName"]}/{k["AccessKeyId"]}', kind="identity",
                                        monthly_cost=0, utilization=0, idle_days=idle))
    return out
