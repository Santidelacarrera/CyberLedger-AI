# Operación

## Variables de entorno (API)
| Variable | Uso |
|---|---|
| `API_KEYS` | `clave:usuario:rol,...` (roles `secops`,`finops`,`admin`) |
| `OIDC_ISSUER`, `OIDC_JWKS_URI`, `OIDC_AUDIENCE`, `OIDC_ROLE_CLAIM` | SSO: se acepta `Authorization: Bearer <jwt>`; el claim de roles (por defecto `roles`) se mapea a los roles |
| `DATABASE_URL` | PostgreSQL (migraciones versionadas automáticas al arrancar; sin ella, modo memoria solo para desarrollo) |
| `REDIS_HOST`, `REDIS_PORT` | BullMQ |
| `ENGINE_URL` | URL del motor |
| `TERRAFORM_DIR` | Activa el ejecutor Terraform (sobre configuración ya revisada); `ROLLBACK_COMMAND` script de reversión |
| `HEALTHCHECK_URL_TEMPLATE` | p. ej. `http://{resource}.internal/health` |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Evidencias en MinIO/S3 (si no, `EVIDENCE_DIR`) |
| `WEBHOOK_URL` | Notificaciones Slack-compatibles |
| `COLLECT_CRON` | Recolección programada de AWS |
| `BODY_LIMIT`, `CORS_ORIGIN`, `PORT` | Ajustes del servidor |

## Motor
`LLM_PROVIDER=none|ollama|anthropic` (por defecto `none`, coste $0; `ollama` = modelo local), `LLM_MODEL`, `OLLAMA_URL`, `ANTHROPIC_API_KEY`. El resumen del registro de eventos solo usa `ollama` salvo que se defina `EVENTLOG_ALLOW_PAID_LLM=1`; credenciales AWS estándar de boto3 y `AWS_REGION`.

## Observabilidad
- Logs JSON por línea (stdout).
- `GET /metrics` (admin) en formato Prometheus: acciones por estado, ahorro pendiente y ejecutado.
- `GET /audit/verify` debe devolver `{"ok":true}`; alertar si no.

## Registro de eventos
- Exportar y verificar: `curl -H 'x-api-key: <admin>' $API/audit/export > audit.ndjson && node api/scripts/verify-audit-export.js audit.ndjson`.
- Prueba de humo de extremo a extremo (datos sintéticos): `./scripts/smoke-eventlog.sh`.
- Resumen programado: llamar a `GET /audit/summary?from=<ISO>` desde cualquier planificador y archivar la respuesta.

## Runbooks
- **Acción en `FAILED`:** ver `error` en `GET /actions/:id`; BullMQ reintenta 5 veces con backoff; tras agotarse, corregir la causa y volver a aprobar creando una nueva propuesta con `/ingest`.
- **Acción en `ROLLED_BACK`:** el healthcheck falló tras aplicar; revisar el servicio antes de proponer de nuevo.
- **Cadena de auditoría rota:** tratar como incidente; restaurar desde backup y revisar accesos a la base.
- **Backups:** `pg_dump` de PostgreSQL (acciones, auditoría, políticas) y réplica del bucket de evidencias.
