"use client";

import type { PlatformRestaurantRow, RestaurantStatus } from "@nodedr-restaurant/types";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentUser } from "@/hooks/use-auth";
import { usePlatformAction, usePlatformRestaurants } from "@/hooks/use-platform";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

// UDYOG platform admins only: every restaurant on this server, with account
// status actions. Shows account metadata only, never a restaurant's data.

const STATUS_STYLE: Record<RestaurantStatus, string> = {
  TRIAL: "border-warning bg-warning-soft",
  ACTIVE: "border-success bg-success-soft",
  SUSPENDED: "border-destructive bg-destructive-soft",
};

const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString() : "—");
const errMsg = (e: unknown) => (e instanceof ApiError ? e.message : "Something went wrong");

export default function PlatformPage() {
  const router = useRouter();
  const { data: me, isLoading } = useCurrentUser();
  const isAdmin = me?.user.isPlatformAdmin === true;
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [suspendRow, setSuspendRow] = useState<PlatformRestaurantRow | null>(null);
  const [reason, setReason] = useState("");
  const [extendRow, setExtendRow] = useState<PlatformRestaurantRow | null>(null);
  const [days, setDays] = useState("14");

  useEffect(() => {
    if (!isLoading && me && !isAdmin) router.replace("/dashboard");
  }, [isLoading, me, isAdmin, router]);

  const { data, isFetching } = usePlatformRestaurants(search, page, isAdmin);
  const action = usePlatformAction();
  const run = (a: Parameters<typeof action.mutate>[0], done: string) =>
    action.mutate(a, {
      onSuccess: () => toast.success(done),
      onError: (e) => toast.error(errMsg(e)),
    });

  if (!isAdmin) return null;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const daysNum = Number(days);
  const daysValid = Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 90;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-[32px] font-semibold tracking-tight text-foreground">Platform</h1>
        <p className="text-sm text-muted-foreground">Restaurants on this server and their account status</p>
      </div>

      <form
        className="flex max-w-md gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(searchInput);
          setPage(1);
        }}
      >
        <Input
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search restaurant name or owner email"
          aria-label="Search restaurants"
        />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      <div className="rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Restaurant</TableHead>
              <TableHead>Owner email</TableHead>
              <TableHead className="text-right">Branches</TableHead>
              <TableHead className="text-right">Users</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Trial ends</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.items.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell>{r.ownerEmail ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">{r.branchCount}</TableCell>
                <TableCell className="text-right tabular-nums">{r.userCount}</TableCell>
                <TableCell>{fmtDate(r.createdAt)}</TableCell>
                <TableCell>
                  <span
                    className={cn("rounded-full border px-2 py-0.5 text-xs font-medium text-foreground", STATUS_STYLE[r.status])}
                    title={r.suspendedReason ?? undefined}
                  >
                    {r.status}
                  </span>
                </TableCell>
                <TableCell>
                  {fmtDate(r.trialEndsAt)}
                  {r.daysLeft != null && r.status === "TRIAL" ? ` (${r.daysLeft}d)` : ""}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    {r.status === "SUSPENDED" ? (
                      <Button size="sm" variant="outline" disabled={action.isPending}
                        onClick={() => run({ kind: "unsuspend", id: r.id }, `${r.name} unsuspended`)}>
                        Unsuspend
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" disabled={action.isPending}
                        onClick={() => { setReason(""); setSuspendRow(r); }}>
                        Suspend
                      </Button>
                    )}
                    <Button size="sm" variant="outline" disabled={action.isPending}
                      onClick={() => { setDays("14"); setExtendRow(r); }}>
                      Extend trial
                    </Button>
                    {r.status !== "ACTIVE" && (
                      <Button size="sm" variant="outline" disabled={action.isPending}
                        onClick={() => run({ kind: "mark-active", id: r.id }, `${r.name} marked active`)}>
                        Mark active
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {data && data.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                  No restaurants found
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Button size="sm" variant="outline" disabled={page <= 1 || isFetching} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <span>
          Page {page} of {pages}
          {data ? ` · ${data.total} restaurants` : ""}
        </span>
        <Button size="sm" variant="outline" disabled={page >= pages || isFetching} onClick={() => setPage((p) => p + 1)}>
          Next
        </Button>
      </div>

      <Dialog open={!!suspendRow} onOpenChange={(o) => !o && setSuspendRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend {suspendRow?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="suspend-reason">Reason (optional)</Label>
            <Input id="suspend-reason" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
            <p className="text-xs text-muted-foreground">Staff of this restaurant are locked out. No data is deleted.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendRow(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={action.isPending}
              onClick={() => {
                if (!suspendRow) return;
                run({ kind: "suspend", id: suspendRow.id, reason: reason.trim() || undefined }, `${suspendRow.name} suspended`);
                setSuspendRow(null);
              }}
            >
              Suspend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!extendRow} onOpenChange={(o) => !o && setExtendRow(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Extend trial for {extendRow?.name}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="extend-days">Days to add (1 to 90)</Label>
            <Input id="extend-days" type="number" min={1} max={90} step={1} value={days} onChange={(e) => setDays(e.target.value)} />
            <p className="text-xs text-muted-foreground">Counted from today or the current trial end, whichever is later.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtendRow(null)}>Cancel</Button>
            <Button
              disabled={!daysValid || action.isPending}
              onClick={() => {
                if (!extendRow) return;
                run({ kind: "extend-trial", id: extendRow.id, days: daysNum }, `Trial extended for ${extendRow.name}`);
                setExtendRow(null);
              }}
            >
              Extend
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
