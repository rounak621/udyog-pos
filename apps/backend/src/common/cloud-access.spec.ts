import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  extendTrialSchema,
  getAccessState,
  resolveTrialDays,
} from '@nodedr-restaurant/types';
import { AuthService } from '../auth/auth.service';
import { JwtStrategy } from '../auth/jwt.strategy';
import { PlatformController } from '../modules/platform/platform.controller';
import { withLocalOnlyColumns } from '../sync/sync.service';
import { PlatformAdminGuard } from './guards/platform-admin.guard';

// Hosted-mode lock, trial and platform screen: unit level, mocked Prisma.

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-11T12:00:00Z');

describe('getAccessState', () => {
  it('suspended is blocked; active is allowed', () => {
    expect(
      getAccessState({ status: 'SUSPENDED', trialEndsAt: null }, NOW),
    ).toEqual({
      allowed: false,
      code: 'RESTAURANT_SUSPENDED',
      daysLeft: null,
    });
    expect(
      getAccessState({ status: 'ACTIVE', trialEndsAt: null }, NOW),
    ).toEqual({
      allowed: true,
      code: null,
      daysLeft: null,
    });
  });

  it('trial: expired is blocked; running trial rounds days left up', () => {
    const past = new Date(NOW.getTime() - 1000);
    expect(
      getAccessState({ status: 'TRIAL', trialEndsAt: past }, NOW),
    ).toMatchObject({
      allowed: false,
      code: 'TRIAL_EXPIRED',
    });
    const inOneAndAHalfDays = new Date(NOW.getTime() + 1.5 * DAY);
    expect(
      getAccessState({ status: 'TRIAL', trialEndsAt: inOneAndAHalfDays }, NOW),
    ).toEqual({ allowed: true, code: null, daysLeft: 2 });
  });
});

describe('JwtStrategy lock', () => {
  const strategyFor = (
    status: string,
    trialEndsAt: Date | null,
    isPlatformAdmin: boolean,
  ) =>
    new JwtStrategy(
      { getOrThrow: () => 'test-secret' } as never,
      {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'u1',
            restaurantId: 'r1',
            name: 'Owner',
            roleId: 'role1',
            isActive: true,
            isPlatformAdmin,
            role: { name: 'OWNER', permissions: [] },
            restaurant: { status, trialEndsAt },
          }),
        },
      } as never,
    );

  it('rejects suspended and expired restaurants with the code', async () => {
    await expect(
      strategyFor('SUSPENDED', null, false).validate({}, { sub: 'u1' }),
    ).rejects.toMatchObject({ response: { code: 'RESTAURANT_SUSPENDED' } });
    const err = await strategyFor('TRIAL', new Date(Date.now() - DAY), false)
      .validate({}, { sub: 'u1' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: 'TRIAL_EXPIRED',
    });
  });

  it('lets a platform admin through even when suspended', async () => {
    await expect(
      strategyFor('SUSPENDED', null, true).validate({}, { sub: 'u1' }),
    ).resolves.toMatchObject({ id: 'u1', isPlatformAdmin: true });
  });
});

describe('platform routes', () => {
  it('extend-trial rejects 0 and 91 days', () => {
    expect(extendTrialSchema.safeParse({ days: 0 }).success).toBe(false);
    expect(extendTrialSchema.safeParse({ days: 91 }).success).toBe(false);
    expect(extendTrialSchema.safeParse({ days: 1 }).success).toBe(true);
    expect(extendTrialSchema.safeParse({ days: 90 }).success).toBe(true);
  });

  it('every route is guarded by PlatformAdminGuard, which rejects a non-admin', () => {
    const proto = PlatformController.prototype as unknown as Record<
      string,
      unknown
    >;
    const routes = Object.getOwnPropertyNames(proto).filter(
      (k) => k !== 'constructor',
    );
    expect(routes.length).toBe(5);
    for (const name of routes) {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        proto[name] as object,
      ) as unknown[];
      expect(guards).toContain(PlatformAdminGuard);
    }
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { isPlatformAdmin: false } }),
      }),
    };
    expect(() => new PlatformAdminGuard().canActivate(ctx as never)).toThrow(
      ForbiddenException,
    );
  });
});

describe('register', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  const registerAndCapture = async () => {
    const restaurantCreate = jest.fn().mockResolvedValue({ id: 'r1' });
    const tx = {
      restaurant: { create: restaurantCreate },
      branch: { create: jest.fn().mockResolvedValue({ id: 'b1' }) },
      role: { create: jest.fn().mockResolvedValue({ id: 'role1' }) },
      rolePermission: { createMany: jest.fn() },
      user: {
        create: jest.fn().mockResolvedValue({
          id: 'u1',
          restaurantId: 'r1',
          name: 'Owner',
          roleId: 'role1',
          isPlatformAdmin: false,
          role: { name: 'OWNER', permissions: [] },
        }),
      },
      userBranch: { create: jest.fn() },
    };
    const prisma = {
      restaurant: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findFirst: jest.fn().mockResolvedValue(null) },
      permission: {
        upsert: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    };
    const svc = new AuthService(
      prisma as never,
      { signAsync: jest.fn().mockResolvedValue('token') } as never,
      {} as never,
    );
    const before = Date.now();
    await svc.register({
      restaurantName: 'Cafe',
      branchName: 'Main',
      ownerName: 'Owner',
      email: 'owner@example.com',
      password: 'longpassword',
    });
    return { data: restaurantCreate.mock.calls[0][0].data, before };
  };

  it('hosted mode starts a TRIAL of TRIAL_DAYS; an invalid TRIAL_DAYS falls back to 14', async () => {
    process.env.ALLOW_SIGNUP = 'true';
    process.env.TRIAL_DAYS = '7';
    const { data, before } = await registerAndCapture();
    expect(data.status).toBe('TRIAL');
    const days = (data.trialEndsAt.getTime() - before) / DAY;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);

    for (const bad of ['0', '-3', '2.5', 'abc', ''])
      expect(resolveTrialDays(bad)).toBe(14);
    process.env.TRIAL_DAYS = 'abc';
    const second = await registerAndCapture();
    expect(
      (second.data.trialEndsAt.getTime() - second.before) / DAY,
    ).toBeCloseTo(14, 2);
  });

  it('first local setup (no ALLOW_SIGNUP) stays ACTIVE (no trial)', async () => {
    delete process.env.ALLOW_SIGNUP;
    const { data } = await registerAndCapture();
    expect(data.status).toBeUndefined(); // column default ACTIVE
    expect(data.trialEndsAt).toBeUndefined();
  });
});

describe('sync', () => {
  it('never copies isPlatformAdmin from another install', () => {
    expect(
      withLocalOnlyColumns('users', {
        id: 'u1',
        name: 'X',
        isPlatformAdmin: true,
      }),
    ).toEqual({ id: 'u1', name: 'X', isPlatformAdmin: false });
    expect(withLocalOnlyColumns('orders', { id: 'o1' })).toEqual({ id: 'o1' });
  });
});
