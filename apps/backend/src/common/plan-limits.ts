import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

export type PlanLimitKind = 'branches' | 'users';

/** True when adding one more would go over the plan's limit (null = unlimited). */
export function exceedsPlanLimit(max: number | null, current: number): boolean {
  return max !== null && current + 1 > max;
}

/**
 * 403 { code: PLAN_LIMIT } if the restaurant's live subscription plan caps
 * branches/users and one more would exceed it. No subscription (trial or
 * free/complimentary) means no limit. Counts active rows only.
 */
export async function assertWithinPlanLimit(
  prisma: PrismaService,
  restaurantId: string,
  kind: PlanLimitKind,
  now = new Date(),
): Promise<void> {
  const sub = await prisma.subscription.findFirst({
    where: {
      restaurantId,
      OR: [
        { status: { in: ['ACTIVE', 'PAST_DUE'] } },
        // Cancelled at period end: the plan still applies until then.
        { status: 'CANCELLED', currentPeriodEnd: { gt: now } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: { plan: { select: { maxBranches: true, maxUsers: true } } },
  });
  if (!sub) return;
  const max = kind === 'branches' ? sub.plan.maxBranches : sub.plan.maxUsers;
  if (max === null) return;
  const current =
    kind === 'branches'
      ? await prisma.branch.count({ where: { restaurantId, isActive: true } })
      : await prisma.user.count({ where: { restaurantId, isActive: true } });
  if (!exceedsPlanLimit(max, current)) return;
  const noun =
    kind === 'branches'
      ? max === 1
        ? 'branch'
        : 'branches'
      : max === 1
        ? 'user'
        : 'users';
  throw new ForbiddenException({
    statusCode: 403,
    code: 'PLAN_LIMIT',
    message: `Your plan allows ${max} ${noun}. Upgrade to add more.`,
  });
}
