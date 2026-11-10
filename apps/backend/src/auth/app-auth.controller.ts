import { Body, Controller, Get, Post, Query, UsePipes } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import {
  appLoginSchema,
  appPinLoginSchema,
  type AppLoginDto,
  type AppPinLoginDto,
  type AppTokenResponse,
  type PinStaffMember,
  type SessionUser,
} from '@nodedr-restaurant/types';
import { Auth } from '../common/decorators/auth.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { BranchAccessService } from '../common/services/branch-access.service';
import { LoginThrottle } from '../common/throttle/login-throttle';
import { PrismaService } from '../prisma/prisma.service';
import { AppSessionsService } from './app-sessions.service';
import { AuthService } from './auth.service';

// Owners and administrators work in every branch without a UserBranch row
// (same rule as GET /branches).
const ALL_BRANCH_ROLES = ['OWNER', 'ADMINISTRATOR'];

/**
 * Sign-in for native apps. Never sets a cookie: the app keeps the tokens in
 * its own secure storage and sends `Authorization: Bearer <accessToken>`.
 * Credential checks, throttles and restaurant status rules are the same as
 * the web logins (AuthService.verifyPasswordLogin / verifyPinLogin).
 */
@ApiTags('auth')
@Controller('v1/auth/app')
export class AppAuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly appSessions: AppSessionsService,
    private readonly prisma: PrismaService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  // Per IP: 20/min; per IP + email: 5/min (login throttler).
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @LoginThrottle('email')
  @Post('login')
  @UsePipes(new ZodValidationPipe(appLoginSchema))
  async login(@Body() body: unknown): Promise<AppTokenResponse> {
    const dto = body as AppLoginDto;
    const user = await this.authService.verifyPasswordLogin(dto);
    return this.appSessions.create(user, dto.deviceName);
  }

  // Per IP: 20/min; per IP + userId: 5/min (login throttler).
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @LoginThrottle('userId')
  @Post('pin-login')
  @UsePipes(new ZodValidationPipe(appPinLoginSchema))
  async pinLogin(@Body() body: unknown): Promise<AppTokenResponse> {
    const dto = body as AppPinLoginDto;
    const user = await this.authService.verifyPinLogin(dto);
    return this.appSessions.create(user, dto.deviceName);
  }

  /**
   * Staff who can sign in with a PIN on this branch (for a shared device's
   * "who are you?" screen). Needs a signed-in manager (users.manage); never
   * public. Only id, name and role. Accounts with two-factor are left out
   * because PIN login refuses them.
   */
  @Auth('users.manage')
  @Get('pin-staff')
  async pinStaff(
    @CurrentUser() user: SessionUser,
    @Query('branchId') branchId: string,
  ): Promise<PinStaffMember[]> {
    await this.branchAccess.assertAccess(user.restaurantId, branchId);
    const staff = await this.prisma.user.findMany({
      where: {
        restaurantId: user.restaurantId,
        isActive: true,
        pinHash: { not: null },
        twoFactorEnabled: false,
        OR: [
          { branches: { some: { branchId } } },
          { role: { name: { in: ALL_BRANCH_ROLES } } },
        ],
      },
      select: { id: true, name: true, role: { select: { name: true } } },
      orderBy: { name: 'asc' },
    });
    return staff.map((s) => ({ id: s.id, name: s.name, role: s.role.name }));
  }
}
