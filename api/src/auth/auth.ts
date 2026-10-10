import { CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthKey, parseKeys, Role } from '../config';

export const Roles = (...roles: Role[]) => SetMetadata('roles', roles);
export const Public = () => SetMetadata('public', true);

@Injectable()
export class AuthGuard implements CanActivate {
  private keys = parseKeys();
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>('public', targets)) return true;
    const req = ctx.switchToHttp().getRequest();
    const found: AuthKey | undefined = this.keys.find((k) => k.key === req.headers['x-api-key']);
    if (!found) throw new UnauthorizedException();
    const roles = this.reflector.getAllAndOverride<Role[]>('roles', targets);
    if (roles?.length && found.role !== 'admin' && !roles.includes(found.role)) throw new ForbiddenException();
    req.user = { user: found.user, role: found.role };
    return true;
  }
}
