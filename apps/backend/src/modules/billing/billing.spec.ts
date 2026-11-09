import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { getAccessState } from '@nodedr-restaurant/types';
import { createHmac } from 'node:crypto';
import { ALLOW_WHEN_EXPIRED_KEY } from '../../common/decorators/allow-when-expired.decorator';
import {
  assertWithinPlanLimit,
  exceedsPlanLimit,
} from '../../common/plan-limits';
import { assertRestaurantAllowed } from '../../common/restaurant-access';
import {
  buildInvoiceSnapshot,
  financialYearFor,
  formatInvoiceNumber,
} from './billing-invoice';
import {
  BillingWebhookService,
  expireRestaurantIfLapsed,
  isPastGrace,
} from './billing-webhook.service';
import { BillingController } from './billing.controller';
import { BillingService, cyclePrice } from './billing.service';
import { RazorpayService } from './razorpay.service';

// Billing: unit level, mocked Prisma, no network.

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});
const DAY = 24 * 60 * 60 * 1000;
const sign = (secret: string, body: string) =>
  createHmac('sha256', secret).update(body).digest('hex');

describe('webhook signature', () => {
  it('accepts a valid signature, rejects a wrong one and an unset secret', () => {
    const rz = new RazorpayService();
    const body = Buffer.from('{"event":"x"}');
    process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
    expect(
      rz.verifyWebhookSignature(body, sign('whsec_test', body.toString())),
    ).toBe(true);
    expect(
      rz.verifyWebhookSignature(body, sign('other', body.toString())),
    ).toBe(false);
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    expect(
      rz.verifyWebhookSignature(body, sign('whsec_test', body.toString())),
    ).toBe(false);
  });
});

describe('webhook processing', () => {
  it('ignores a second delivery of the same event id', async () => {
    process.env.RAZORPAY_WEBHOOK_SECRET = 's';
    const prisma = {
      billingEvent: {
        findUnique: jest.fn().mockResolvedValue({ processedAt: new Date() }),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const svc = new BillingWebhookService(
      prisma as never,
      new RazorpayService(),
    );
    const processSpy = jest.spyOn(svc, 'process');
    const raw = '{"event":"subscription.charged","payload":{}}';
    await expect(
      svc.handle(Buffer.from(raw), sign('s', raw), 'evt_1'),
    ).resolves.toEqual({
      ok: true,
      duplicate: true,
    });
    expect(processSpy).not.toHaveBeenCalled();
    expect(prisma.billingEvent.create).not.toHaveBeenCalled();
    await expect(svc.handle(Buffer.from(raw), 'bad', 'evt_1')).rejects.toThrow(
      BadRequestException,
    );
  });

  const mockPrisma = (status: string) => {
    const tx = {
      subscription: {
        update: jest.fn().mockResolvedValue({
          currentPeriodStart: null,
          currentPeriodEnd: null,
        }),
      },
      restaurant: { updateMany: jest.fn() },
      subscriptionPayment: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'pay1' }),
        upsert: jest.fn(),
      },
    };
    const prisma = {
      ...tx,
      subscription: {
        ...tx.subscription,
        findUnique: jest.fn().mockResolvedValue({
          id: 'sub1',
          restaurantId: 'r1',
          status,
          billingCycle: 'MONTHLY',
          plan: { name: 'Basic' },
        }),
      },
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
    };
    return { prisma, tx };
  };

  it('subscription.charged records the payment and activates subscription + restaurant', async () => {
    for (const k of ['COMPANY_NAME', 'COMPANY_GSTIN', 'GST_RATE_PERCENT'])
      delete process.env[k];
    const { prisma, tx } = mockPrisma('CREATED');
    const svc = new BillingWebhookService(
      prisma as never,
      new RazorpayService(),
    );
    await svc.process('subscription.charged', {
      subscription: {
        entity: { id: 'sub_rz', current_start: 1, current_end: 2 },
      },
      payment: { entity: { id: 'pay_rz', amount: 11800 } },
    });
    expect(tx.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'ACTIVE' }),
      }),
    );
    expect(tx.restaurant.updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: { not: 'SUSPENDED' } },
      data: { status: 'ACTIVE' },
    });
    expect(tx.subscriptionPayment.create.mock.calls[0][0].data).toMatchObject({
      razorpayPaymentId: 'pay_rz',
      amountPaise: 11800,
      status: 'CAPTURED',
    });
  });

  it('payment.failed sets PAST_DUE; after the grace days the restaurant expires', async () => {
    const { prisma, tx } = mockPrisma('ACTIVE');
    const svc = new BillingWebhookService(
      prisma as never,
      new RazorpayService(),
    );
    await svc.process('payment.failed', {
      payment: {
        entity: { id: 'pay_x', amount: 100, subscription_id: 'sub_rz' },
      },
    });
    expect(tx.subscription.update.mock.calls[0][0].data.status).toBe(
      'PAST_DUE',
    );

    const periodEnd = new Date('2026-11-01T00:00:00Z');
    expect(
      isPastGrace(periodEnd, 3, new Date(periodEnd.getTime() + 2 * DAY)),
    ).toBe(false);
    expect(
      isPastGrace(periodEnd, 3, new Date(periodEnd.getTime() + 4 * DAY)),
    ).toBe(true);
    const updateMany = jest.fn();
    await expireRestaurantIfLapsed(
      { restaurant: { updateMany } } as never,
      'r1',
      periodEnd,
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'r1', status: 'ACTIVE' },
      data: { status: 'EXPIRED' },
    });
  });
});

