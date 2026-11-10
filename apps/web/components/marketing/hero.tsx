"use client";

import { ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PosMockup } from "@/components/marketing/pos-mockup";

const words = ["Restaurant", "billing,", "made", "simple."];

export function Hero() {
  return (
    <section className="relative overflow-hidden px-4 pt-20 pb-24 sm:px-6 sm:pt-28">
      {/* Ambient gradient glow — transform/opacity only, no layout cost */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px] bg-[radial-gradient(60%_50%_at_50%_0%,color-mix(in_oklch,var(--primary),transparent_88%),transparent)]"
      />

      <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground"
        >
          <span className="size-1.5 rounded-full bg-success" />
          Restaurant billing · Kitchen display
        </motion.div>

        <h1 className="flex flex-wrap justify-center gap-x-3 text-4xl font-semibold tracking-tight text-foreground sm:text-6xl">
          {words.map((word, i) => (
            <motion.span
              key={word}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
              className={word === "simple." ? "text-primary" : undefined}
            >
              {word}
            </motion.span>
          ))}
        </h1>

        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="mt-6 max-w-2xl text-balance text-lg text-muted-foreground sm:text-xl"
        >
          Billing at the counter and at tables, a kitchen display, a QR menu
          for guests, India GST receipts and reports, in one web app with a
          Windows desktop app for receipt and kitchen printers.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.48, ease: [0.22, 1, 0.36, 1] }}
          className="mt-9 flex flex-col items-center gap-3 sm:flex-row"
        >
          <Button size="lg" className="h-11 px-6 text-[15px]" render={<Link href="/signup" />}>
            Get started
            <ArrowRight className="size-4" data-icon="inline-end" />
          </Button>
        </motion.div>
      </div>

      <div className="mt-16 sm:mt-20">
        <PosMockup />
      </div>
    </section>
  );
}
