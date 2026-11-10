import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import {
  createStaffSchema,
  pinLoginSchema,
  updateStaffSchema,
  type SessionUser,
} from '@nodedr-restaurant/types';
import { AuthService } from '../auth/auth.service';
import { MenuService } from '../modules/menu/menu.service';
import { PublicMenuService } from '../modules/public/public-menu.service';
import { UsersService } from '../modules/users/users.service';
import { PlatformAdminGuard } from './guards/platform-admin.guard';

// Unit-level tenant-isolation checks with a mocked Prisma (no database).

const owner = (isPlatformAdmin: boolean): SessionUser => ({
  id: 'u1',
  restaurantId: 'r1',
  name: 'Owner',
  roleId: 'role1',
  roleName: 'OWNER',
  permissions: ['backup.manage', 'settings.manage', 'system.update'],
  isPlatformAdmin,
});
const ctxFor = (user?: SessionUser) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;
const audit = { record: jest.fn() } as never;

describe('PlatformAdminGuard', () => {
  it('rejects an OWNER with every permission but no platform flag', () => {
    expect(() =>
      new PlatformAdminGuard().canActivate(ctxFor(owner(false))),
    ).toThrow(ForbiddenException);
  });

  it('allows a user with the platform flag', () => {
    expect(new PlatformAdminGuard().canActivate(ctxFor(owner(true)))).toBe(
      true,
    );
  });
});

describe('isPlatformAdmin cannot be mass-assigned', () => {
  it('staff create/update schemas strip it and the service never writes it', async () => {
    const body = {
      name: 'Eve',
      email: 'eve@example.com',
      password: 'longpassword',
      roleId: 'role1',
      branchIds: ['b1'],
      isPlatformAdmin: true,
    };
    const dto = createStaffSchema.parse(body);
    expect(dto).not.toHaveProperty('isPlatformAdmin');
    expect(updateStaffSchema.parse({ isPlatformAdmin: true })).toEqual({});

    const create = jest.fn().mockResolvedValue({ id: 'u2', email: dto.email });
    const prisma = {
      role: { findFirst: jest.fn().mockResolvedValue({ id: 'role1' }) },
      branch: { count: jest.fn().mockResolvedValue(1) },
      subscription: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findFirst: jest.fn().mockResolvedValue(null), create },
    };
    await new UsersService(prisma as never, audit, { revokeAllForUser: jest.fn() } as never).create('r1', 'u1', {
      ...dto,
      isPlatformAdmin: true,
    } as never);
    expect(create.mock.calls[0][0].data).not.toHaveProperty('isPlatformAdmin');
  });
});

describe('menu items: foreign categoryId', () => {
  const prisma = () => ({
    menuCategory: { findFirst: jest.fn().mockResolvedValue(null) },
    kitchenStation: { findFirst: jest.fn() },
    modifierGroup: { count: jest.fn().mockResolvedValue(0) },
    menuItem: {
      findFirst: jest.fn().mockResolvedValue({ id: 'i1', branchId: 'b1' }),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  });

  it('create rejects a category from another branch', async () => {
    const p = prisma();
    await expect(
      new MenuService(p as never, audit).createItem('b1', {
        categoryId: 'other-tenant-cat',
        modifierGroupIds: [],
      } as never),
    ).rejects.toThrow(BadRequestException);
    expect(p.menuCategory.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'other-tenant-cat', branchId: 'b1' },
      }),
    );
    expect(p.menuItem.create).not.toHaveBeenCalled();
  });

  it('update rejects a category from another branch', async () => {
    const p = prisma();
    await expect(
      new MenuService(p as never, audit).updateItem('b1', 'i1', 'u1', {
        categoryId: 'other-tenant-cat',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(p.$transaction).not.toHaveBeenCalled();
  });
});

describe('public menu', () => {
  it('filters category items by the same branch', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const svc = new PublicMenuService(
      { menuCategory: { findMany } } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await svc.menuCategoriesForBranch('b1');
    const args = findMany.mock.calls[0][0];
    expect(args.where.branchId).toBe('b1');
    expect(args.include.items.where.branchId).toBe('b1');
  });
});

describe('staff email', () => {
  it('rejects an email already used in another restaurant', async () => {
    const findFirst = jest.fn().mockResolvedValue({ id: 'someone-else' });
    const prisma = {
      role: { findFirst: jest.fn().mockResolvedValue({ id: 'role1' }) },
      branch: { count: jest.fn().mockResolvedValue(1) },
      subscription: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findFirst, create: jest.fn() },
    };
    await expect(
      new UsersService(prisma as never, audit, { revokeAllForUser: jest.fn() } as never).create('r1', 'u1', {
        name: 'Eve',
        email: 'taken@example.com',
        password: 'longpassword',
        roleId: 'role1',
        branchIds: ['b1'],
      }),
    ).rejects.toThrow(ConflictException);
    // The lookup is global: not limited to the caller's restaurant.
    expect(findFirst.mock.calls[0][0].where).toEqual({
      email: 'taken@example.com',
    });
  });
});

describe('pin-login', () => {
  it('needs a branch, and a user outside that branch gets the generic error', async () => {
    expect(
      pinLoginSchema.safeParse({ userId: 'u1', pin: '1234' }).success,
    ).toBe(false);
    const findFirst = jest.fn().mockResolvedValue(null);
    const svc = new AuthService(
      { user: { findFirst } } as never,
      {} as never,
      {} as never,
    );
    await expect(
      svc.pinLogin({ branchId: 'other-branch', userId: 'u1', pin: '1234' }),
    ).rejects.toThrow(new UnauthorizedException('Invalid PIN login'));
    expect(findFirst.mock.calls[0][0].where.restaurant).toEqual({
      branches: { some: { id: 'other-branch' } },
    });
  });
});
