# Decisiones de diseño

1. **Decisión determinista, narrativa con LLM.** El motor elige la acción con reglas auditables; el LLM (Ollama/Claude, opcional) solo la explica. Si falla, se usa el rationale de reglas.
2. **Aprobación humana obligatoria.** Toda acción distinta de `no_action` nace `PENDING_APPROVAL`. Los roles requeridos (SecOps/FinOps) se derivan de la propuesta y de la política; las acciones de *control dual* (`destroy`, `revoke_identity` por defecto) exigen dos personas distintas, una por rol. `admin` cubre un solo rol.
3. **Políticas inmutables.** `policies` y `audit_log` son append-only (triggers de Postgres bloquean UPDATE/DELETE). Cambiar una política crea una versión nueva.
4. **Auditoría encadenada por hash** (`GET /audit/verify`) para evidenciar manipulación.
5. **Ejecución idempotente:** `jobId` = id de acción (no se encola dos veces), reintentos con backoff exponencial, re-entrega segura (si ya `DONE`, no hace nada), índice único parcial que evita acciones abiertas duplicadas.
6. **Zero-downtime:** tras `apply` se hace healthcheck; si falla se ejecuta rollback y la acción queda `ROLLED_BACK` sin reintentar.
7. **Terraform GitOps:** el motor genera un diff de *vista previa*; el ejecutor real (`TERRAFORM_DIR`) aplica sobre configuración ya revisada acotada con `-target`. Sin `TERRAFORM_DIR` se usa un ejecutor simulado (por defecto).
8. **Secretos nunca se persisten:** los textos escaneados (`text_scans`) se redactan en los hallazgos y se excluyen de la evidencia.
9. **Auth fail-closed:** sin `API_KEYS` configuradas nadie puede llamar al API.

## Limitaciones conocidas
- Conector en vivo solo para AWS (EC2, CloudWatch, Cost Explorer, claves IAM), probado con clientes simulados, no contra una cuenta real. GCP/Azure: solo importación de archivos.
- OIDC probado con claves locales, no contra un IdP real. No hay multi-tenant.
- El rollback requiere `ROLLBACK_COMMAND` en modo Terraform.
- Fuera de AWS la utilización viene del inventario subido.
- El ejecutor Terraform se probó con un binario simulado, no con `terraform` real; las imágenes Docker no se han construido en este entorno.
