import { Code } from "lucide-react";

export function BrandFooter() {
  return (
    <div className="flex flex-col gap-2 border-t border-sidebar-border px-4 py-3">
      <a
        href="https://github.com/rounak621/udyog-pos"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-1.5 rounded-lg border border-sidebar-border px-3 py-1.5 text-xs font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
      >
        <Code className="h-3.5 w-3.5" />
        Source code
      </a>
      <p className="text-left text-xs font-medium leading-tight text-sidebar-foreground/70">
        UDYOG POS — Open source under AGPL-3.0.
      </p>
    </div>
  );
}
