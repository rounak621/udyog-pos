"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PlanCards } from "@/components/billing/plan-cards";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";
import { inr, invoiceUrl, useBillingStatus, useCancelSubscription } from "@/hooks/use-billing";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

// UDYOG subscription for this restaurant (owners with billing.manage).

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "border-success bg-success-soft",
  PAST_DUE: "border-warning bg-warning-soft",
  CANCELLED: "border-border bg-muted",
  EXPIRED: "border-destructive bg-destructive-soft",
  CREATED: "border-border bg-muted",
};
const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString() : "—");

function BillingContent() {
  const { data: status, isLoading } = useBillingStatus();
  const cancel = useCancelSubscription();
  const [confirmCancel, setConfirmCancel] = useState(false);
  if (isLoading || !status) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const sub = status.subscription;
  const live = sub && (sub.status === "ACTIVE" || sub.status === "PAST_DUE");

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold text-foreground">Current plan</h2>
        {sub ? (
          <div className="flex flex-col gap-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">{sub.plan.name}</span>
              <span className="text-muted-foreground">({sub.billingCycle === "MONTHLY" ? "monthly" : "yearly"})</span>
              <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium text-foreground", STATUS_STYLE[sub.status])}>
                {sub.status.replace("_", " ")}
              </span>
            </div>
            {sub.currentPeriodEnd && (
              <p className="text-muted-foreground">
                {sub.cancelAtPeriodEnd ? "Ends on" : "Renews on"} {fmt(sub.currentPeriodEnd)}
              </p>
            )}
            {sub.cancelAtPeriodEnd && (
              <p className="text-muted-foreground">Cancelled: access continues until the end of the paid period.</p>
            )}
            {live && !sub.cancelAtPeriodEnd && (
              <Button variant="outline" className="mt-2 w-fit" onClick={() => setConfirmCancel(true)}>
                Cancel subscription
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {status.restaurant.status === "TRIAL"
              ? `Free trial${status.restaurant.daysLeft != null ? `: ${status.restaurant.daysLeft} days left` : ""}.`
              : "No paid subscription."}
          </p>
        )}
      </section>

      {!live && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-foreground">Plans</h2>
          {status.enabled ? (
            <PlanCards />
          ) : (
            <p className="text-sm text-muted-foreground">Online payment is not set up yet. Please contact support.</p>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-foreground">Payments</h2>
        {status.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments yet.</p>
        ) : (
          <div className="rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Invoice</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{fmt(p.paidAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">{inr(p.amountPaise)}</TableCell>
                    <TableCell>{p.status}</TableCell>
                    <TableCell>
                      {p.status !== "CAPTURED" ? (
                        "—"
                      ) : p.invoiceId ? (
                        <a href={invoiceUrl(p.invoiceId)} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4">
                          Invoice
                        </a>
                      ) : (
                        <span className="text-muted-foreground">Invoice pending</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <Dialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel subscription?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            It stops renewing. You keep access until the end of the period you already paid for.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCancel(false)}>Keep it</Button>
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() =>
                cancel.mutate(undefined, {
                  onSuccess: () => {
                    toast.success("Subscription will end at the end of this period");
                    setConfirmCancel(false);
                  },
                  onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not cancel"),
                })
              }
            >
              Cancel subscription
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function BillingPage() {
  const router = useRouter();
  const { data: me, isLoading } = useCurrentUser();
  const allowed = hasPermission(me?.user, "billing.manage");
  useEffect(() => {
    if (!isLoading && me && !allowed) router.replace("/settings");
  }, [isLoading, me, allowed, router]);
  if (!allowed) return null;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Restaurant, branch, and staff configuration</p>
      </div>
      <SettingsTabs />
      <BillingContent />
    </div>
  );
}
