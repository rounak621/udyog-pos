import type { AccessBlockCode } from "@nodedr-restaurant/types";
import Link from "next/link";
import { Logo } from "@/components/layout/logo";
import { SUPPORT_EMAIL } from "@/lib/support";

// Shown (outside the dashboard shell, no sidebar) when the API answers 403
// with RESTAURANT_SUSPENDED, TRIAL_EXPIRED or SUBSCRIPTION_EXPIRED. Data is
// kept; only access stops.
const MESSAGES: Record<AccessBlockCode, string> = {
  RESTAURANT_SUSPENDED: "This account is suspended. Please contact support.",
  TRIAL_EXPIRED: "Your free trial has ended. Please contact support to continue.",
  SUBSCRIPTION_EXPIRED: "Your subscription has ended. Please choose a plan or contact support.",
};

export default async function AccountBlockedPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  const message =
    MESSAGES[code as AccessBlockCode] ?? MESSAGES.RESTAURANT_SUSPENDED;

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-xl border border-border bg-card p-8 text-center">
        <Logo size={48} />
        <p className="text-base text-foreground">{message}</p>
        {SUPPORT_EMAIL && (
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-sm font-medium text-primary underline underline-offset-4"
          >
            {SUPPORT_EMAIL}
          </a>
        )}
        <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
