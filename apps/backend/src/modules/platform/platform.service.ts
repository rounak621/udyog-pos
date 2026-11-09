import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  getAccessState,
  PLATFORM_PAGE_SIZE,
  type ExtendTrialDto,
  type PlatformRestaurantListQuery,
  type SessionUser,
  type SuspendRestaurantDto,
} from '@nodedr-restaurant/types';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Platform admin view of every restaurant on this server. Returns account
 * metadata only (name, owner email, counts, status): never orders,
 * customers, menu or money.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: PlatformRestaurantListQuery) {
    const search = query.search?.trim();
    const where: Prisma.RestaurantWhereInput = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            {
              users: {
                some: {
                  role: { name: 'OWNER' },
                  email: { contains: search, mode: 'insensitive' },
                },
              },
            },
          ],
        }
      : {};
    const [total, rows] = await Promise.all([
      this.prisma.restaurant.count({ where }),
      this.prisma.restaurant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * PLATFORM_PAGE_SIZE,
        take: PLATFORM_PAGE_SIZE,
        select: {
          id: true,
          name: true,
          createdAt: true,
          status: true,
          trialEndsAt: true,
          suspendedAt: true,
          suspendedReason: true,
          _count: { select: { branches: true, users: true } },
          // The owner: the earliest-created user holding the OWNER role.
          // Latest subscription (not an abandoned checkout): plan + status.
          subscriptions: {
            where: { status: { not: 'CREATED' } },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { status: true, plan: { select: { name: true } } },
          },
          users: {
            where: { role: { name: 'OWNER' } },
            orderBy: { createdAt: 'asc' },
            take: 1,
            select: { email: true },
          },
        },
      }),
    ]);
    const now = new Date();
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        ownerEmail: r.users[0]?.email ?? null,
        branchCount: r._count.branches,
        userCount: r._count.users,
        createdAt: r.createdAt,
        status: r.status,
        trialEndsAt: r.trialEndsAt,
        suspendedAt: r.suspendedAt,
        suspendedReason: r.suspendedReason,
        daysLeft: getAccessState(r, now).daysLeft,
        planName: r.subscriptions[0]?.plan.name ?? null,
        subscriptionStatus: r.subscriptions[0]?.status ?? null,
      })),
      total,
      page: query.page,
      pageSize: PLATFORM_PAGE_SIZE,
    };
  }

  async suspend(admin: SessionUser, id: string, dto: SuspendRestaurantDto) {
    await this.get(id);
    if (id === admin.restaurantId) {
      throw new BadRequestException(
        'You cannot suspend the restaurant your own account belongs to',
      );
    }
    return this.apply(admin, id, 'platform.restaurant_suspended', {
      status: 'SUSPENDED',
      suspendedAt: new Date(),
      suspendedReason: dto.reason || null,
    });
  }

  async unsuspend(admin: SessionUser, id: string) {
    const r = await this.get(id);
    const trialRunning = !!r.trialEndsAt && r.trialEndsAt > new Date();
    return this.apply(admin, id, 'platform.restaurant_unsuspended', {
      status: trialRunning ? 'TRIAL' : 'ACTIVE',
      suspendedAt: null,
      suspendedReason: null,
    });
  }

  async extendTrial(admin: SessionUser, id: string, dto: ExtendTrialDto) {
    const r = await this.get(id);
    const now = Date.now();
    const from = Math.max(now, r.trialEndsAt?.getTime() ?? now);
    return this.apply(admin, id, 'platform.trial_extended', {
      status: 'TRIAL',
      trialEndsAt: new Date(from + dto.days * DAY_MS),
      suspendedAt: null,
      suspendedReason: null,
    });
  }

  async markActive(admin: SessionUser, id: string) {
    await this.get(id);
    return this.apply(admin, id, 'platform.restaurant_marked_active', {
      status: 'ACTIVE',
      suspendedAt: null,
      suspendedReason: null,
    });
  }

  private async get(id: string) {
    const r = await this.prisma.restaurant.findUnique({
      where: { id },
      select: { id: true, trialEndsAt: true },
    });
    if (!r) throw new NotFoundException('Restaurant not found');
    return r;
  }

  private async apply(
    admin: SessionUser,
    id: string,
    action: string,
    data: Prisma.RestaurantUpdateInput,
  ) {
    const updated = await this.prisma.restaurant.update({
      where: { id },
      data,
      select: {
        id: true,
        status: true,
        trialEndsAt: true,
        suspendedAt: true,
        suspendedReason: true,
      },
    });
    await this.audit.record({
      userId: admin.id,
      action,
      entity: 'Restaurant',
      entityId: id,
      metadata: {
        status: updated.status,
        trialEndsAt: updated.trialEndsAt?.toISOString() ?? null,
        suspendedReason: updated.suspendedReason,
      },
    });
    return { ...updated, daysLeft: getAccessState(updated).daysLeft };
  }
}
