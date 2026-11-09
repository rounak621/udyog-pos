"use client";

import type { PlatformRestaurantPage } from "@nodedr-restaurant/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// Platform admin screen (UDYOG staff). The backend answers 403 to anyone else.

export function usePlatformRestaurants(search: string, page: number, enabled: boolean) {
  const q = new URLSearchParams({ page: String(page) });
  if (search.trim()) q.set("search", search.trim());
  return useQuery({
    queryKey: ["platform", "restaurants", search.trim(), page],
    queryFn: () => api.get<PlatformRestaurantPage>(`/platform/restaurants?${q.toString()}`),
    enabled,
    placeholderData: (prev) => prev,
  });
}

type Action =
  | { kind: "suspend"; id: string; reason?: string }
  | { kind: "unsuspend"; id: string }
  | { kind: "extend-trial"; id: string; days: number }
  | { kind: "mark-active"; id: string };

export function usePlatformAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: Action) => {
      const path = `/platform/restaurants/${encodeURIComponent(a.id)}/${a.kind}`;
      if (a.kind === "suspend") return api.post(path, a.reason ? { reason: a.reason } : {});
      if (a.kind === "extend-trial") return api.post(path, { days: a.days });
      return api.post(path);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform", "restaurants"] }),
  });
}
