import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { graceDays } from './billing-config';
import {
  expireRestaurantIfLapsed,
  isPastGrace,
} from './billing-webhook.service';
import { RazorpayService } from './razorpay.service';

/**
 * Daily safety net for missed webhooks. Only looks at restaurants that HAVE
 * a subscription; skipped entirely when Razorpay is not configured.
 */
@Injectable()
export class BillingReconcileService {
  private readonly logger = new Logger(BillingReconcileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async run(now = new Date()) {
    if (!this.razorpay.isConfigured()) return;
    const grace = graceDays();
    const due = await this.prisma.subscription.findMany({
      where: {
        status: { in: ['ACTIVE', 'PAST_DUE'] },
        currentPeriodEnd: { not: null },
      },
    });
    for (const sub of due.filter((s) =>
      isPastGrace(s.currentPeriodEnd, grace, now),
    )) {
      try {
        const rz = await this.razorpay.fetchSubscription(
          sub.razorpaySubscriptionId,
        );
        const end = rz.current_end ? new Date(rz.current_end * 1000) : null;
        if (rz.status === 'active' && end && end > now) {
          await this.prisma.subscription.update({
            where: { id: sub.id },
            data: { status: 'ACTIVE', currentPeriodEnd: end },
          });
          continue;
        }
        await this.prisma.$transaction(async (tx) => {
          await tx.subscription.update({
            where: { id: sub.id },
            data: {
              status: rz.status === 'cancelled' ? 'CANCELLED' : 'EXPIRED',
            },
          });
          await expireRestaurantIfLapsed(
            tx,
            sub.restaurantId,
            sub.currentPeriodEnd,
            now,
          );
        });
      } catch (e) {
        this.logger.warn(
          `reconcile ${sub.id} failed: ${e instanceof Error ? e.message : 'error'}`,
        );
      }
    }

    // Cancelled at period end: access stops once that period is over.
    const cancelled = await this.prisma.subscription.findMany({
      where: { status: 'CANCELLED', currentPeriodEnd: { lt: now } },
      select: { restaurantId: true, currentPeriodEnd: true },
    });
    for (const sub of cancelled) {
      const newer = await this.prisma.subscription.count({
        where: {
          restaurantId: sub.restaurantId,
          status: { in: ['ACTIVE', 'PAST_DUE'] },
        },
      });
      if (newer === 0) {
        await expireRestaurantIfLapsed(
          this.prisma,
          sub.restaurantId,
          sub.currentPeriodEnd,
          now,
        );
      }
    }
  }
}
