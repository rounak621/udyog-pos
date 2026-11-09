"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { PlatformTabs } from "@/components/platform/platform-tabs";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentUser } from "@/hooks/use-auth";
import { inr, usePlatformPlans, useSavePlan, type PlatformPlan } from "@/hooks/use-billing";
import { ApiError } from "@/lib/api";

// Platform admins: plans offered to restaurants. Prices are entered in rupees
// EXCLUDING GST and stored in paise; empty = not set. Nothing is pre-filled.

interface FormState {
  code: string;
  name: string;
  monthly: string;
  yearly: string;
  maxBranches: string;
  maxUsers: string;
  isActive: boolean;
  sortOrder: string;
}
const EMPTY: FormState = { code: "", name: "", monthly: "", yearly: "", maxBranches: "", maxUsers: "", isActive: true, sortOrder: "0" };

const toPaise = (rupees: string): number | null | "invalid" => {
  if (rupees.trim() === "") return null;
  const n = Number(rupees);
  if (!Number.isFinite(n) || n < 0) return "invalid";
  return Math.round(n * 100);
};
const toLimit = (v: string): number | null | "invalid" => {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : "invalid";
};
const fromPaise = (p: number | null) => (p === null ? "" : (p / 100).toFixed(2));

export default function PlatformPlansPage() {
  const router = useRouter();
  const { data: me, isLoading } = useCurrentUser();
  const isAdmin = me?.user.isPlatformAdmin === true;
  useEffect(() => {
    if (!isLoading && me && !isAdmin) router.replace("/dashboard");
  }, [isLoading, me, isAdmin, router]);

  const { data: plans } = usePlatformPlans(isAdmin);
  const save = useSavePlan();
  const [editing, setEditing] = useState<PlatformPlan | "new" | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [warnings, setWarnings] = useState<string[]>([]);

  if (!isAdmin) return null;

  const open = (p: PlatformPlan | "new") => {
    setEditing(p);
    setForm(
      p === "new"
        ? EMPTY
        : {
            code: p.code,
            name: p.name,
            monthly: fromPaise(p.priceMonthlyPaise),
            yearly: fromPaise(p.priceYearlyPaise),
            maxBranches: p.maxBranches?.toString() ?? "",
            maxUsers: p.maxUsers?.toString() ?? "",
            isActive: p.isActive,
            sortOrder: String(p.sortOrder),
          },
    );
  };

  const submit = () => {
    const priceMonthlyPaise = toPaise(form.monthly);
    const priceYearlyPaise = toPaise(form.yearly);
    const maxBranches = toLimit(form.maxBranches);
    const maxUsers = toLimit(form.maxUsers);
    const sortOrder = Number(form.sortOrder);
    if ([priceMonthlyPaise, priceYearlyPaise, maxBranches, maxUsers].includes("invalid") || !Number.isInteger(sortOrder) || sortOrder < 0) {
      toast.error("Prices must be 0 or more; limits whole numbers above 0 (empty = unlimited)");
      return;
    }
    const base = {
      name: form.name.trim(),
      priceMonthlyPaise: priceMonthlyPaise as number | null,
      priceYearlyPaise: priceYearlyPaise as number | null,
      maxBranches: maxBranches as number | null,
      maxUsers: maxUsers as number | null,
      isActive: form.isActive,
      sortOrder,
    };
    save.mutate(
      editing === "new" ? { dto: { ...base, code: form.code.trim() } } : { id: (editing as PlatformPlan).id, dto: base },
      {
        onSuccess: (r) => {
          setWarnings(r.warnings);
          toast.success(`Plan "${r.plan.name}" saved`);
          setEditing(null);
        },
        onError: (e) => toast.error(e instanceof ApiError ? e.message : "Could not save the plan"),
      },
    );
  };

  const field = (key: keyof FormState, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <div className="flex flex-col gap-2">
      <Label htmlFor={`plan-${key}`}>{label}</Label>
      <Input
        id={`plan-${key}`}
        value={form[key] as string}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
        {...props}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Platform</h1>
        <p className="text-sm text-muted-foreground">Plans offered to restaurants (prices excl. GST)</p>
      </div>
      <PlatformTabs />

      {warnings.length > 0 && (
        <ul className="list-disc rounded-xl border border-warning bg-warning-soft p-4 pl-8 text-sm text-foreground">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      <Button className="w-fit" onClick={() => open("new")}>New plan</Button>

      <div className="rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Order</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Monthly</TableHead>
              <TableHead className="text-right">Yearly</TableHead>
              <TableHead>Branches</TableHead>
              <TableHead>Users</TableHead>
              <TableHead>Razorpay plan</TableHead>
              <TableHead>Active</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans?.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="tabular-nums">{p.sortOrder}</TableCell>
                <TableCell className="font-mono text-xs">{p.code}</TableCell>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="text-right tabular-nums">{p.priceMonthlyPaise === null ? "—" : inr(p.priceMonthlyPaise)}</TableCell>
                <TableCell className="text-right tabular-nums">{p.priceYearlyPaise === null ? "—" : inr(p.priceYearlyPaise)}</TableCell>
                <TableCell>{p.maxBranches ?? "Unlimited"}</TableCell>
                <TableCell>{p.maxUsers ?? "Unlimited"}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {[p.priceMonthlyPaise !== null && (p.razorpayPlanIdMonthly ? "monthly ready" : "monthly missing"),
                    p.priceYearlyPaise !== null && (p.razorpayPlanIdYearly ? "yearly ready" : "yearly missing")]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </TableCell>
                <TableCell>{p.isActive ? "Yes" : "No"}</TableCell>
                <TableCell>
                  <Button size="sm" variant="outline" onClick={() => open(p)}>Edit</Button>
                </TableCell>
              </TableRow>
            ))}
            {plans && plans.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="text-center text-sm text-muted-foreground">No plans yet</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "New plan" : "Edit plan"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            {field("code", "Code", { disabled: editing !== "new", placeholder: "e.g. basic" })}
            {field("name", "Name")}
            {field("monthly", "Monthly price, ₹ excl. GST", { inputMode: "decimal", placeholder: "Not set" })}
            {field("yearly", "Yearly price, ₹ excl. GST", { inputMode: "decimal", placeholder: "Not set" })}
            {field("maxBranches", "Max branches", { inputMode: "numeric", placeholder: "Unlimited" })}
            {field("maxUsers", "Max users", { inputMode: "numeric", placeholder: "Unlimited" })}
            {field("sortOrder", "Order", { inputMode: "numeric" })}
            <div className="flex items-center justify-between gap-2 self-end rounded-lg border border-border px-3 py-2">
              <Label htmlFor="plan-active">Active</Label>
              <Switch id="plan-active" checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            A new or changed price creates a new Razorpay plan (price + GST). Existing subscribers keep their current price.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button disabled={save.isPending || !form.name.trim() || (editing === "new" && !form.code.trim())} onClick={submit}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
