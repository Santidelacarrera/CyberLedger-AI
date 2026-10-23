# Seguridad

## Modelo de amenazas (resumen)
| Amenaza | Mitigación |
|---|---|
| Ejecutar cambios sin autorización | Toda acción nace `PENDING_APPROVAL`; la cola solo recibe acciones aprobadas; control dual configurable |
| Aprobador único con poder excesivo | Una persona no puede aprobar dos veces; `admin` cubre un solo rol; acciones destructivas exigen SecOps **y** FinOps |
| Manipulación del historial | `audit_log` y `policies` append-only (triggers) + cadena de hashes verificable en `/audit/verify` |
| Texto de IA con cifras inventadas | El resumen solo acepta el texto del LLM si todos sus números están en las cifras calculadas; si no, usa el texto por reglas. El LLM es local por defecto ($0) |
| Cadena de auditoría que se rompe al releer de Postgres | Hash sobre JSON canónico (claves ordenadas); prueba contra Postgres |
| Fuga de secretos escaneados | Los hallazgos solo llevan una vista previa redactada; `text_scans` no se guarda como evidencia |
| Abuso del API | Auth obligatoria (fail-closed), rate limit global y estricto en `/ingest` y `/collect/aws`, límite de cuerpo (5 MB) |
| Tokens SSO falsificados | Verificación de firma (JWKS), `iss`, `aud`, expiración; roles desconocidos no conceden nada |
| LLM manipulado por prompt-injection | El LLM nunca elige la acción ni ejecuta nada; solo redacta un resumen |
| Cambio que rompe producción | Healthcheck tras `apply` y rollback; sin reintentar un cambio que rompió el servicio |

## Recomendaciones de despliegue
- Usa SSO (OIDC) en vez de claves estáticas; las claves API solo para integraciones y rotarlas.
- Credenciales AWS del motor: rol de **solo lectura** (`ec2:Describe*`, `cloudwatch:GetMetricStatistics`, `ce:GetCostAndUsageWithResources`, `iam:List*`, `iam:GetAccessKeyLastUsed`).
- Credenciales de ejecución (Terraform) separadas, solo en el worker/API, nunca en el motor.
- Poner el API detrás de TLS y un proxy; cambiar todas las contraseñas de `docker-compose.yml`.

## Análisis automáticos
`bandit -ll` (motor), `ruff` (motor) y `npm audit --audit-level=high` (API y web) corren en CI.

## Reportar vulnerabilidades
Abre un aviso privado de seguridad en GitHub del repositorio.
