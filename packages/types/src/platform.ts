import { z } from "zod";
import type { RestaurantStatus } from "./restaurant-status";

// Platform admin screen (UDYOG staff only): restaurant list and status
// actions. Only account metadata is ever returned, never tenant business data.

export const PLATFORM_PAGE_SIZE = 50;

export const platformRestaurantListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
});
export type PlatformRestaurantListQuery = z.infer<typeof platformRestaurantListQuerySchema>;

export const suspendRestaurantSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});
export type SuspendRestaurantDto = z.infer<typeof suspendRestaurantSchema>;

export const extendTrialSchema = z.object({
  days: z.number().int().min(1).max(90),
});
export type ExtendTrialDto = z.infer<typeof extendTrialSchema>;

export interface PlatformRestaurantRow {
  id: string;
  name: string;
  ownerEmail: string | null;
  branchCount: number;
  userCount: number;
  createdAt: string;
  status: RestaurantStatus;
  trialEndsAt: string | null;
  suspendedAt: string | null;
  suspendedReason: string | null;
  daysLeft: number | null;
}

export interface PlatformRestaurantPage {
  items: PlatformRestaurantRow[];
  total: number;
  page: number;
  pageSize: number;
}
