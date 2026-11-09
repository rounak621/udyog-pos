import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Plan, Prisma } from '@prisma/client';
import {
  getAccessState,
  type BillingPlansResponse,
  type PlanCyclePrice,
  type SessionUser,
  type SubscribeDto,
  type VerifyCheckoutDto,
} from '@nodedr-restaurant/types';
import { AuditService } from '../../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { gstOnPaise, gstRatePercent } from './billing-config';
import { RazorpayService } from './razorpay.service';

/** A CREATED subscription counts as live only this long (checkout window). */
const CREATED_LIVE_MS = 30 * 60 * 1000;
/** Razorpay needs a fixed number of cycles: about ten years either way. */
const TOTAL_COUNT = { MONTHLY: 120, YEARLY: 10 } as const;

/** Subscriptions that block starting another one. */
export function liveSubscriptionWhere(
  restaurantId: string,
  now = new Date(),
): Prisma.SubscriptionWhereInput {
  return {
    restaurantId,
    OR: [
      { status: { in: ['ACTIVE', 'PAST_DUE'] } },
      {
        status: 'CREATED',
        createdAt: { gt: new Date(now.getTime() - CREATED_LIVE_MS) },
      },
    ],
  };
}

/** Price, GST and whether checkout can start, for one plan and cycle. */
export function cyclePrice(
  price: number | null,
  razorpayPlanId: string | null,
  opts: { enabled: boolean; rate: number | null },
): PlanCyclePrice | null {
  if (price === null) return null;
  const gst = opts.rate === null ? null : gstOnPaise(price, opts.rate);
  const reason = !opts.enabled
    ? 'Online payment is not set up yet'
    : opts.rate === null
      ? 'GST rate is not set yet'
      : !razorpayPlanId
        ? 'This plan is not ready for online payment yet'
        : null;
  return {
    pricePaise: price,
    gstPaise: gst,
    totalPaise: gst === null ? null : price + gst,
    canSubscribe: reason === null,
    reason,
  };
}

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayService,
    private readonly audit: AuditService,
  ) {}

  async plans(): Promise<BillingPlansResponse> {
    const enabled = this.razorpay.isConfigured();
    const rate = gstRatePercent();
    const plans = await this.prisma.plan.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return {
      enabled,
      gstRatePercent: rate,
      plans: plans
        .map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          maxBranches: p.maxBranches,
          maxUsers: p.maxUsers,
          monthly: cyclePrice(p.priceMonthlyPaise, p.razorpayPlanIdMonthly, {
            enabled,
            rate,
          }),
          yearly: cyclePrice(p.priceYearlyPaise, p.razorpayPlanIdYearly, {
            enabled,
            rate,
          }),
        }))
        .filter((p) => p.monthly || p.yearly),
    };
  }

  async status(restaurantId: string) {
    const restaurant = await this.prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      select: { status: true, trialEndsAt: true },
    });
    const subscription = await this.prisma.subscription.findFirst({
      where: { restaurantId, status: { not: 'CREATED' } },
      orderBy: { createdAt: 'desc' },
      include: { plan: { select: { id: true, name: true } } },
    });
    const payments = await this.prisma.subscriptionPayment.findMany({
      where: { restaurantId },
      orderBy: { paidAt: 'desc' },
      take: 24,
      select: {
        id: true,
        amountPaise: true,
        status: true,
        paidAt: true,
        invoiceId: true,
      },
    });
    const access = getAccessState(restaurant);
    return {
      enabled: this.razorpay.isConfigured(),
      restaurant: {
        status: restaurant.status,
        trialEndsAt: restaurant.trialEndsAt,
        daysLeft: access.daysLeft,
        allowed: access.allowed,
        code: access.code,
      },
      subscription: subscription && {
        id: subscription.id,
        plan: subscription.plan,
        status: subscription.status,
        billingCycle: subscription.billingCycle,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      },
      payments,
    };
  }

  async subscribe(user: SessionUser, dto: SubscribeDto) {
    const plan = await this.prisma.plan.findFirst({
      where: { id: dto.planId, isActive: true },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    const { price, razorpayPlanId } = planCycle(plan, dto.cycle);
    const check = cyclePrice(price, razorpayPlanId, {
      enabled: this.razorpay.isConfigured(),
      rate: gstRatePercent(),
    });
    if (!check?.canSubscribe || !razorpayPlanId) {
      throw new BadRequestException(
        check?.reason ?? 'This plan has no price for that cycle',
      );
    }
    const live = await this.prisma.subscription.findFirst({
      where: liveSubscriptionWhere(user.restaurantId),
    });
    if (live) {
      throw new ConflictException(
        live.status === 'CREATED'
          ? 'A checkout was started a few minutes ago. Finish it or try again later.'
          : 'This restaurant already has a subscription',
      );
    }
    const rz = await this.razorpay.createSubscription({
      planId: razorpayPlanId,
      totalCount: TOTAL_COUNT[dto.cycle],
      restaurantId: user.restaurantId,
    });
    await this.prisma.$transaction([
      // Older abandoned checkouts can never be live again.
      this.prisma.subscription.updateMany({
        where: { restaurantId: user.restaurantId, status: 'CREATED' },
        data: { status: 'EXPIRED' },
      }),
      this.prisma.subscription.create({
        data: {
          restaurantId: user.restaurantId,
          planId: plan.id,
          billingCycle: dto.cycle,
          status: 'CREATED',
          razorpaySubscriptionId: rz.id,
        },
      }),
    ]);
    await this.audit.record({
      userId: user.id,
      action: 'billing.subscription_started',
      entity: 'Subscription',
      entityId: rz.id,
      metadata: { planId: plan.id, cycle: dto.cycle },
    });
    return { razorpaySubscriptionId: rz.id, keyId: this.razorpay.keyId() };
  }

  /** Checkout came back: check its signature. The webhook activates. */
  async verify(user: SessionUser, dto: VerifyCheckoutDto) {
    const sub = await this.prisma.subscription.findFirst({
      where: {
        razorpaySubscriptionId: dto.razorpay_subscription_id,
        restaurantId: user.restaurantId,
      },
      select: { id: true },
    });
    if (!sub) throw new NotFoundException('Subscription not found');
    const ok = this.razorpay.verifyCheckoutSignature(
      dto.razorpay_payment_id,
      dto.razorpay_subscription_id,
      dto.razorpay_signature,
    );
    if (!ok)
      throw new BadRequestException('Payment signature could not be verified');
    await this.audit.record({
      userId: user.id,
      action: 'billing.checkout_returned',
      entity: 'Subscription',
      entityId: dto.razorpay_subscription_id,
      metadata: { paymentId: dto.razorpay_payment_id },
    });
    return { ok: true };
  }

  async cancel(user: SessionUser) {
    const sub = await this.prisma.subscription.findFirst({
      where: {
        restaurantId: user.restaurantId,
        status: { in: ['ACTIVE', 'PAST_DUE'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!sub) throw new NotFoundException('No active subscription to cancel');
    await this.razorpay.cancelAtCycleEnd(sub.razorpaySubscriptionId);
    await this.prisma.subscription.update({
      where: { id: sub.id },
      data: { cancelAtPeriodEnd: true },
    });
    await this.audit.record({
      userId: user.id,
      action: 'billing.subscription_cancel_requested',
      entity: 'Subscription',
      entityId: sub.razorpaySubscriptionId,
    });
    return { ok: true, currentPeriodEnd: sub.currentPeriodEnd };
  }
}

export function planCycle(plan: Plan, cycle: 'MONTHLY' | 'YEARLY') {
  return cycle === 'MONTHLY'
    ? {
        price: plan.priceMonthlyPaise,
        razorpayPlanId: plan.razorpayPlanIdMonthly,
      }
    : {
        price: plan.priceYearlyPaise,
        razorpayPlanId: plan.razorpayPlanIdYearly,
      };
}
