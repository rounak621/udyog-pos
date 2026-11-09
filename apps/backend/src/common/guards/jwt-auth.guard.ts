import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ALLOW_WHEN_EXPIRED_KEY } from '../decorators/allow-when-expired.decorator';

/** Request flag read by JwtStrategy (see @AllowWhenExpired). */
export interface AllowWhenExpiredRequest {
  allowWhenExpired?: boolean;
}

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AllowWhenExpiredRequest>();
    req.allowWhenExpired =
      this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_EXPIRED_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true;
    return super.canActivate(context);
  }
}
