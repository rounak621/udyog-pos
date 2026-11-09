import { SetMetadata } from '@nestjs/common';

export const ALLOW_WHEN_EXPIRED_KEY = 'allowWhenExpired';

/**
 * Billing routes only: a logged-in user of a restaurant whose trial or
 * subscription has expired (TRIAL_EXPIRED / SUBSCRIPTION_EXPIRED) may still
 * reach this route, so they can pay. A SUSPENDED restaurant is still refused.
 * Read by JwtAuthGuard and enforced in JwtStrategy.
 */
export const AllowWhenExpired = () => SetMetadata(ALLOW_WHEN_EXPIRED_KEY, true);
