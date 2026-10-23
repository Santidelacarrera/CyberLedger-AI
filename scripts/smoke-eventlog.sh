#!/usr/bin/env bash
# End-to-end check of the event log + AI summary against a RUNNING stack (engine :8000, api :3000, Postgres, Redis).
# Uses only synthetic data. Keys come from the API_KEYS you started the API with (defaults match docker-compose).
#   ./scripts/smoke-eventlog.sh        # exit 0 = all checks passed
set -euo pipefail
API=${API_URL:-http://localhost:3000}
SECOPS=${SECOPS_KEY:-dev-secops}; FINOPS=${FINOPS_KEY:-dev-finops}; ADMIN=${ADMIN_KEY:-dev-admin}
here=$(cd "$(dirname "$0")/.." && pwd)
j() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
check() { if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1: expected '$3' got '$2'"; exit 1; fi; }

check "api health" "$(curl -sf "$API/health" | j 'd["status"]')" ok
curl -sf -XPOST "$API/ingest" -H "x-api-key: $SECOPS" -H 'content-type: application/json' -d @"$here/examples/demo-ingest.json" >/dev/null
ID=$(curl -sf "$API/actions" -H "x-api-key: $SECOPS" | j '[a for a in d if a["proposal"]["resource_id"]=="analytics-etl" and a["status"]=="PENDING_APPROVAL"][0]["id"]')
curl -sf -XPOST "$API/actions/$ID/approve" -H "x-api-key: $FINOPS" >/dev/null
for _ in $(seq 1 20); do
  [ "$(curl -sf "$API/actions/$ID" -H "x-api-key: $SECOPS" | j 'd["status"]')" = DONE ] && break; sleep 0.5
done
check "action executed" "$(curl -sf "$API/actions/$ID" -H "x-api-key: $SECOPS" | j 'd["status"]')" DONE

check "audit filter by event" "$(curl -sf "$API/audit?event=action.done&limit=1" -H "x-api-key: $ADMIN" | j 'd["items"][0]["event"]')" action.done
check "non-admin blocked" "$(curl -s -o /dev/null -w '%{http_code}' "$API/audit" -H "x-api-key: $SECOPS")" 403
REAL=$(curl -sf "$API/audit/summary" -H "x-api-key: $ADMIN")
check "real summary source" "$(echo "$REAL" | j 'd["source"]')" audit_log
check "real summary counts done" "$(echo "$REAL" | j 'd["summary"]["actions"]["done"] >= 1')" True
NORMAL=$(curl -sf "$API/audit/summary/synthetic?scenario=normal" -H "x-api-key: $ADMIN")
check "synthetic normal risk" "$(echo "$NORMAL" | j 'd["summary"]["risk_level"]')" low
INC=$(curl -sf "$API/audit/summary/synthetic?scenario=incident" -H "x-api-key: $ADMIN")
check "synthetic incident risk" "$(echo "$INC" | j 'd["summary"]["risk_level"]')" high
check "incident flags rollback" "$(echo "$INC" | j '"ROLLBACK" in [a["code"] for a in d["summary"]["anomalies"]]')" True
curl -sf "$API/audit/export" -H "x-api-key: $ADMIN" > /tmp/cyberledger-audit.ndjson
check "export verifies offline" "$(node "$here/api/scripts/verify-audit-export.js" /tmp/cyberledger-audit.ndjson | j 'd["ok"]')" True
check "server chain verify" "$(curl -sf "$API/audit/verify" -H "x-api-key: $ADMIN" | j 'd["ok"]')" True
echo "ALL CHECKS PASSED"
