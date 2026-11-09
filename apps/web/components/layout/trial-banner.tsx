"use client";

import Link from "next/link";
import { hasPermission, useCurrentUser } from "@/hooks/use-auth";

/** Slim notice while the restaurant is on a free trial (hosted mode). */
export function TrialBanner() {
  const { data } = useCurrentUser();
  const restaurant = data?.restaurant;
  if (restaurant?.status !== "TRIAL" || restaurant.daysLeft == null) return null;
  const days = restaurant.daysLeft;
  return (
    <div className="border-b border-warning bg-warning-soft px-4 py-1.5 text-center text-sm text-foreground sm:px-6">
      Free trial: {days} {days === 1 ? "day" : "days"} left
      {data?.billingEnabled && hasPermission(data.user, "billing.manage") && (
        <>
          {" · "}
          <Link href="/settings/billing" className="font-medium underline underline-offset-4">
            Choose a plan
          </Link>
        </>
      )}
    </div>
  );
}
