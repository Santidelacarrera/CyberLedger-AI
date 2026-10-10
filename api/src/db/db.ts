import { Pool } from 'pg';
import { cfg } from '../config';
import { MIGRATION_LIST } from './migrations';

export const PG = 'PG_POOL';

export const pgProvider = {
  provide: PG,
  useFactory: async (): Promise<Pool | null> => {
    const url = cfg().databaseUrl;
    if (!url) return null; // in-memory mode (dev/tests)
    const pool = new Pool({ connectionString: url });
    await migrate(pool);
    return pool;
  },
};

/** Versioned, transactional migrations guarded by an advisory lock so concurrent replicas don't race. */
export async function migrate(pool: Pool): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query('SELECT pg_advisory_lock(727274)');
    await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (id INT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const done = new Set((await c.query('SELECT id FROM schema_migrations')).rows.map((r) => r.id));
    for (const m of MIGRATION_LIST.filter((m) => !done.has(m.id))) {
      await c.query('BEGIN');
      try { await c.query(m.sql); await c.query('INSERT INTO schema_migrations(id) VALUES ($1)', [m.id]); await c.query('COMMIT'); }
      catch (e) { await c.query('ROLLBACK'); throw e; }
    }
  } finally { await c.query('SELECT pg_advisory_unlock(727274)').catch(() => undefined); c.release(); }
}