describe('access and billing routes', () => {
  it('EXPIRED is locked; billing routes open for expired trial/subscription, not suspended', () => {
    expect(getAccessState({ status: 'EXPIRED', trialEndsAt: null })).toEqual({
      allowed: false,
      code: 'SUBSCRIPTION_EXPIRED',
      daysLeft: null,
    });
    const expiredTrial = {
      status: 'TRIAL' as const,
      trialEndsAt: new Date(Date.now() - DAY),
    };
    expect(() =>
      assertRestaurantAllowed(expiredTrial, { allowExpired: true }),
    ).not.toThrow();
    expect(() => assertRestaurantAllowed(expiredTrial)).toThrow(
      ForbiddenException,
    );
    expect(() =>
      assertRestaurantAllowed(
        { status: 'EXPIRED', trialEndsAt: null },
        { allowExpired: true },
      ),
    ).not.toThrow();
    expect(() =>
      assertRestaurantAllowed(
        { status: 'SUSPENDED', trialEndsAt: null },
        { allowExpired: true },
      ),
    ).toThrow(ForbiddenException);
    const proto = BillingController.prototype as unknown as Record<
      string,
      object
    >;
    for (const name of [
      'plans',
      'status',
      'subscribe',
      'verify',
      'cancel',
      'invoice',
    ]) {
      expect(Reflect.getMetadata(ALLOW_WHEN_EXPIRED_KEY, proto[name])).toBe(
        true,
      );
    }
  });
});

describe('plan limits', () => {
  it('allows under the limit, blocks at it, no subscription = no limit', async () => {
    expect(exceedsPlanLimit(null, 1000)).toBe(false);
    const prismaWith = (sub: unknown, count: number) =>
      ({
        subscription: { findFirst: jest.fn().mockResolvedValue(sub) },
        user: { count: jest.fn().mockResolvedValue(count) },
        branch: { count: jest.fn().mockResolvedValue(count) },
      }) as never;
    const plan = { plan: { maxBranches: 2, maxUsers: 2 } };
    await expect(
      assertWithinPlanLimit(prismaWith(plan, 1), 'r1', 'users'),
    ).resolves.toBeUndefined();
    await expect(
      assertWithinPlanLimit(prismaWith(plan, 2), 'r1', 'users'),
    ).rejects.toMatchObject({
      response: {
        code: 'PLAN_LIMIT',
        message: 'Your plan allows 2 users. Upgrade to add more.',
      },
    });
    await expect(
      assertWithinPlanLimit(prismaWith(null, 99), 'r1', 'branches'),
    ).resolves.toBeUndefined();
  });
});

describe('GST invoices', () => {
  it('numbers invoices per Indian financial year (Asia/Kolkata boundary)', () => {
    expect(formatInvoiceNumber('2026-27', 1)).toBe('UDYOG/2026-27/000001');
    // 31 Mar 23:59 IST is still FY 2026-27; 1 Apr 00:00 IST starts 2027-28.
    expect(financialYearFor(new Date('2027-03-31T18:29:59Z'))).toBe('2026-27');
    expect(financialYearFor(new Date('2027-03-31T18:30:00Z'))).toBe('2027-28');
  });

  it('splits CGST+SGST for the same state and IGST for another state', () => {
    const company = {
      name: 'Seller',
      gstin: '27AAPFU0939F1ZV',
      address: 'Addr',
      sac: '998314',
      stateCode: '27',
      gstRatePercent: 18,
    };
    const base = {
      company,
      description: 'Plan',
      taxableValuePaise: 10000,
      taxPaise: 1800,
      period: { start: null, end: null },
    };
    const same = buildInvoiceSnapshot({
      ...base,
      buyer: {
        name: 'R',
        branchName: null,
        address: null,
        gstin: '27AAPFU0939F1ZV',
      },
    });
    expect(same.taxLines).toEqual([
      { label: 'CGST', amountPaise: 900 },
      { label: 'SGST', amountPaise: 900 },
    ]);
    const other = buildInvoiceSnapshot({
      ...base,
      buyer: {
        name: 'R',
        branchName: null,
        address: null,
        gstin: '29AAPFU0939F1ZV',
      },
    });
    expect(other.taxLines).toEqual([{ label: 'IGST', amountPaise: 1800 }]);
    expect(other.totalPaise).toBe(11800);
  });
});

describe('subscribe', () => {
  it('is refused when the price is not set or Razorpay keys are missing', async () => {
    expect(cyclePrice(null, 'plan_x', { enabled: true, rate: 18 })).toBeNull();
    expect(
      cyclePrice(1000, 'plan_x', { enabled: false, rate: 18 }),
    ).toMatchObject({
      canSubscribe: false,
    });
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    process.env.GST_RATE_PERCENT = '18';
    const prisma = {
      plan: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'p1',
          priceMonthlyPaise: 1000,
          razorpayPlanIdMonthly: 'plan_x',
        }),
      },
    };
    const svc = new BillingService(
      prisma as never,
      new RazorpayService(),
      {} as never,
    );
    await expect(
      svc.subscribe({ restaurantId: 'r1' } as never, {
        planId: 'p1',
        cycle: 'MONTHLY',
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
