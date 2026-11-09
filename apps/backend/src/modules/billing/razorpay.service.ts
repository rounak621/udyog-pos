import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { razorpayKeys, webhookSecret } from './billing-config';

const API = 'https://api.razorpay.com/v1';

export class BillingNotConfiguredError extends ServiceUnavailableException {
  constructor() {
    super({
      code: 'BILLING_NOT_CONFIGURED',
      message:
        'Billing is not configured on this server (Razorpay keys missing).',
    });
  }
}

export interface RazorpaySubscription {
  id: string;
  status: string;
  current_start: number | null;
  current_end: number | null;
}

/** Timing-safe HMAC-SHA256 (hex) check. */
export function hmacMatches(
  secret: string,
  data: string | Buffer,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(data).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Minimal Razorpay REST client (plain fetch + basic auth): only the five
 * calls billing needs, so no SDK dependency. Never logs keys or payloads;
 * errors carry only Razorpay's short error description.
 */
@Injectable()
export class RazorpayService {
  isConfigured(): boolean {
    return razorpayKeys() !== null;
  }

  keyId(): string {
    const keys = razorpayKeys();
    if (!keys) throw new BillingNotConfiguredError();
    return keys.keyId;
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: object) {
    const keys = razorpayKeys();
    if (!keys) throw new BillingNotConfiguredError();
    const auth = Buffer.from(`${keys.keyId}:${keys.keySecret}`).toString(
      'base64',
    );
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      error?: { description?: string };
    };
    if (!res.ok) {
      const description = json.error?.description ?? res.statusText;
      throw new Error(`Razorpay ${res.status}: ${description}`.slice(0, 300));
    }
    return json as T;
  }

  async createPlan(input: {
    period: 'monthly' | 'yearly';
    name: string;
    amountPaise: number;
    planCode: string;
  }): Promise<string> {
    const plan = await this.call<{ id: string }>('POST', '/plans', {
      period: input.period,
      interval: 1,
      item: { name: input.name, amount: input.amountPaise, currency: 'INR' },
      notes: { planCode: input.planCode },
    });
    return plan.id;
  }

  createSubscription(input: {
    planId: string;
    totalCount: number;
    restaurantId: string;
  }): Promise<RazorpaySubscription> {
    return this.call<RazorpaySubscription>('POST', '/subscriptions', {
      plan_id: input.planId,
      total_count: input.totalCount,
      customer_notify: 1,
      notes: { restaurantId: input.restaurantId },
    });
  }

  cancelAtCycleEnd(subscriptionId: string): Promise<RazorpaySubscription> {
    return this.call<RazorpaySubscription>(
      'POST',
      `/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,
      { cancel_at_cycle_end: 1 },
    );
  }

  fetchSubscription(subscriptionId: string): Promise<RazorpaySubscription> {
    return this.call<RazorpaySubscription>(
      'GET',
      `/subscriptions/${encodeURIComponent(subscriptionId)}`,
    );
  }

  /** Checkout handler signature: HMAC(payment_id + "|" + subscription_id, key secret). */
  verifyCheckoutSignature(
    paymentId: string,
    subscriptionId: string,
    signature: string,
  ): boolean {
    const keys = razorpayKeys();
    if (!keys) throw new BillingNotConfiguredError();
    return hmacMatches(
      keys.keySecret,
      `${paymentId}|${subscriptionId}`,
      signature,
    );
  }

  /** Webhook signature: HMAC(raw body, RAZORPAY_WEBHOOK_SECRET). False if unset. */
  verifyWebhookSignature(
    rawBody: Buffer,
    signature: string | undefined,
  ): boolean {
    const secret = webhookSecret();
    if (!secret) return false;
    return hmacMatches(secret, rawBody, signature);
  }
}
