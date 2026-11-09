import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { SessionUser } from '@nodedr-restaurant/types';

/**
 * Instance-wide features (backup, server sync, updates, download stats) are
 * for UDYOG platform staff only. Runs after JwtAuthGuard, which loads the
 * user fresh from the database on every request, so the flag cannot be
 * forged by the client. Every restaurant owner gets 403.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context
      .switchToHttp()
      .getRequest<{ user?: SessionUser }>().user;
    if (user?.isPlatformAdmin !== true) {
      throw new ForbiddenException('Platform administrators only');
    }
    return true;
  }
}
