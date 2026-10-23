# Registro de eventos y resumen con IA

Producto de **Nexus Security & AI Lab**. Todo lo descrito aquí funciona a coste $0: sin servicios de pago, sin credenciales y, en las demostraciones y pruebas, solo con **datos sintéticos**.

## Qué es
Cada decisión relevante de la plataforma (propuesta, aprobación, ejecución, fallo, cambio de política…) queda en una pista de auditoría **append-only y encadenada por hash**. Esta capa añade:

1. **Consulta** con filtros y paginación (`GET /audit`).
2. **Exportación verificable offline** (`GET /audit/export` + `api/scripts/verify-audit-export.js`).
3. **Resumen con IA** (`GET /audit/summary`): métricas, anomalías y un texto ejecutivo.
4. **Datos sintéticos** deterministas para demos, pruebas y documentación (`GET /audit/summary/synthetic`).

## Taxonomía de eventos
| Evento | Lo emite | Severidad |
|---|---|---|
| `ingest`, `collect.aws` | API (ingesta / recolección programada) | info |
| `action.created` | API al crear una propuesta | info |
| `action.approved` | API, un aprobador (incluye `data.role`) | info |
| `action.queued`, `action.executing`, `action.done` | worker | info |
| `action.dry_run` | API | info |
| `action.rejected` | API | **warning** |
| `action.failed` | worker (`data.error`) | **warning** |
| `action.blocked_by_policy` | API | **warning** |
| `policy.published` | API (admin) | **notice** |
| `action.rolled_back` | worker (healthcheck falló) | **critical** |

Un evento desconocido se trata como `info`. La tabla vive en `api/src/audit/events.ts` y `engine/app/eventlog.py` (deben mantenerse iguales; hay una prueba de cada lado).

## API (rol `admin`)
| Endpoint | Descripción |
|---|---|
| `GET /audit?actor=&event=&subject=&severity=&from=&to=&limit=&offset=` | Página `{items,total,limit,offset}`, más reciente primero. Filtros combinados con AND; `from`/`to` ISO inclusivos; `limit` 1–500 (def. 100). Fecha inválida → 400 |
| `GET /audit/export` | NDJSON (más antiguo primero), una entrada por línea con `prevHash`/`hash` |
| `GET /audit/verify` | Verifica la cadena en el servidor |
| `GET /audit/summary?from=&to=&explain=` | Resumen del registro real (hasta los 5000 eventos más recientes del periodo; `truncated` lo indica) |
| `GET /audit/summary/synthetic?scenario=normal\|incident&seed=&days=&explain=` | Resumen de datos sintéticos; **nunca** escribe en el registro real |

### Verificación offline
```
curl -H 'x-api-key: <admin>' localhost:3000/audit/export > audit.ndjson
node api/scripts/verify-audit-export.js audit.ndjson     # {"ok":true,"checked":N}  (exit 0) | {"ok":false,"brokenAt":k} (exit 1)
```
El hash es `sha256([prevHash, at, actor, event, subject|null, data])` con las claves de `data` ordenadas (JSON canónico). Postgres `jsonb` no conserva el orden de claves; sin canonicalizar, una cadena válida se rompería al releerla (corregido y cubierto por una prueba contra Postgres).

## Cómo se calcula el resumen
Todo lo numérico lo calculan **reglas deterministas** (`engine/app/eventlog.py`); el LLM no decide nada.

**Métricas:** total por evento / actor / severidad; propuestas, aprobaciones, rechazos, completadas, fallidas, revertidas y bloqueadas; mediana desde `action.created` hasta la **primera** decisión; motivos de fallo (recortados a 80 caracteres y con credenciales sustituidas por `[REDACTED]`).

**Anomalías** (severidad → nivel de riesgo global = la más alta):
| Código | Sev. | Regla |
|---|---|---|
| `ROLLBACK` | alta | cualquier `action.rolled_back` |
| `REPEATED_FAILURE` | alta | una acción con ≥ 2 `action.failed` |
| `FAST_APPROVAL` | media | aprobación < 10 s después de crear la propuesta |
| `OFF_HOURS_DECISION` | media | decisión humana entre 22:00 y 06:00 UTC |
| `APPROVER_CONCENTRATION` | media | ≥ 5 aprobaciones de un rol y una sola persona hace ≥ 80 % |
| `POLICY_CHANGE` | media | cualquier `policy.published` |
| `STUCK_PENDING` | media | propuesta sin decisión > 72 h (respecto al último evento o a `now`) |
| `POLICY_BLOCKS` | baja | ≥ 3 bloqueos por política |
| `INGEST_BURST` | baja | ≥ 5 ingestas en 10 min |

Los umbrales son constantes al inicio de `eventlog.py`; hay que calibrarlos con datos reales.

## Texto con IA (opcional, local y gratuito)
- Por defecto (`LLM_PROVIDER=none`) el texto lo genera una plantilla en español a partir de las cifras: reproducible y sin red.
- Con `LLM_PROVIDER=ollama` y `explain=true`, un **modelo local** reescribe el texto. Regla de coste $0: los proveedores de pago solo se usan si además se define `EVENTLOG_ALLOW_PAID_LLM=1` (no recomendado).
- **Guarda anti-alucinación:** el texto del modelo solo se acepta si **todos los números** que contiene aparecen ya en las cifras calculadas; si no, o si el modelo falla, se conserva el texto por reglas. El campo `narrative_source` indica `rules` o `llm`. Las cifras (`actions`, `anomalies`…) nunca provienen del modelo.

## Datos sintéticos
Generador determinista (misma semilla → mismos eventos), sin datos reales:
```
cd engine
python -m app.synthetic --seed 7 --days 14 --scenario normal   > ../examples/synthetic-audit-events-normal.json
python -m app.synthetic --seed 7 --days 14 --scenario incident > ../examples/synthetic-audit-events-incident.json
```
- `normal`: flujo sano → riesgo **bajo**, sin anomalías.
- `incident`: reversiones, fallos repetidos, aprobación sin revisión, decisión nocturna, concentración de aprobador, cambio de política y bloqueos → riesgo **alto**.

Resumen de ejemplo (`incident`, semilla 7): 173 eventos, 27 propuestas, 10 fallidas, 4 revertidas, 7 anomalías. Una prueba asegura que los ficheros de `examples/` coinciden con el generador.

## Componente reutilizable
`engine/app/eventlog.py` solo depende de pydantic: recibe una lista genérica de `AuditEvent {seq, at, actor, event, subject, data}` y devuelve un `EventSummary`. Puede reutilizarse en otros productos de Nexus Security & AI Lab cambiando la tabla `SEVERITY` y las reglas; no contiene nada específico de un cliente. `api/scripts/verify-audit-export.js` es independiente (solo `crypto`).

## Interfaz
Pestaña **Auditoría**: tarjeta "Resumen IA del registro" (registro real, sintético normal / incidente, casilla "Redactar con LLM local"), filtros (evento, severidad, actor, fechas), paginación, indicador de cadena íntegra y botón "Exportar NDJSON".

## Comprobación de extremo a extremo
Con el stack levantado: `./scripts/smoke-eventlog.sh` (11 comprobaciones; también corre en CI).
