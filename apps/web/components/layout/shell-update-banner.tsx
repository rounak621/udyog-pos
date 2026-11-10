"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { isDesktop } from "@/lib/native-bridge";

/**
 * Inside the UDYOG POS Windows app only: asks the server once per load
 * whether this app is older than MIN_SHELL_VERSION. Never blocks.
 */
export function ShellUpdateBanner() {
  const [updateRequired, setUpdateRequired] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!(await isDesktop())) return;
      try {
        const res = await api.get<{ updateRequired: boolean }>("/system/shell-check");
        if (!cancelled) setUpdateRequired(res.updateRequired === true);
      } catch {
        // No banner when the check itself fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!updateRequired) return null;
  return (
    <div
      role="status"
      className="border-b border-warning bg-warning-soft px-4 py-1.5 text-center text-sm text-foreground sm:px-6"
    >
      Please update the UDYOG POS app to keep working correctly.
    </div>
  );
}
