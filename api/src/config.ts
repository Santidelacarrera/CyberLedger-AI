export interface AuthKey { key: string; user: string; role: Role }
export type Role = 'secops' | 'finops' | 'admin';

/** API_KEYS="key1:alice:secops,key2:bob:finops". Fail closed: no keys configured => nobody can call the API. */
export function parseKeys(raw = process.env.API_KEYS ?? ''): AuthKey[] {
  return raw.split(',').filter(Boolean).map((e) => {
    const [key, user, role] = e.split(':');
    if (!key || !user || !['secops', 'finops', 'admin'].includes(role)) throw new Error(`Bad API_KEYS entry: ${e}`);
    return { key, user, role: role as Role };
  });
}

export const cfg = () => ({
  redis: { host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6379) },
  databaseUrl: process.env.DATABASE_URL,
  engineUrl: process.env.ENGINE_URL ?? 'http://localhost:8000',
  terraformDir: process.env.TERRAFORM_DIR,
  healthcheckUrlTemplate: process.env.HEALTHCHECK_URL_TEMPLATE, // e.g. http://{resource}.internal/health
  s3: { endpoint: process.env.S3_ENDPOINT, bucket: process.env.S3_BUCKET ?? 'evidence',
        accessKey: process.env.S3_ACCESS_KEY ?? 'minioadmin', secretKey: process.env.S3_SECRET_KEY ?? 'minioadmin' },
  evidenceDir: process.env.EVIDENCE_DIR ?? './.evidence',
});
