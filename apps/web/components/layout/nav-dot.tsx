import { cn } from "@/lib/utils";

// Small glowing dot shown next to a nav item / settings tab that has
// something the user should look at (a new order, an update, a failed backup).
export function NavDot({ className, label }: { className?: string; label?: string }) {
  return (
    <span
      role="status"
      aria-label={label ?? "Needs attention"}
      className={cn("relative ml-auto flex h-2.5 w-2.5 shrink-0", className)}
    >
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-75" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-warning shadow-[0_0_8px_2px_var(--warning)]" />
    </span>
  );
}
