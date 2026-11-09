import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiCookieAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../guards/platform-admin.guard';

/** Logged in AND a platform admin (see PlatformAdminGuard). */
export const PlatformAdmin = () =>
  applyDecorators(
    UseGuards(JwtAuthGuard, PlatformAdminGuard),
    ApiCookieAuth(),
  );
