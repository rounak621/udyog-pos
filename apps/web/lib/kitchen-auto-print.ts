// Kitchen auto-print for the UDYOG POS Windows app. Driven by the existing
// realtime event "kot.created" ({ id, stationId, orderId }), which the
// backend emits for every new kitchen ticket. Only inside the desktop app,
// only when this PC has "Auto-print kitchen tickets" on, and only for the
// stations this PC is set to (empty = all).
//
// Never prints a ticket twice from this window: ids are claimed in memory
// before printing and kept in sessionStorage, so a socket reconnect or a
// repeated event cannot print the same ticket again.

import { api, ApiError } from "@/lib/api";
import { getDeviceConfig, isDesktop, printRaw } from "@/lib/native-bridge";

const STORAGE_KEY = "udyogpos_autoprinted_kots";
const MAX_REMEMBERED = 500;
const printed = new Set<string>();
let loaded = false;

function loadPrinted() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    const ids = raw ? (JSON.parse(raw) as unknown) : [];
    if (Array.isArray(ids)) ids.forEach((id) => typeof id === "string" && printed.add(id));
  } catch {
    // Storage unavailable: the in-memory set still de-duplicates.
  }
}

function savePrinted() {
  try {
    const ids = [...printed].slice(-MAX_REMEMBERED);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // ignore
  }
}

interface KotCreated {
  id?: string;
  stationId?: string | null;
  orderId?: string;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function autoPrintKitchenTicket(branchId: string, payload: unknown): Promise<void> {
  const event = (payload ?? {}) as KotCreated;
  const kotId = event.id;
  const orderId = event.orderId;
  if (!kotId || !orderId) return;

  loadPrinted();
  if (printed.has(kotId)) return;

  if (!(await isDesktop())) return;
  let config;
  try {
    config = await getDeviceConfig();
  } catch {
    return;
  }
  if (!config.autoPrintKitchen || !config.kitchen) return;
  const stations = config.kitchenStations ?? [];
  if (stations.length > 0 && !(event.stationId && stations.includes(event.stationId))) return;

  // Claim before any await below, so two deliveries of the same event cannot both print.
  if (printed.has(kotId)) return;
  printed.add(kotId);
  savePrinted();

  // The event is sent while the ticket is being saved: retry briefly until it is readable.
  for (let attempt = 0; attempt < 4; attempt++) {
    let data: string;
    try {
      const res = await api.get<{ data: string }>(
        `/orders/${orderId}/kot/escpos?branchId=${branchId}&kot=${encodeURIComponent(kotId)}`,
      );
      data = res.data;
    } catch (err) {
      const notReadyYet =
        err instanceof ApiError && (err.status === 404 || (err.status === 409 && err.code === "NO_TICKETS"));
      if (notReadyYet && attempt < 3) {
        await wait(1500);
        continue;
      }
      // Nothing was sent: release the claim.
      printed.delete(kotId);
      savePrinted();
      return;
    }
    try {
      await printRaw("KITCHEN", data);
    } catch {
      // Keep the claim: the bytes may already be on paper. Staff can print
      // the ticket again by hand from the POS.
    }
    return;
  }
}
