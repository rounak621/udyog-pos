// Talks to the UDYOG POS Windows app (WebView2 shell) when the web app runs
// inside it. Protocol (windows/msix/Launcher/NativeBridge.cs):
//   request  { id, type, payload }  -> window.chrome.webview.postMessage
//   reply    { id, ok, data?, error? } <- "message" event
// In a normal browser there is no window.chrome.webview: every call fails
// fast and isDesktop() is false, so the rest of the app behaves as before.

export type PrinterRole = "RECEIPT" | "KITCHEN";

export interface ShellHello {
  bridgeVersion: number;
  shellVersion: string;
}

export interface PrinterTarget {
  kind: "windows" | "network";
  name?: string;
  host?: string;
  port?: number;
}

export interface DeviceConfig {
  receipt?: PrinterTarget | null;
  kitchen?: PrinterTarget | null;
  autoPrintKitchen: boolean;
  /** Empty = every station. */
  kitchenStations: string[];
}

/** A bridge failure; `code` is the shell's error code (e.g. "not_configured"). */
export class BridgeError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

interface WebViewHost {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

interface Reply {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

const TIMEOUT_MS = 10_000;
const pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let listening = false;
let counter = 0;
let helloPromise: Promise<ShellHello | null> | null = null;

function host(): WebViewHost | null {
  if (typeof window === "undefined") return null;
  const webview = (window as unknown as { chrome?: { webview?: WebViewHost } }).chrome?.webview;
  return webview && typeof webview.postMessage === "function" ? webview : null;
}

function onReply(event: { data: unknown }) {
  const reply = event.data as Partial<Reply> | null;
  if (!reply || typeof reply !== "object" || typeof reply.id !== "string") return;
  const entry = pending.get(reply.id);
  if (!entry) return;
  pending.delete(reply.id);
  clearTimeout(entry.timer);
  if (reply.ok) entry.resolve(reply.data);
  else entry.reject(new BridgeError(typeof reply.error === "string" ? reply.error : "error"));
}

function request<T>(type: string, payload: Record<string, unknown> = {}): Promise<T> {
  const webview = host();
  if (!webview) return Promise.reject(new BridgeError("no_bridge"));
  if (!listening) {
    webview.addEventListener("message", onReply);
    listening = true;
  }
  counter += 1;
  const id = `udyog-${Date.now().toString(36)}-${counter}`;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new BridgeError("timeout"));
    }, TIMEOUT_MS);
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
    webview.postMessage({ id, type, payload });
  });
}

/** Shell and bridge version, or null when not running in the Windows app. Asked once per page load. */
export function hello(): Promise<ShellHello | null> {
  if (!helloPromise) {
    helloPromise = host()
      ? request<ShellHello>("hello").then(
          (info) => (info && typeof info.bridgeVersion === "number" ? info : null),
          () => null,
        )
      : Promise.resolve(null);
  }
  return helloPromise;
}

/** True only inside the UDYOG POS Windows app with a working bridge. */
export async function isDesktop(): Promise<boolean> {
  return (await hello()) !== null;
}

export function getDeviceConfig(): Promise<DeviceConfig> {
  return request<DeviceConfig>("getDeviceConfig");
}

export async function isRoleConfigured(role: PrinterRole): Promise<boolean> {
  const config = await getDeviceConfig();
  return Boolean(role === "RECEIPT" ? config.receipt : config.kitchen);
}

export async function printRaw(role: PrinterRole, dataBase64: string): Promise<void> {
  await request<null>("printRaw", { role, dataBase64 });
}

export async function printTest(role: PrinterRole): Promise<void> {
  await request<null>("printTest", { role });
}

/** One plain sentence for a failed desktop print. */
export function bridgeErrorMessage(err: unknown, role: PrinterRole): string {
  const code = err instanceof BridgeError ? err.code : "error";
  const which = role === "RECEIPT" ? "receipt" : "kitchen";
  if (code === "not_configured") {
    return `No ${which} printer is set up on this PC. Set it up in the UDYOG POS app (Ctrl+Shift+P).`;
  }
  if (code === "timeout") return `The ${which} printer did not answer in time.`;
  return `The ${which} printer reported an error (${code}).`;
}
