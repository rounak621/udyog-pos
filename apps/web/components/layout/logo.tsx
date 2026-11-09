import Image from "next/image";
import { cn } from "@/lib/utils";

// Source images are 1200x382; `size` is the rendered height in px.
const RATIO = 1200 / 382;

export function Logo({ className, size = 36 }: { className?: string; size?: number }) {
  const width = Math.round(size * RATIO);
  const style = { height: size, width: "auto" } as const;
  return (
    <>
      <Image
        src="/udyog-pos-logo.png"
        alt="UDYOG POS"
        width={width}
        height={size}
        style={style}
        className={cn("shrink-0 object-contain dark:hidden", className)}
        preload
      />
      <Image
        src="/udyog-pos-logo-dark.png"
        alt="UDYOG POS"
        width={width}
        height={size}
        style={style}
        className={cn("hidden shrink-0 object-contain dark:block", className)}
        preload
      />
    </>
  );
}
