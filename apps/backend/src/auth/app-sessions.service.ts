import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type {
  AppSessionInfo,
  AppTokenResponse,
  SessionUser,
} from '@nodedr-restaurant/types';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  RESTAURANT_ACCESS_SELECT,
  assertRestaurantAllowed,
} from '../common/restaurant-access';

// App sign-in sessions (Android app and other native clients).
//
// - Access token: a JWT of APP_ACCESS_TOKEN_MINUTES (default 15) carrying
//   { sub: userId, sid: sessionId }. JwtStrategy and the realtime gateway
//   reject it once the session is revoked or expired.
// - Refresh token: "<sessionId>.<random secret>". Only a SHA-256 hash of the
//   secret is stored. Every refresh rotates it and moves the session's
//   expiry to now + APP_REFRESH_TOKEN_DAYS (default 30).
// - Reuse detection: a refresh token whose secret is not the current one
//   (an old, already rotated token, or two refreshes racing) revokes the
//   whole session; the app must sign in again. Apps must therefore refresh
//   one request at a time.
// Web sign-in is untouched: cookie tokens carry no sid.

function envInt(name: string, fallback: number, min: number, max: number) {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

export function appAccessTokenSeconds(): number {
  return envInt('APP_ACCESS_TOKEN_MINUTES', 15, 1, 24 * 60) * 60;
}

export function appRefreshTokenDays(): number {
  return envInt('APP_REFRESH_TOKEN_DAYS', 30, 1, 365);
}

export function hashRefreshSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** "<sessionId>.<secret>" -> parts, or null for anything malformed. */
export function splitRefreshToken(
  token: string,
): { sessionId: string; secret: string } | null {
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const sessionId = token.slice(0, dot);
  const secret = token.slice(dot + 1);
  if (!/^[a-z0-9]{10,40}$/.test(sessionId)) return null;
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(secret)) return null;
  return { sessionId, secret };
}

const newSecret = () => randomBytes(48).toString('base64url');

/**
 * Throws 401 unless the app session exists, belongs to the user, is not
 * revoked and has not expired. Shared by JwtStrategy and the realtime
 * gateway.
 */
export async function assertAppSessionActive(
  prisma: PrismaService,
  sessionId: string,
  userId: string,
): Promise<void> {
  const session = await prisma.appSession.findUnique({
    where: { id: sessionId },
    select: { userId: true, revokedAt: true, expiresAt: true },
  });
  if (
    !session ||
    session.userId !== userId ||
    session.revokedAt !== null ||
    session.expiresAt.getTime() <= Date.now()
  ) {
    throw new UnauthorizedException('Session no longer valid');
  }
}

const USER_WITH_ROLE = {
  role: { include: { permissions: { include: { permission: true } } } },
  restaurant: { select: RESTAURANT_ACCESS_SELECT },
} as const;

@Injectable()
export class AppSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  /** New session after a successful app login or PIN login. */
  async create(
    user: SessionUser,
    deviceName?: string,
  ): Promise<AppTokenResponse> {
    const secret = newSecret();
    const session = await this.prisma.appSession.create({
      data: {
        userId: user.id,
        restaurantId: user.restaurantId,
        refreshTokenHash: hashRefreshSecret(secret),
        deviceName: deviceName ?? null,
        expiresAt: this.refreshExpiry(),
      },
    });
    return this.tokens(user, session.id, secret, session.expiresAt);
  }

  /** Rotates the refresh token and issues a new access token. */
  async refresh(refreshToken: string): Promise<AppTokenResponse> {
    const invalid = () => new UnauthorizedException('Invalid refresh token');
    const parts = splitRefreshToken(refreshToken);
    if (!parts) throw invalid();

    const session = await this.prisma.appSession.findUnique({
      where: { id: parts.sessionId },
    });
    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now()
    ) {
      throw invalid();
    }

    const presentedHash = hashRefreshSecret(parts.secret);
    if (presentedHash !== session.refreshTokenHash) {
      // Reuse of a rotated token: someone else may hold this session.
      await this.revoke(session.id);
      throw new UnauthorizedException(
        'Refresh token was already used; please sign in again',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.userId },
      include: USER_WITH_ROLE,
    });
    if (!user || !user.isActive) {
      await this.revoke(session.id);
      throw invalid();
    }
    // Same rule as email login: SUSPENDED is refused; an expired trial or
    // subscription still gets a session (other routes answer 403 + code).
    assertRestaurantAllowed(user.restaurant, {
      isPlatformAdmin: user.isPlatformAdmin,
      allowExpired: true,
    });

    const secret = newSecret();
    const expiresAt = this.refreshExpiry();
    const rotated = await this.prisma.appSession.updateMany({
      where: {
        id: session.id,
        refreshTokenHash: presentedHash,
        revokedAt: null,
      },
      data: {
        refreshTokenHash: hashRefreshSecret(secret),
        lastUsedAt: new Date(),
        expiresAt,
      },
    });
    if (rotated.count === 0) {
      // Another refresh with the same token won the race: treat as reuse.
      await this.revoke(session.id);
      throw new UnauthorizedException(
        'Refresh token was already used; please sign in again',
      );
    }

    return this.tokens(
      {
        id: user.id,
        restaurantId: user.restaurantId,
        name: user.name,
        roleId: user.roleId,
        roleName: user.role.name,
        permissions: user.role.permissions.map((rp) => rp.permission.key),
        isPlatformAdmin: user.isPlatformAdmin,
      },
      session.id,
      secret,
      expiresAt,
    );
  }

  /** Revokes one session (no-op if already revoked). */
  async revoke(sessionId: string, userId?: string): Promise<void> {
    await this.prisma.appSession.updateMany({
      where: { id: sessionId, revokedAt: null, ...(userId ? { userId } : {}) },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every app session of a user (logout-all, password change, deactivation). */
  async revokeAllForUser(userId: string): Promise<number> {
    const res = await this.prisma.appSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return res.count;
  }

  /** The user's active (not revoked, not expired) sessions. */
  async list(
    userId: string,
    currentSessionId?: string,
  ): Promise<AppSessionInfo[]> {
    const sessions = await this.prisma.appSession.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        deviceName: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
    });
    return sessions.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      current: s.id === currentSessionId,
    }));
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + appRefreshTokenDays() * 86_400_000);
  }

  private async tokens(
    user: SessionUser,
    sessionId: string,
    secret: string,
    refreshExpiresAt: Date,
  ): Promise<AppTokenResponse> {
    const ttl = appAccessTokenSeconds();
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, sid: sessionId },
      { expiresIn: ttl },
    );
    return {
      accessToken,
      refreshToken: `${sessionId}.${secret}`,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      refreshExpiresAt: refreshExpiresAt.toISOString(),
      user: { ...user, sessionId },
    };
  }
}
