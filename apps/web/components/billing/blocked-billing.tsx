"use client";

import { PlanCards } from "@/components/billing/plan-cards";
import { useBillingPlans } from "@/hooks/use-billing";

/**
 * On /account-blocked for an expired trial/subscription: if this user may
 * manage billing (the API answers), show the plans so they can pay here.
 */
export function BlockedBilling() {
  const { data, isError } = useBillingPlans();
  if (isError || !data?.enabled) return null;
  return (
    <div className="w-full max-w-5xl">
      <PlanCards onSubscribed={() => window.location.assign("/dashboard")} />
    </div>
  );
}
