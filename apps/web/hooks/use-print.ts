"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import {
  bridgeErrorMessage,
  isDesktop,
  isRoleConfigured,
  printRaw,
  type PrinterRole,
} from "@/lib/native-bridge";
import { billQueryString, type BillQuery } from "@/lib/print";

/**
 * Printing inside the UDYOG POS Windows app: the server builds ESC/POS bytes
 * (GET .../escpos), the app sends them to this PC's printer. A failure on
 * the PC side (no printer set up, printer offline) is a DesktopPrintError,
 * so the screen can offer the browser print dialog instead. Outside the app
 * every hook below works exactly as before.
 */
export class DesktopPrintError extends Error {
  constructor(
    public role: PrinterRole,
    cause: unknown,
  ) {
    super(bridgeErrorMessage(cause, role));
  }
}

interface EscposPayload {
  data: string;
  contentType: string;
  paperWidth: number;
  codepage: string;
  unsupportedChars?: string[];
}

interface KotEscposPayload extends EscposPayload {
  tickets: { kotId: string; ticketNumber: string; stationId: string | null; stationName: string | null; data: string }[];
}

async function desktopPrint<T extends EscposPayload>(role: PrinterRole, url: string): Promise<T> {
  let configured: boolean;
  try {
    configured = await isRoleConfigured(role);
  } catch (err) {
    throw new DesktopPrintError(role, err);
  }
  if (!configured) throw new DesktopPrintError(role, null);
  const payload = await api.get<T>(url); // server errors stay ApiError
  try {
    await printRaw(role, payload.data);
  } catch (err) {
    throw new DesktopPrintError(role, err);
  }
  return payload;
}

export interface PrinterDiagnostics {
  connection: "USB" | "NETWORK";
  network: { host: string; port: number; reachable: boolean; error: string | null } | null;
  lpDevices: string[];
  libusbPrinter: { vendorId: number; productId: number; id: string } | null;
  canPrint: boolean;
  notes: string[];
}

/** `enabled` false when the server does not print itself (ALLOW_SERVER_PRINT off). */
export function usePrinterDiagnostics(branchId?: string | null, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ["print", "diagnostics", branchId ?? null],
    queryFn: () => api.get<PrinterDiagnostics>(`/orders/print/diagnostics${branchId ? `?branchId=${branchId}` : ""}`),
    refetchOnWindowFocus: false,
  });
}

export interface PrintJobResult {
  ok: true;
  /** Characters the printer's code page cannot print (shown as "?" on paper). */
  unsupportedChars?: string[];
}

/** kind "kot" prints a sample kitchen ticket instead of the receipt test slip. */
export function usePrintTestSlip(branchId?: string | null, kind?: "kot") {
  return useMutation({
    mutationFn: async () => {
      const query = [branchId ? `branchId=${branchId}` : "", kind ? `kind=${kind}` : ""].filter(Boolean).join("&");
      if (await isDesktop()) {
        await desktopPrint(kind === "kot" ? "KITCHEN" : "RECEIPT", `/orders/print/test/escpos?${query}`);
        return { ok: true as const };
      }
      return api.post<{ ok: true }>(`/orders/print/test?${query}`);
    },
  });
}

/**
 * `drawer` also kicks the cash drawer — pass true when the bill was paid in
 * cash. `adjustments` prices a not-yet-paid bill the way the screen shows it;
 * a bill printed before payment never opens the drawer.
 */
export function usePrintOrderUsb(branchId: string | null) {
  return useMutation({
    mutationFn: async ({
      orderId,
      drawer,
      adjustments,
    }: {
      orderId: string;
      drawer?: boolean;
      adjustments?: BillQuery;
    }): Promise<PrintJobResult> => {
      const query = `branchId=${branchId}${drawer ? "&drawer=true" : ""}${billQueryString(adjustments)}`;
      if (await isDesktop()) {
        const payload = await desktopPrint("RECEIPT", `/orders/${orderId}/print/escpos?${query}`);
        return { ok: true, unsupportedChars: payload.unsupportedChars };
      }
      return api.post<PrintJobResult>(`/orders/${orderId}/print/usb?${query}`);
    },
  });
}

export interface KotPrintResult extends PrintJobResult {
  printed: { id: string; ticketNumber: string; reprint: number }[];
}

/**
 * Kitchen tickets to the thermal printer (native text, no prices). Without
 * `reprint` only tickets not yet printed go out and a repeat answers
 * ALREADY_PRINTED; `reprint: true` prints another copy stamped REPRINT.
 */
export function usePrintKot(branchId: string | null) {
  return useMutation({
    mutationFn: async ({ orderId, reprint }: { orderId: string; reprint?: boolean }): Promise<KotPrintResult> => {
      if (await isDesktop()) {
        // Desktop: every ticket of the order goes to this PC's kitchen printer.
        const payload = await desktopPrint<KotEscposPayload>(
          "KITCHEN",
          `/orders/${orderId}/kot/escpos?branchId=${branchId}`,
        );
        return {
          ok: true,
          printed: payload.tickets.map((t) => ({ id: t.kotId, ticketNumber: t.ticketNumber, reprint: 0 })),
          unsupportedChars: [],
        };
      }
      return api.post<KotPrintResult>(`/orders/${orderId}/print/kot?branchId=${branchId}${reprint ? "&reprint=true" : ""}`);
    },
  });
}

export function useOpenCashDrawer() {
  return useMutation({
    mutationFn: async (branchId?: string | null) => {
      const query = branchId ? `?branchId=${branchId}` : "";
      if (await isDesktop()) {
        // The drawer hangs off the receipt printer: send its pulse there.
        await desktopPrint("RECEIPT", `/orders/print/drawer/escpos${query}`);
        return { ok: true as const };
      }
      return api.post<{ ok: true }>(`/orders/print/drawer${query}`);
    },
  });
}
