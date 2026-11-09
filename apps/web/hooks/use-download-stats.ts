"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface DownloadStat {
  channel: string;
  count: number;
}

// Real counts only — this endpoint (see apps/backend .../downloads) is
// never pre-seeded, it only reflects actual clicks through /downloads/go/:channel.
// Platform admins only: everyone else gets 403, so no retries.
export function useDownloadStats() {
  return useQuery({
    queryKey: ["downloads", "stats"],
    queryFn: () => api.get<DownloadStat[]>("/downloads/stats"),
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    retry: false,
  });
}
