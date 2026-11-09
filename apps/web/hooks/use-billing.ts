"use client";

import type {
  BillingPlansResponse,
  CreatePlanDto,
  RestaurantStatus,
  SubscribeDto,
  SubscriptionStatus,
  UpdatePlanDto,
  VerifyCheckoutDto,
} from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// UDYOG subscription billing (owner: billing.manage) and plan management
// (platform admins). Every price and limit comes from the API.

export interface BillingStatus {
  enabled: boolean;
  restaurant: {
    status: RestaurantStatus;
    trialEndsAt: string | null;
    daysLeft: number | null;
    allowed: boolean;
    code: string | null;
  };
  subscription: {
    id: string;
    plan: { id: string; name: string };
    status: SubscriptionStatus;
    billingCycle: "MONTHLY" | "YEARLY";
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  payments: {
    id: string;
    amountPaise: number;
    status: "CAPTURED" | "FAILED" | "REFUNDED";
    paidAt: string;
    invoiceId: string | null;
  }[];
}

export interface PlatformPlan {
  id: string;
  code: string;
  name: string;
  priceMonthlyPaise: number | null;
  priceYearlyPaise: number | null;
  maxBranches: number | null;
  maxUsers: number | null;
  isActive: boolean;
  sortOrder: number;
  razorpayPlanIdMonthly: string | null;
  razorpayPlanIdYearly: string | null;
}

export const inr = (paise: number) => `₹${(paise / 100).toFixed(2)}`;
export const invoiceUrl = (id: string) => `/api/v1/billing/invoices/${encodeURIComponent(id)}`;

export function useBillingPlans(enabled = true) {
  return useQuery({
    queryKey: ["billing", "plans"],
    queryFn: () => api.get<BillingPlansResponse>("/billing/plans"),
    enabled,
    retry: false,
  });
}

export function useBillingStatus(enabled = true) {
  return useQuery({
    queryKey: ["billing", "status"],
    queryFn: () => api.get<BillingStatus>("/billing/status"),
    enabled,
    retry: false,
  });
}

export function useSubscribe() {
  return useMutation({
    mutationFn: (dto: SubscribeDto) =>
      api.post<{ razorpaySubscriptionId: string; keyId: string }>("/billing/subscribe", dto),
  });
}

export function useVerifyCheckout() {
  return useMutation({
    mutationFn: (dto: VerifyCheckoutDto) => api.post<{ ok: true }>("/billing/verify", dto),
  });
}

export function useCancelSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>("/billing/cancel"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["billing"] }),
  });
}

export function usePlatformPlans(enabled: boolean) {
  return useQuery({
    queryKey: ["platform", "plans"],
    queryFn: () => api.get<PlatformPlan[]>("/platform/plans"),
    enabled,
  });
}

type PlanSaveResult = { plan: PlatformPlan; warnings: string[] };

export function useSavePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { id?: string; dto: CreatePlanDto | UpdatePlanDto }) =>
      a.id
        ? api.patch<PlanSaveResult>(`/platform/plans/${encodeURIComponent(a.id)}`, a.dto)
        : api.post<PlanSaveResult>("/platform/plans", a.dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform", "plans"] }),
  });
}
