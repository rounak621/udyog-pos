import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { SessionUser } from '@nodedr-restaurant/types';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import type { AllowWhenExpiredRequest } from '../common/guards/jwt-auth.guard';
import {
  RESTAURANT_ACCESS_SELECT,
  assertRestaurantAllowed,
} from '../common/restaurant-access';

interface JwtPayload {
  sub: string;
}

const cookieExtractor = (req: {
  cookies?: Record<string, string>;
}): string | null => {
  return req.cookies?.['udyog_session'] ?? null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      // Web: the httpOnly cookie (unchanged). Apps: Authorization: Bearer.
      // The cookie is tried first, so a browser always uses its cookie.
      jwtFromRequest: ExtractJwt.fromExtractors([
        cookieExtractor,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
      // validate() needs the request for the @AllowWhenExpired flag.
      passReqToCallback: true,
    });
  }

  async validate(
    req: AllowWhenExpiredRequest,
    payload: JwtPayload,
  ): Promise<SessionUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        restaurant: { select: RESTAURANT_ACCESS_SELECT },
      },
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Session no longer valid');
    }
    // Hosted mode: a suspended or expired restaurant is locked on every
    // request (403 + code). Platform admins always get through; billing
    // routes (@AllowWhenExpired) stay open for an expired trial/subscription.
    assertRestaurantAllowed(user.restaurant, {
      isPlatformAdmin: user.isPlatformAdmin,
      allowExpired: req?.allowWhenExpired === true,
    });

    return {
      id: user.id,
      restaurantId: user.restaurantId,
      name: user.name,
      roleId: user.roleId,
      roleName: user.role.name,
      permissions: user.role.permissions.map((rp) => rp.permission.key),
      isPlatformAdmin: user.isPlatformAdmin,
    };
  }
}
