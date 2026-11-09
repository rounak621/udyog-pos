// Hosted (cloud) mode: a restaurant is on a free TRIAL, ACTIVE, or SUSPENDED
// by the platform admin. This is the ONE place that decides whether a
// restaurant may use the app right now; backend and web both call it.

export const RESTAURANT_STATUSES = ["TRIAL", "ACTIVE", "SUSPENDED"] as const;
export type RestaurantStatus = (typeof RESTAURANT_STATUSES)[number];

export type AccessBlockCode = "RESTAURANT_SUSPENDED" | "TRIAL_EXPIRED";
export const ACCESS_BLOCK_CODES: readonly AccessBlockCode[] = ["RESTAURANT_SUSPENDED", "TRIAL_EXPIRED"];

export interface AccessState {
  allowed: boolean;
  code: AccessBlockCode | null;
  /** Whole days left on a running trial (rounded up), else null. */
  daysLeft: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function getAccessState(
  restaurant: { status: RestaurantStatus | string; trialEndsAt?: Date | string | null },
  now: Date = new Date(),
): AccessState {
  if (restaurant.status === "SUSPENDED") {
    return { allowed: false, code: "RESTAURANT_SUSPENDED", daysLeft: null };
  }
  if (restaurant.status === "TRIAL") {
    if (!restaurant.trialEndsAt) return { allowed: true, code: null, daysLeft: null };
    const msLeft = new Date(restaurant.trialEndsAt).getTime() - now.getTime();
    if (msLeft <= 0) return { allowed: false, code: "TRIAL_EXPIRED", daysLeft: 0 };
    return { allowed: true, code: null, daysLeft: Math.ceil(msLeft / DAY_MS) };
  }
  return { allowed: true, code: null, daysLeft: null };
}

/** TRIAL_DAYS env value: a positive integer, else the default of 14. */
export function resolveTrialDays(raw: string | undefined | null): number {
  const n = Number(raw);
  return raw != null && raw.trim() !== "" && Number.isInteger(n) && n > 0 ? n : 14;
}
