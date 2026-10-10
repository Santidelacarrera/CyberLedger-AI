import { Pool } from 'pg';
import { cfg } from '../config';
import { MIGRATIONS } from './migrations';

export const PG = 'PG_POOL';

export const pgProvider = {
  provide: PG,
  useFactory: async (): Promise<Pool | null> => {
    const url = cfg().databaseUrl;
    if (!url) return null; // in-memory mode (dev/tests)
    const pool = new Pool({ connectionString: url });
    await pool.query(MIGRATIONS);
    return pool;
  },
};
