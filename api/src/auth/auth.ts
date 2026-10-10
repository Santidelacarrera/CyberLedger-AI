import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify, JWTVerifyGetKey } from 'jose';
import { AuthKey, cfg, parseKeys, Role } from '../config';

export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
export const Public = () => SetMetadata('public', true);

const RANK: Role[] = ['admin', 'secops', 'finops'];

/** Picks the strongest known role from an OIDC claim (string or array). Unknown roles grant nothing. */
export function mapRole(claim: unknown): Role | undefined {
  const vals = (Array.isArray(claim) ? claim : [claim]).map((v) => String(v).toLowerCase());
  return RANK.find((r) => vals.includes(r));
}

@Injectable()
export class AuthGuard implements CanActivate {
  private keys = parseKeys();
  /** replaceable in tests */
  jwks: JWTVerifyGetKey | undefined = cfg().oidc.jwksUri ? createRemoteJWKSet(new URL(cfg().oidc.jwksUri!)) : undefined;
  constructor(private reflector: Reflector) {}

  private async identify(req: any): Promise<{ user: string; role: Role } | undefined> {
    const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1];
    if (bearer && this.jwks) {
      const o = cfg().oidc;
      try {
        const { payload } = await jwtVerify(bearer, this.jwks, { issuer: o.issuer, audience: o.audience });
        const role = mapRole(payload[o.roleClaim]);
        if (!role) return undefined;
        return { user: String(payload.email ?? payload.sub), role };
      } catch { return undefined; }
    }
    const found: AuthKey | undefined = this.keys.find((k) => k.key === req.headers['x-api-key']);
    return found && { user: found.user, role: found.role };
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>('public', targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const id = await this.identify(req);
    if (!id) throw new UnauthorizedException();
    const roles = this.reflector.getAllAndOverride<Role[]>('roles', targets);
    if (roles?.length && id.role !== 'admin' && !roles.includes(id.role)) throw new ForbiddenException();
    req.user = id;
    return true;
  }
}
