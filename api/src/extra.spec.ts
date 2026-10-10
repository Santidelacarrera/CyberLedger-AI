import { chmodSync, mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from 'jose';
import { AuthGuard, mapRole } from './auth/auth';
import { Reflector } from '@nestjs/core';

describe('OIDC auth', () => {
  it('maps roles, strongest wins, unknown grants nothing', () => {
    expect(mapRole(['viewer', 'secops', 'admin'])).toBe('admin');
    expect(mapRole('FinOps')).toBe('finops');
    expect(mapRole(['viewer'])).toBeUndefined();
    expect(mapRole(undefined)).toBeUndefined();
  });

  it('accepts a valid token and rejects wrong audience / issuer / signature', async () => {
    process.env.OIDC_ISSUER = 'https://idp.test'; process.env.OIDC_AUDIENCE = 'cyberledger';
    process.env.OIDC_JWKS_URI = 'https://idp.test/jwks'; process.env.API_KEYS = '';
    const { cfg } = await import('./config');
    expect(cfg().oidc.issuer).toBe('https://idp.test');
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const other = await generateKeyPair('RS256');
    const guard = new AuthGuard(new Reflector());
    guard.jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), alg: 'RS256', kid: 'k1' }] });
    const sign = (key: any, o: { iss?: string; aud?: string; roles?: string[] } = {}) =>
      new SignJWT({ email: 'ana@corp.com', roles: o.roles ?? ['secops'] }).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(o.iss ?? 'https://idp.test').setAudience(o.aud ?? 'cyberledger').setExpirationTime('5m').sign(key);
    const id = (t: string) => (guard as any).identify({ headers: { authorization: `Bearer ${t}` } });
    expect(await id(await sign(privateKey))).toEqual({ user: 'ana@corp.com', role: 'secops' });
    expect(await id(await sign(privateKey, { aud: 'x' }))).toBeUndefined();
    expect(await id(await sign(privateKey, { iss: 'https://evil' }))).toBeUndefined();
    expect(await id(await sign(other.privateKey))).toBeUndefined();
    expect(await id(await sign(privateKey, { roles: ['viewer'] }))).toBeUndefined();
  });
});

describe('TerraformExecutor with a fake terraform binary', () => {
  it('scopes plan/apply with -target and propagates failures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tf-'));
    const log = join(dir, 'calls.log');
    writeFileSync(join(dir, 'terraform'), `#!/bin/sh\necho "$@" >> ${log}\n[ "$FAIL" = 1 ] && exit 3\necho plan-output\n`);
    chmodSync(join(dir, 'terraform'), 0o755);
    process.env.PATH = `${dir}:${process.env.PATH}`; process.env.TERRAFORM_DIR = dir;
    const { TerraformExecutor } = await import('./executor/executor');
    const ex = new TerraformExecutor();
    const rec: any = { id: '1', proposal: { terraform_target: 'aws_instance.api' } };
    expect(await ex.plan(rec)).toContain('plan-output');
    await ex.apply(rec);
    const calls = readFileSync(log, 'utf8');
    expect(calls).toContain('plan -no-color -input=false -lock=false -target=aws_instance.api');
    expect(calls).toContain('apply -no-color -input=false -auto-approve -target=aws_instance.api');
    process.env.FAIL = '1';
    await expect(ex.apply(rec)).rejects.toThrow();
    delete process.env.FAIL;
    await expect(ex.rollback(rec)).rejects.toThrow('no ROLLBACK_COMMAND');
  });
});
