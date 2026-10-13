# Bitácora — CyberLedger AI (Nexus Security & AI Lab)

> La nota del proyecto en el vault no era accesible desde esta sesión (solo el repositorio). Esta bitácora vive en el repo; Santiago puede copiarla a la nota.

## Sesión autónoma 2026-10-13 — "registro de eventos y su resumen con IA con datos sintéticos; pruebas y documentación"
Rama: `feat/cyberledger-ai-autonomo-2026-10-12` · Base: `main` · Coste: $0 (ningún servicio de pago, sin credenciales reales, solo datos sintéticos).

### Bitácora de decisiones
| Fecha | Decisión | Motivo |
|---|---|---|
| 2026-10-13 | "Registro de eventos" = la pista de auditoría existente, ampliada (filtros, paginación, exportación, taxonomía de severidad) en vez de una tabla nueva | Ya existía y estaba encadenada por hash; duplicarla fragmentaría la evidencia |
| 2026-10-13 | La severidad se deriva del nombre del evento (no se guarda ni entra en el hash) | Evita una migración y no invalida cadenas existentes; eventos nuevos son `info` por defecto |
| 2026-10-13 | Resumen = reglas deterministas; el LLM solo reescribe el texto | Auditabilidad y reproducibilidad; un LLM no debe producir cifras de evidencia |
| 2026-10-13 | Guarda anti-alucinación: el texto del LLM se descarta si contiene números que no están en las cifras calculadas | Impide cifras inventadas en un informe de seguridad; fallback a la plantilla |
| 2026-10-13 | Regla de coste $0: para el resumen solo se usa Ollama local; los proveedores de pago exigen `EVENTLOG_ALLOW_PAID_LLM=1` | Cumplir la regla de coste $0 por defecto |
| 2026-10-13 | Datos sintéticos deterministas (semilla) con escenarios `normal` e `incident`; los resúmenes sintéticos nunca escriben en la pista real | Demos/pruebas reproducibles sin tocar datos reales ni contaminar la evidencia |
| 2026-10-13 | `data` de los eventos nunca se copia al resumen; los motivos de fallo se recortan y se les sustituyen credenciales | El resumen puede mostrarse/compartirse |
| 2026-10-13 | Hash sobre JSON canónico (claves ordenadas) | **Bug encontrado:** Postgres `jsonb` reordena claves; con datos de varias claves la cadena válida dejaba de verificar. Comprobado por mutación: sin canonicalizar, la prueba contra Postgres falla |
| 2026-10-13 | Exportación NDJSON + script `verify-audit-export.js` independiente | Permite verificar la cadena sin el servicio (auditor externo) |
| 2026-10-13 | NestJS 10 → 11 (no 12), jest 30, vite 8, vitest 5 | `npm audit` marcaba vulnerabilidades altas (multer, @nestjs/core, vite, vitest). NestJS 12 es solo-ESM y exigiría migrar todo el API y las pruebas; 11 elimina las altas en producción (0 vulnerabilidades prod) con toda la suite en verde |
| 2026-10-13 | Reglas de lint del motor: E, F, I, B, S (ruff) + bandit `-ll` | Cobertura de seguridad razonable sin ruido de estilo |
| 2026-10-13 | CI: añadidos ruff, bandit, `npm audit --audit-level=high` y un job `smoke` con motor + API + Postgres + Redis reales | La evidencia de extremo a extremo debe repetirse en cada PR |
| 2026-10-13 | La rama base del PR es `main`; el nombre de rama usa el nombre del proyecto en kebab (`cyberledger-ai`) | Instrucción de la sesión |

### Definición de terminado — evidencia (ejecutada 2026-10-13)
| # | Condición | Evidencia |
|---|---|---|
| 1 | Tareas cumplidas | **Registro de eventos:** filtros/paginación/exportación/verificación (`api/src/audit/*`, `api/scripts/verify-audit-export.js`, UI en `web/src/Admin.tsx`). **Resumen con IA:** `engine/app/eventlog.py`, `engine/app/llm.py::narrate_events`, `GET /audit/summary[/synthetic]`. **Datos sintéticos:** `engine/app/synthetic.py`, `examples/synthetic-audit-events-*.json`. **Pruebas y documentación:** ver filas 2 y 4 |
| 2 | Pruebas pasando | `cd engine && pytest -q --cov=app` → **31 passed** (cobertura `eventlog.py` 99 %, total 95 %). `cd api && npx jest` → **24 passed** sin BD; con `DATABASE_URL` (PostgreSQL 16 + Redis reales) → **31 passed**. `cd web && npm test` → **7 passed**. `./scripts/smoke-eventlog.sh` con motor + API + Postgres reales → **ALL CHECKS PASSED** (11/11). Camino HTTP del LLM comprobado con un Ollama simulado: texto con cifras reales → `llm`; con cifras inventadas → vuelve a `rules` |
| 3 | Seguridad y lint | `ruff check .` → *All checks passed*. `bandit -q -r app -ll` → sin hallazgos (exit 0). `npm audit --audit-level=high` → **api: 0 altas/críticas** (producción: 0 vulnerabilidades; 20 moderadas solo en herramientas de desarrollo) · **web: 0 vulnerabilidades**. `npx tsc --noEmit` (api y web) → sin errores |
| 4 | README reproducible | `README.md`: secciones "Arranque rápido", "Registro de eventos y resumen con IA", "Pruebas, lint y seguridad" con comandos y requisitos; detalle en `docs/EVENT_LOG.md` |
| 5 | Bitácora de decisiones | Tabla de decisiones de este documento |
| 6 | Pendientes para Santiago | Sección siguiente |

### Pendientes para Santiago
1. **Revisar y aprobar el PR** (no se hizo merge ni se cambió ningún estado de aprobación).
2. **Copiar esta bitácora a la nota del proyecto** en el vault (no accesible desde la sesión).
3. **Docker:** `docker compose up --build` no se ha podido construir en el entorno de la sesión (sin daemon); verificar en tu máquina.
4. **Calibrar umbrales** de anomalías (10 s, 22:00–06:00 UTC, 80 %, 72 h…) con datos reales y tu zona horaria/horario laboral.
5. **LLM real:** probar `LLM_PROVIDER=ollama` con un modelo local real (solo se probó un Ollama simulado).
6. Pendientes heredados del PR #1: Terraform real, cuenta AWS real, SSO real, multi-tenant, conectores GCP/Azure.

### Riesgos conocidos
- El job `smoke` de CI es nuevo: si falla por diferencias de entorno hay que ajustar el workflow, no el código (el mismo script pasa en local).
- Las pruebas de PostgreSQL (`audit.spec.ts`, `e2e.spec.ts`) **recrean las tablas** de la base indicada en `DATABASE_URL`: usar solo una base de pruebas.
- `/audit/summary` carga hasta 5000 eventos en memoria por petición (limitado y con rate limit); para volúmenes mayores habría que agregar en SQL.
- Las anomalías son heurísticas; un resultado "riesgo bajo" no sustituye una revisión humana.
- El orden de las claves en el hash cambió (JSON canónico): cadenas creadas con la versión anterior y datos de varias claves no verificarían. No hay datos de producción afectados (el producto aún no se ha desplegado).
- NestJS 11 en lugar de 12 (ver decisiones); migrar a 12 requiere pasar el API a ESM.
