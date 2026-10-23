# CyberLedger AI

> Producto de **Nexus Security & AI Lab**.

Gobernanza autónoma de postura de seguridad, costes cloud y resiliencia de agentes mediante IA.
Calcula el **Riesgo Neto Integrado** (ciberseguridad + coste cloud), simula la remediación (dry-run con diff de Terraform),
y pausa la ejecución hasta la aprobación humana.

## Arquitectura
Telemetría (Cost APIs, Trivy/SARIF) → Core NestJS (estado/políticas) → Motor IA FastAPI (riesgo × coste) →
Bandeja SecOps/FinOps (human-in-the-loop) → Worker BullMQ (ejecución idempotente con backoff y healthchecks).

## Componentes
| Carpeta | Contenido |
|---|---|
| `engine/` | FastAPI: ingesta (SARIF, Trivy, Cost Explorer, CSV, fugas de claves de IA, drift de tokens LLM), correlación riesgo×coste, ahorro, diff Terraform, narrativa LLM opcional |
| `api/` | NestJS: acciones, aprobación multi-rol (control dual), políticas y auditoría inmutables (PostgreSQL), cola BullMQ, ejecutor Terraform, evidencias en MinIO/S3 |
| `web/` | React + TS: matriz riesgo/coste, bandeja de decisiones, diff dry-run |
| `docs/` | `EVENT_LOG.md` (registro de eventos y resumen IA), `DECISIONS.md` (diseño y limitaciones), `OPERATIONS.md` (variables, métricas, runbooks), `BITACORA.md` (bitácora, evidencias y pendientes) |
| `scripts/` | `smoke-eventlog.sh`: prueba de extremo a extremo con datos sintéticos |
| `SECURITY.md` | Modelo de amenazas y recomendaciones de despliegue |

## Arranque rápido
```
docker compose up --build          # web en :5173, API :3000, engine :8000
# login con la API key dev-secops / dev-finops / dev-admin y pulsar "Cargar datos demo"
```
Desarrollo sin Docker: `cd engine && pip install -r requirements.txt && pytest && uvicorn app.main:app`;
`cd api && npm i && API_KEYS=k:me:admin npm start`; `cd web && npm i && npm run dev`.

## Registro de eventos y resumen con IA
Pista de auditoría encadenada por hash, con filtros, exportación verificable offline y un resumen (métricas + anomalías + texto ejecutivo, opcionalmente redactado por un LLM **local**). Con datos sintéticos, sin coste:
```
# 1) stack: docker compose up --build   (o los comandos de "Desarrollo sin Docker")
# 2) en la web, pestaña Auditoría → "Datos sintéticos: incidente"; o por API:
curl -H 'x-api-key: dev-admin' 'localhost:3000/audit/summary/synthetic?scenario=incident'
# 3) comprobación completa de extremo a extremo
./scripts/smoke-eventlog.sh
```
Detalle (taxonomía, reglas de anomalías, guarda anti-alucinación, verificación offline): `docs/EVENT_LOG.md`.

## Pruebas, lint y seguridad
```
cd engine && pip install -r requirements.txt -r requirements-dev.txt
  pytest -q && ruff check . && bandit -q -r app -ll
cd api && npm ci && npx tsc --noEmit && npx jest && npm audit --audit-level=high      # Redis; con DATABASE_URL también PostgreSQL
cd web && npm ci && npm test && npm run build && npm audit --audit-level=high
```
Requisitos: Python 3.12+, Node 22+, Redis y (opcional) PostgreSQL 16 para las pruebas completas del API.

## API principal
`POST /ingest` · `POST /collect/aws` (lectura en vivo) · `GET /metrics` · `GET /actions` · `POST /actions/:id/{dry-run,approve,reject}` · `GET /summary` ·
`GET|POST /policy` (admin publica) · `GET /audit`, `/audit/export`, `/audit/verify`, `/audit/summary`, `/audit/summary/synthetic` (admin). Cabecera `x-api-key`.
Ejemplo de payload: `examples/demo-ingest.json`.

## Lógica de decisión
- `riesgo_seguridad = max(CVSS/10 · (0.5 + 0.5·exposición))` (identidades inactivas suman hasta 0.5 por antigüedad); `desperdicio = 1 − utilización`; `riesgo_neto = 0.7·seg + 0.3·desperdicio`.
- Crítico + sobredimensionado → parche + redimensionado en una sola acción; crítico + uso alto → solo parche; ocioso no-prod → destruir; identidades inactivas ≥90d o claves filtradas → revocar; deriva de gasto LLM → limitar y rotar clave.
- Ahorro = coste actual − coste destino; payback = coste único / ahorro mensual.
- Toda acción distinta de `no_action` requiere aprobación humana.
