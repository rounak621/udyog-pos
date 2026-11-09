"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { registerSchema, type RegisterDto } from "@nodedr-restaurant/types";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { useRegister } from "@/hooks/use-auth";
import { useSetupStatus } from "@/hooks/use-setup-status";
import { ApiError } from "@/lib/api";

export default function SignupPage() {
  const router = useRouter();
  const register = useRegister();
  const prefersReducedMotion = useReducedMotion();
  const {
    register: field,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterDto>({ resolver: zodResolver(registerSchema) });
  const { data: setupStatus } = useSetupStatus();

  // Sign-up is open for first-time setup, or always in hosted mode
  // (ALLOW_SIGNUP=true); otherwise go to login.
  const signupClosed = setupStatus !== undefined && !setupStatus.signupOpen;
  useEffect(() => {
    if (signupClosed) router.replace("/login");
  }, [signupClosed, router]);

  const onSubmit = (dto: RegisterDto) => {
    register.mutate(dto, {
      onSuccess: () => router.push("/dashboard"),
      onError: (err) => {
        toast.error(err instanceof ApiError ? err.message : "Something went wrong");
      },
    });
  };

  if (signupClosed) return null;

  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-background px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-[radial-gradient(50%_50%_at_50%_0%,color-mix(in_oklch,var(--primary),transparent_90%),transparent)]"
      />
      <motion.div
        initial={prefersReducedMotion ? false : { opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm"
      >
        <div className="mb-10 flex flex-col items-center gap-2 text-center">
          <Link href="/">
            <Logo size={64} />
          </Link>
          <h1 className="sr-only">UDYOG POS</h1>
          <p className="text-sm text-muted-foreground">Set up your restaurant</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="restaurantName">Restaurant name</Label>
            <Input
              id="restaurantName"
              autoComplete="organization"
              placeholder="e.g. Spice Route"
              {...field("restaurantName")}
            />
            {errors.restaurantName && (
              <p className="text-xs text-destructive">{errors.restaurantName.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="branchName">First branch name</Label>
            <Input
              id="branchName"
              placeholder="Main Branch"
              defaultValue="Main Branch"
              {...field("branchName")}
            />
            {errors.branchName && (
              <p className="text-xs text-destructive">{errors.branchName.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ownerName">Your name</Label>
            <Input
              id="ownerName"
              autoComplete="name"
              placeholder="e.g. Priya Sharma"
              {...field("ownerName")}
            />
            {errors.ownerName && (
              <p className="text-xs text-destructive">{errors.ownerName.message}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@restaurant.com"
              {...field("email")}
            />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              id="password"
              
              autoComplete="new-password"
              placeholder="At least 8 characters"
              {...field("password")}
            />
            {errors.password && (
              <p className="text-xs text-destructive">{errors.password.message}</p>
            )}
          </div>

          <Button type="submit" className="mt-2 h-11" disabled={register.isPending}>
            {register.isPending ? "Creating your account…" : "Create account"}
          </Button>
        </form>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-foreground hover:underline">
            Sign in
          </Link>
        </p>
      </motion.div>
    </main>
  );
}
