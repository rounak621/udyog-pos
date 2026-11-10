# UDYOG POS for Windows

`windows/msix/` is a small WinForms + WebView2 shell, packaged as MSIX. It opens the UDYOG POS cloud web app in a desktop window; no server or database inside. It allows only the configured server origin (other links open in the default browser), opens same-origin popups such as `/customer-display` as real second windows, saves downloads to Downloads, and shows a local "Cannot reach UDYOG POS" page with Retry when the server is unreachable.

## Build (manual workflow)
GitHub → Actions → "Windows MSIX build" → Run workflow. Leave inputs empty for the fake DEV identity. The artifact holds `UDYOGPOS.msix` and `udyogpos-dev.cer` (throwaway test cert). Locally on Windows: `windows/msix/build-windows-msix.ps1 -SelfSignedTest`.

## Server address and config
First run asks for the server address: HTTPS only (http only for localhost/127.0.0.1), saved as an origin in `%LOCALAPPDATA%\UDYOGPOS\config.json` with window positions. Ctrl+Shift+S (File → Settings) changes it and the start-at-sign-in option. A build can pre-fill it (`-DefaultServerUrl` / workflow input). Credentials are never stored by the shell; sign-in is the web app's cookie in the WebView2 profile (`%LOCALAPPDATA%\UDYOGPOS\WebView2`).

## Release identity (owner must provide)
`AppxManifest.xml` holds tokens. Build parameters / workflow inputs fill them; defaults are fake (`UDYOG.POS.Dev`, `CN=UDYOG Dev`, version `0.1.0.0`) and `validate-msix.ps1` rejects them without `-AllowDevIdentity`. For release, provide either the Microsoft Partner Center "Product identity" values (the Store signs on upload) or a code-signing certificate whose Subject equals `-Publisher` (signing with it is not wired up yet).

## Windows test checklist (real Windows 10/11 PC)
1. Install: import `udyogpos-dev.cer` into Local Machine → Trusted People (or Trusted Root), then open `UDYOGPOS.msix`; app appears in Start as "UDYOG POS" with the UDYOG icon.
2. First run shows the server form; `http://example.com` is rejected, the real https address is accepted and the login page loads.
3. Log in; close and reopen the app; still logged in. Window size/position/maximized state is restored.
4. POS → open customer display: it opens in a second window and updates live as the POS cart changes (BroadcastChannel). Move it to a second monitor, press F11, close and reopen it: it returns full screen there.
5. Reports → Excel/PDF/CSV: a "Saved to Downloads" bar appears; "Open folder" selects the file; repeat gives "name (1).ext".
6. Print a receipt and press Ctrl+P on a page: the Windows print dialog / preview opens.
7. F11 toggles borderless full screen on the main window; F5/Ctrl+R reload; Ctrl+0 resets zoom.
8. Ctrl+Shift+S → tick "Start UDYOG POS when I sign in to Windows", sign out and in: app starts. Untick: it no longer does (also visible in Task Manager → Startup apps).
9. Launch the app again while it runs: the existing window comes to the front, no second copy.
10. Disconnect the network and reload: the "Cannot reach UDYOG POS" page shows; Retry and the 10-second auto-retry reload the app once the network is back.
11. A link to another site (e.g. the "Source code" link) opens in the default browser; the app stays on the POS.
12. User agent ends with `UDYOGPOS-Shell/<version>`: see it in the server or reverse-proxy access log, or in a Debug build via F12 DevTools → `navigator.userAgent`. The settings form footer shows the same version.
