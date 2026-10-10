from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

from app.ingest.aws import collect_ec2, collect_iam_keys


def fake_session(clients):
    s = MagicMock()
    s.client.side_effect = lambda name, **kw: clients[name]
    return s


def test_collect_ec2():
    ec2 = MagicMock()
    ec2.get_paginator.return_value.paginate.return_value = [{"Reservations": [{"Instances": [
        {"InstanceId": "i-1", "InstanceType": "m5.xlarge", "Tags": [{"Key": "env", "Value": "prod"}]},
        {"InstanceId": "i-2", "InstanceType": "weird.type", "Tags": [{"Key": "env", "Value": "dev"}]}]}]}]
    cw = MagicMock(); cw.get_metric_statistics.return_value = {"Datapoints": [{"Average": 10.0}, {"Average": 20.0}]}
    ce = MagicMock(); ce.get_cost_and_usage_with_resources.return_value = {"ResultsByTime": [{"Groups": [
        {"Keys": ["i-1"], "Metrics": {"UnblendedCost": {"Amount": "70"}}}]}]}
    r = collect_ec2(fake_session({"ec2": ec2, "cloudwatch": cw, "ce": ce}), days=30)
    a, b = r
    assert a.utilization == 0.15 and a.monthly_cost == 70 and a.production
    assert a.cheaper_instance_type == "m5.large" and a.cheaper_monthly_cost == 35.0
    assert b.cheaper_instance_type is None and not b.production


def test_collect_iam_stale_keys_only():
    old = datetime.now(timezone.utc) - timedelta(days=200)
    iam = MagicMock()
    iam.get_paginator.return_value.paginate.return_value = [{"Users": [{"UserName": "bob"}]}]
    iam.list_access_keys.return_value = {"AccessKeyMetadata": [
        {"AccessKeyId": "AK1", "Status": "Active", "CreateDate": old},
        {"AccessKeyId": "AK2", "Status": "Inactive", "CreateDate": old}]}
    iam.get_access_key_last_used.return_value = {"AccessKeyLastUsed": {}}
    r = collect_iam_keys(fake_session({"iam": iam}))
    assert [x.id for x in r] == ["bob/AK1"] and r[0].idle_days >= 200


def test_collect_endpoint_reports_aws_errors_as_502(monkeypatch):
    from botocore.exceptions import NoCredentialsError
    from fastapi.testclient import TestClient
    import app.main as m

    def boom(*a, **k):
        raise NoCredentialsError()
    monkeypatch.setattr(m, "collect_ec2", boom)
    r = TestClient(m.app).post("/collect/aws", json={})
    assert r.status_code == 502 and "AWS collection failed" in r.json()["detail"]
