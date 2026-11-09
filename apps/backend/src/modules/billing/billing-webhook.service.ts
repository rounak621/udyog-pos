import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { gstRatePercent, splitInclusivePaise } from './billing-config';
import { RazorpayService } from './razorpay.service';

interface RzEntity {
  id?: string;
  status?: string;
  current_start?: number | null;
  current_end?: number | null;
  amount?: number;
  created_at?: number;
  subscription_id?: string;
}

const toDate = (unix?: number | null) =>
  typeof unix === 'number' && unix > 0 ? new Date(unix * 1000) : undefined;

/**
 * Razorpay webhooks are the source of truth for subscription state. Every
 * event is verified (HMAC of the raw body), stored once per event id
 * (BillingEvent) and processed once. Unknown event types are stored and
 * ignored. Only ids, amounts and states are read from the payload.
 */
@Injectable()
export class BillingWebhookService {
  private readonly logger = new Logger(BillingWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly razorpay: RazorpayService,
  ) {}

  async handle(
    rawBody: Buffer | undefined,
    signature?: string,
    eventId?: string,
  ) {
    if (!rawBody || !this.razorpay.verifyWebhookSignature(rawBody, signature)) {
      throw new BadRequestException('Invalid webhook signature');
    }
    if (!eventId) throw new BadRequestException('Missing event id');
    let event: {
      event?: string;
      payload?: Record<string, { entity?: RzEntity }>;
    };
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Invalid JSON');
    }
    const type = String(event.event ?? 'unknown').slice(0, 100);

    const seen = await this.prisma.billingEvent.findUnique({
      where: { razorpayEventId: eventId },
    });
    if (seen?.processedAt) return { ok: true, duplicate: true };
    if (!seen) {
      try {
        await this.prisma.billingEvent.create({
          data: { razorpayEventId: eventId, type },
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          return { ok: true, duplicate: true }; // a parallel delivery has it
        }
        throw e;
      }
    }

    await this.process(type, event.payload ?? {});
    await this.prisma.billingEvent.update({
      where: { razorpayEventId: eventId },
      data: { processedAt: new Date() },
    });
    return { ok: true };
  }

  async process(type: string, payload: Record<string, { entity?: RzEntity }>) {
    const sub = payload.subscription?.entity;
    const payment = payload.payment?.entity;
    const rzSubId = sub?.id ?? payment?.subscription_id;
    if (!rzSubId) return;
    const local = await this.prisma.subscription.findUnique({
      where: { razorpaySubscriptionId: rzSubId },
    });
    if (!local) {
      this.logger.warn(`billing event ${type} for an unknown subscription`);
      return;
    }
    const periods = {
      currentPeriodStart: toDate(sub?.current_start),
      currentPeriodEnd: toDate(sub?.current_end),
    };

    switch (type) {
      case 'subscription.authenticated':
        await this.setSub(local.id, undefined, periods);
        return;
      case 'subscription.activated':
        await this.prisma.$transaction(async (tx) => {
          await this.setSub(local.id, 'ACTIVE', periods, tx);
          await activateRestaurant(tx, local.restaurantId);
        });
        return;
      case 'subscription.charged':
        await this.charged(local, payment, periods);
        return;
      case 'payment.failed':
      case 'subscription.pending':
        await this.prisma.$transaction(async (tx) => {
          if (local.status === 'ACTIVE')
            await this.setSub(local.id, 'PAST_DUE', {}, tx);
          if (payment?.id && typeof payment.amount === 'number') {
            await tx.subscriptionPayment.upsert({
              where: { razorpayPaymentId: payment.id },
              update: {},
              create: {
                restaurantId: local.restaurantId,
                subscriptionId: local.id,
                razorpayPaymentId: payment.id,
                amountPaise: payment.amount,
                taxableValuePaise: 0,
                taxPaise: 0,
                status: 'FAILED',
                paidAt: toDate(payment.created_at) ?? new Date(),
              },
            });
          }
        });
        return;
      case 'subscription.cancelled':
      case 'subscription.halted':
      case 'subscription.completed': {
        const status: SubscriptionStatus =
          type === 'subscription.cancelled' ? 'CANCELLED' : 'EXPIRED';
        await this.prisma.$transaction(async (tx) => {
          const updated = await this.setSub(local.id, status, periods, tx);
          await expireRestaurantIfLapsed(
            tx,
            local.restaurantId,
            updated.currentPeriodEnd,
          );
        });
        return;
      }
      default:
        return; // stored in BillingEvent, nothing else to do
    }
  }

  /** A successful (re)charge: record it, extend the period, unlock. */
  protected async charged(
    local: { id: string; restaurantId: string },
    payment: RzEntity | undefined,
    periods: { currentPeriodStart?: Date; currentPeriodEnd?: Date },
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.setSub(local.id, 'ACTIVE', periods, tx);
      await activateRestaurant(tx, local.restaurantId);
      if (!payment?.id || typeof payment.amount !== 'number') return;
      const exists = await tx.subscriptionPayment.findUnique({
        where: { razorpayPaymentId: payment.id },
        select: { id: true },
      });
      if (exists) return;
      const split = splitInclusivePaise(payment.amount, gstRatePercent());
      await tx.subscriptionPayment.create({
        data: {
          restaurantId: local.restaurantId,
          subscriptionId: local.id,
          razorpayPaymentId: payment.id,
          amountPaise: payment.amount,
          ...split,
          status: 'CAPTURED',
          paidAt: toDate(payment.created_at) ?? new Date(),
        },
      });
    });
  }

  private setSub(
    id: string,
    status: SubscriptionStatus | undefined,
    periods: { currentPeriodStart?: Date; currentPeriodEnd?: Date },
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    return tx.subscription.update({
      where: { id },
      data: { ...(status ? { status } : {}), ...periods },
    });
  }
}

/** Paid: the restaurant may use the app (never lifts a platform suspension). */
export function activateRestaurant(
  tx: Prisma.TransactionClient,
  restaurantId: string,
) {
  return tx.restaurant.updateMany({
    where: { id: restaurantId, status: { not: 'SUSPENDED' } },
    data: { status: 'ACTIVE' },
  });
}

/** Lock a paying restaurant once its paid period is over (ACTIVE only). */
export function expireRestaurantIfLapsed(
  tx: Prisma.TransactionClient,
  restaurantId: string,
  periodEnd: Date | null,
  now = new Date(),
) {
  if (periodEnd && periodEnd > now) return Promise.resolve({ count: 0 });
  return tx.restaurant.updateMany({
    where: { id: restaurantId, status: 'ACTIVE' },
    data: { status: 'EXPIRED' },
  });
}

/** Past the paid period plus grace: time to check with Razorpay / expire. */
export function isPastGrace(
  periodEnd: Date | null,
  graceDays: number,
  now = new Date(),
) {
  if (!periodEnd) return false;
  return periodEnd.getTime() + graceDays * 24 * 60 * 60 * 1000 < now.getTime();
}
