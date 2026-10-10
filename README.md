# CyberLedger AI

Gobernanza autónoma de postura de seguridad, costes cloud y resiliencia de agentes mediante IA.
Calcula el **Riesgo Neto Integrado** (ciberseguridad + coste cloud), simula la remediación (dry-run con diff de Terraform),
y pausa la ejecución hasta la aprobación humana.

## Arquitectura
Telemetría (Cost APIs, Trivy/SARIF) → Core NestJS (estado/políticas) → Motor IA FastAPI (riesgo × coste) →
Bandeja SecOps/FinOps (human-in-the-loop) → Worker BullMQ (ejecución idempotente con backoff y healthchecks).

## Estado del repositorio (MVP scaffold)
| Carpeta | Contenido | Estado |
|---|---|---|
| `engine/` | FastAPI: correlación riesgo/coste, ahorro, diff Terraform | implementado + tests |
| `api/` | NestJS: acciones, máquina de estados, aprobación, cola BullMQ | esqueleto + tests de estado |
| `docker-compose.yml` | Postgres, Redis, MinIO | listo |
| `web/` | Dashboard React | pendiente |

Pendiente: ingesta (Cost Explorer, SARIF/Trivy), persistencia en PostgreSQL, apply real de Terraform, LLM (Ollama/Claude) para contextualizar riesgo.

## Desarrollo
```
docker compose up -d
cd engine && pip install -r requirements.txt && pytest && uvicorn app.main:app --reload
cd api && npm install && npm test && npm start
```

## Lógica de decisión (engine)
- `riesgo_seguridad = max(CVSS/10 · (0.5 + 0.5·exposición))`; `desperdicio = 1 − utilización`; `riesgo_neto = 0.7·seg + 0.3·desperdicio`.
- Crítico + sobredimensionado → parche + redimensionado en una sola acción; crítico + uso alto → solo parche;
  ocioso no-prod de bajo riesgo → destruir; identidades inactivas ≥90d → revocar.
- Ahorro = coste actual − coste destino; payback = coste único / ahorro mensual.
- Toda acción distinta de `no_action` requiere aprobación humana.
