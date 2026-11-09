import { z } from "zod";

// UDYOG's own subscription billing (Razorpay Subscriptions). Prices are in
// paise EXCLUDING GST. Nothing here is a price, limit or tax number: those
// come from the database (Plan) or env (GST_RATE_PERCENT etc.).

export const BILLING_CYCLES = ["MONTHLY", "YEARLY"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const SUBSCRIPTION_STATUSES = ["CREATED", "ACTIVE", "PAST_DUE", "CANCELLED", "EXPIRED"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

const paise = z.number().int().min(0).nullable();
const limit = z.number().int().positive().nullable();

export const createPlanSchema = z.object({
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9_-]+$/i, "Use letters, digits, - or _"),
  name: z.string().trim().min(1).max(80),
  priceMonthlyPaise: paise.optional(),
  priceYearlyPaise: paise.optional(),
  maxBranches: limit.optional(),
  maxUsers: limit.optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type CreatePlanDto = z.infer<typeof createPlanSchema>;

/** The code is fixed once created; everything else can change. */
export const updatePlanSchema = createPlanSchema.omit({ code: true }).partial();
export type UpdatePlanDto = z.infer<typeof updatePlanSchema>;

export const subscribeSchema = z.object({
  planId: z.string().min(1),
  cycle: z.enum(BILLING_CYCLES),
});
export type SubscribeDto = z.infer<typeof subscribeSchema>;

export const verifyCheckoutSchema = z.object({
  razorpay_payment_id: z.string().min(1).max(100),
  razorpay_subscription_id: z.string().min(1).max(100),
  razorpay_signature: z.string().min(1).max(200),
});
export type VerifyCheckoutDto = z.infer<typeof verifyCheckoutSchema>;

export interface PlanCyclePrice {
  pricePaise: number;
  gstPaise: number | null;
  totalPaise: number | null;
  canSubscribe: boolean;
  reason: string | null;
}

export interface BillingPlanView {
  id: string;
  code: string;
  name: string;
  maxBranches: number | null;
  maxUsers: number | null;
  monthly: PlanCyclePrice | null;
  yearly: PlanCyclePrice | null;
}

export interface BillingPlansResponse {
  enabled: boolean;
  gstRatePercent: number | null;
  plans: BillingPlanView[];
}
