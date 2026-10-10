export const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS actions (
  id UUID PRIMARY KEY,
  dedupe_key TEXT NOT NULL,
  proposal JSONB NOT NULL,
  status TEXT NOT NULL,
  required_roles TEXT[] NOT NULL DEFAULT '{}',
  approvals JSONB NOT NULL DEFAULT '[]',
  error TEXT,
  evidence_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS actions_open_dedupe ON actions(dedupe_key)
  WHERE status IN ('PENDING_APPROVAL','APPROVED','EXECUTING');
CREATE TABLE IF NOT EXISTS audit_log (
  seq BIGSERIAL PRIMARY KEY, at TIMESTAMPTZ NOT NULL DEFAULT now(),
  actor TEXT NOT NULL, event TEXT NOT NULL, subject TEXT, data JSONB NOT NULL DEFAULT '{}',
  prev_hash TEXT NOT NULL, hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS policies (
  version SERIAL PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), created_by TEXT NOT NULL, body JSONB NOT NULL
);
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_immutable ON audit_log;
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
DROP TRIGGER IF EXISTS policies_immutable ON policies;
CREATE TRIGGER policies_immutable BEFORE UPDATE OR DELETE ON policies FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
`;
