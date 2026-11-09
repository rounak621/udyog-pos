import { ForbiddenException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  getAccessState,
  type AccessBlockCode,
  type RestaurantStatus,
} from '@nodedr-restaurant/types';

// Backend side of the hosted-mode lock. The rule itself lives in ONE place,
// getAccessState (@nodedr-restaurant/types); this file only turns its answer
// into an HTTP error, and offers the same rule as a Prisma filter for
// background jobs that select many rows at once.

type RestaurantAccessFields = {
  status: RestaurantStatus;
  trialEndsAt: Date | null;
};

/** Select these on a restaurant to check access. */
export const RESTAURANT_ACCESS_SELECT = {
  status: true,
  trialEndsAt: true,
} as const;

export const ACCESS_BLOCK_MESSAGES: Record<AccessBlockCode, string> = {
  RESTAURANT_SUSPENDED: 'This account is suspended. Please contact support.',
  TRIAL_EXPIRED:
    'Your free trial has ended. Please contact support to continue.',
};

export function isRestaurantAllowed(
  restaurant: RestaurantAccessFields,
  now = new Date(),
): boolean {
  return getAccessState(restaurant, now).allowed;
}

/**
 * 403 { code: RESTAURANT_SUSPENDED | TRIAL_EXPIRED, message } when the
 * restaurant may not use the app. Platform admins are always let through.
 */
export function assertRestaurantAllowed(
  restaurant: RestaurantAccessFields,
  opts: { isPlatformAdmin?: boolean } = {},
): void {
  if (opts.isPlatformAdmin) return;
  const state = getAccessState(restaurant);
  if (state.allowed || !state.code) return;
  throw new ForbiddenException({
    statusCode: 403,
    code: state.code,
    message: ACCESS_BLOCK_MESSAGES[state.code],
  });
}

/**
 * Same rule as getAccessState, as a Prisma filter (for cron jobs): ACTIVE, or
 * TRIAL with no end date or an end date still in the future.
 */
export function allowedRestaurantWhere(
  now = new Date(),
): Prisma.RestaurantWhereInput {
  return {
    OR: [
      { status: 'ACTIVE' },
      {
        status: 'TRIAL',
        OR: [{ trialEndsAt: null }, { trialEndsAt: { gt: now } }],
      },
    ],
  };
}
