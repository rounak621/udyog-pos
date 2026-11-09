"use client";

import type { BillingCycle, BillingPlanView } from "@nodedr-restaurant/types";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { inr, useBillingPlans, useSubscribe, useVerifyCheckout } from "@/hooks/use-billing";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

// Plan cards + Razorpay Checkout for a subscription. Used on the Billing tab
// and on /account-blocked. Prices, GST and limits come from /billing/plans.

interface RazorpayCheckout {
  open(): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayCheckout;
  }
}

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    const script = existing ?? document.createElement("script");
    script.addEventListener("load", () => resolve());
    script.addEventListener("error", () => reject(new Error("Could not load the payment window")));
    if (!existing) {
      script.src = CHECKOUT_SRC;
      script.async = true;
      document.body.appendChild(script);
    }
  });
}

const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Something went wrong");

function limitText(n: number | null, one: string, many: string) {
  return n === null ? `Unlimited ${many}` : `${n} ${n === 1 ? one : many}`;
}

function PlanCard({
  plan,
  cycle,
  busy,
  onSubscribe,
}: {
  plan: BillingPlanView;
  cycle: BillingCycle;
  busy: boolean;
  onSubscribe: (plan: BillingPlanView, cycle: BillingCycle) => void;
}) {
  const price = cycle === "MONTHLY" ? plan.monthly : plan.yearly;
  const per = cycle === "MONTHLY" ? "month" : "year";
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
      <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
      {price ? (
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Price (excl. GST)</dt>
            <dd className="tabular-nums text-foreground">{inr(price.pricePaise)} / {per}</dd>
          </div>
          {price.gstPaise !== null && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">GST</dt>
              <dd className="tabular-nums text-foreground">{inr(price.gstPaise)}</dd>
            </div>
          )}
          {price.totalPaise !== null && (
            <div className="flex justify-between gap-3 border-t border-border pt-1 font-medium">
              <dt className="text-foreground">Total</dt>
              <dd className="tabular-nums text-foreground">{inr(price.totalPaise)} / {per}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">Not offered {cycle === "MONTHLY" ? "monthly" : "yearly"}.</p>
      )}
      <ul className="text-sm text-muted-foreground">
        <li>{limitText(plan.maxBranches, "branch", "branches")}</li>
        <li>{limitText(plan.maxUsers, "user", "users")}</li>
      </ul>
      <Button
        className="mt-auto"
        disabled={!price?.canSubscribe || busy}
        onClick={() => onSubscribe(plan, cycle)}
      >
        Subscribe
      </Button>
      {price && !price.canSubscribe && price.reason && (
        <p className="text-xs text-muted-foreground">{price.reason}</p>
      )}
    </div>
  );
}

export function PlanCards({ onSubscribed }: { onSubscribed?: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useBillingPlans();
  const subscribe = useSubscribe();
  const verify = useVerifyCheckout();
  const [busy, setBusy] = useState(false);
  const hasMonthly = data?.plans.some((p) => p.monthly) ?? false;
  const hasYearly = data?.plans.some((p) => p.yearly) ?? false;
  const [cycleChoice, setCycle] = useState<BillingCycle>("MONTHLY");
  const cycle: BillingCycle = hasMonthly && hasYearly ? cycleChoice : hasYearly ? "YEARLY" : "MONTHLY";

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading plans…</p>;
  if (isError || !data) return null;
  if (data.plans.length === 0) {
    return <p className="text-sm text-muted-foreground">No plans are available yet. Please contact support.</p>;
  }

  // After checkout the webhook activates the subscription: poll a few times.
  const refreshUntilActive = async () => {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      await qc.invalidateQueries({ queryKey: ["billing", "status"] });
      const status = qc.getQueryData<{ subscription: { status: string } | null }>(["billing", "status"]);
      if (status?.subscription?.status === "ACTIVE") break;
    }
    onSubscribed?.();
  };

  const start = async (plan: BillingPlanView, chosen: BillingCycle) => {
    setBusy(true);
    try {
      const { razorpaySubscriptionId, keyId } = await subscribe.mutateAsync({ planId: plan.id, cycle: chosen });
      await loadCheckout();
      if (!window.Razorpay) throw new Error("Could not load the payment window");
      const checkout = new window.Razorpay({
        key: keyId,
        subscription_id: razorpaySubscriptionId,
        name: "UDYOG POS",
        description: plan.name,
        handler: (resp: { razorpay_payment_id: string; razorpay_subscription_id: string; razorpay_signature: string }) => {
          verify.mutate(resp, {
            onSuccess: () => {
              toast.success("Payment received. Activating your plan…");
              void refreshUntilActive().finally(() => setBusy(false));
            },
            onError: (e) => {
              toast.error(errMsg(e));
              setBusy(false);
            },
          });
        },
        modal: { ondismiss: () => setBusy(false) },
      });
      checkout.open();
    } catch (e) {
      toast.error(errMsg(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {hasMonthly && hasYearly && (
        <div className="inline-flex w-fit rounded-lg border border-border p-1" role="group" aria-label="Billing cycle">
          {(["MONTHLY", "YEARLY"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCycle(c)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium",
                cycle === c ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
              )}
              aria-pressed={cycle === c}
            >
              {c === "MONTHLY" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.plans.map((p) => (
          <PlanCard key={p.id} plan={p} cycle={cycle} busy={busy} onSubscribe={start} />
        ))}
      </div>
    </div>
  );
}
