"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useCurrentUser } from "@/hooks/use-auth";

/**
 * Instance-wide settings pages (Backup, Updates, Server Sync) are for UDYOG
 * platform admins only: anyone else opening the URL goes back to /settings
 * (the API refuses them too). Same pattern as the VERI*FACTU redirect.
 */
export function PlatformAdminOnly({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data, isLoading } = useCurrentUser();
  const isAdmin = data?.user.isPlatformAdmin === true;
  useEffect(() => {
    if (!isLoading && data && !isAdmin) router.replace("/settings");
  }, [isLoading, data, isAdmin, router]);
  return isAdmin ? <>{children}</> : null;
}
