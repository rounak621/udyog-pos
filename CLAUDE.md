# UDYOG POS: master rules (read before every task)

## What this is
UDYOG POS = restaurant POS, white-labelled from an AGPL-3.0 open-source repo, owned and sold by Rounak (UDYOG, Mumbai, India). Final product: a desktop app (Windows first) connected to OUR cloud server for auth and API; many restaurants on one cloud server. Repo: github.com/rounak621/udyog-pos (branch main, public). Stack: pnpm + Turborepo, apps/backend (NestJS, Prisma, PostgreSQL), apps/web (Next.js, Tailwind v4, shadcn), packages/types.

## Brand
- Product name: "UDYOG POS". UDYOG is always in capitals.
- Never show "NodeDR", "OrderRestro" or the original logo to users.
- Logo and icon files are in brand/ (logo with POS and orange lines, dark-background logo, icon set in brand/icons).
- Primary colour: orange #FF6F00. Dark: #1A1A1A.

## UI rules
- Solid colours and solid borders only. No transparent or low-opacity fills (no bg-x/10, border-x/50 style classes), no gradients, no glassmorphism.
- Keep existing component patterns; do not refactor unrelated code.
- No invented numbers, fake reviews or fake testimonials anywhere in the product.
- Do NOT write "open source" or "AGPL" anywhere in the app UI. Exception that must stay: a small visible "Source code" link to https://github.com/rounak621/udyog-pos in the app shell, and the original copyright notices.

## Licence (AGPL-3.0, not legal advice)
- Never edit or delete LICENSE, CITATION.cff, or any line containing "Copyright" or "Nodedr Infotech Private Limited and Raktim Ranjit".
- Keep the repo public. A lawyer check is planned before taking customer money.

## Decisions already made (do not undo)
- Sign-up is closed after first setup. ALLOW_SIGNUP=true enables hosted mode (needs a web change later).
- Demo seed refuses to run in production unless ALLOW_DEMO_SEED=true. Postgres password has no default.
- Update checks and downloads are OFF unless env vars are set. Images are built from source. Workflows are manual (workflow_dispatch) until CI/CD is set up on purpose.
- Hidden names are renamed: cookie udyog_session, storage keys udyogpos_*, webhook headers X-UDYOG-*, QR prefix udyogpos:order:, MCP name udyog-pos.
- Intentionally NOT renamed (invisible, risky): package scope @nodedr-restaurant/*, DB user/name, compose container and volume names.
- India: INR, GST, CGST/SGST exist. HSN/SAC, IGST, FSSAI are to be added. Spain VeriFactu pages are to be hidden.
- AI voice agent is called "Maya" (Hinglish). AI features come last.

## How to work
- Every task has a time limit (about 10 minutes) and a small scope. Do only what the prompt says. If it is too big, stop and say how to split it.
- Smallest change possible. No new dependencies unless the prompt says so.
- Checks: type check of the packages you touched and only the tests for files you touched. No full test suites. No docker build unless asked.
- Never push or deploy to production. Pushing to origin main of our own repo is fine only when the prompt says so. Deploys only through CI/CD (GitHub Actions), never manual SSH, never [skip ci].
- Never commit .env, secrets, keys or customer data.
- Git email: rounakchoudharyunknown@gmail.com.
- Final report format: short. Files changed (git show --stat HEAD, stat only, no full diffs), results of checks, git log -1, git ls-remote origin. Do not claim "pushed" without showing ls-remote output.
- Shell is zsh: quote globs ('*.ts'). Always state which folder a command runs in.

## Theme tokens
- UI primary is orange #FF7A1A (apps/web/app/globals.css: --primary, --ring, sidebar primary, themeColor and manifests). The logo keeps its own orange (#FF6F00); do not recolour the logo files.
- Solid tint tokens (light, dark and kiosk): primary-soft, success-soft, warning-soft, destructive-soft, info-soft. Solid hover shades: primary-hover, destructive-hover. QR box (always white so codes scan): qr-surface, qr-foreground, qr-muted-foreground. Use them as Tailwind classes, e.g. bg-primary-soft, ring-destructive-soft, hover:bg-primary-hover.
- Neutral cases use the existing muted, secondary, border and muted-foreground tokens.
- No slash-opacity colour classes (bg-x/10, border-x/50, text-x/70 ...) except modal backdrops (fixed/absolute inset-0 overlays). Plain opacity-* for disabled states and animations is fine.

## India decisions
- New fields (all nullable): MenuItem.hsnSac, Branch.defaultHsnSac, OrderItem.hsnSacSnapshot (item code, else branch default, at order time), Branch.fssaiNumber, Order.customerGstin, Order.placeOfSupplyStateCode. Migrations: 20261109000000_india_hsn_sac, 20261109010000_india_fssai, 20261109020000_india_igst.
- India fields are shown and printed only when Branch.taxRegime is INDIA_GST.
- Branch state code is derived from the branch GSTIN (taxId, else gstNumber, first 2 digits); there is no stateCode field. The CRM Customer has no GSTIN field; the buyer GSTIN lives on the Order.
- CGST/SGST vs IGST is decided in ONE place: splitIndiaGst in packages/types/src/tax.ts (with isValidGstin, gstinStateCode, isValidHsnSac, isValidFssai, INDIA_STATES). Receipts (HTML and thermal) and the POS bill totals call it; do not duplicate the split.
- Spain VERI*FACTU is hidden unless the branch is Spain (apps/web/lib/region.ts isSpainBranch: country ES or regime ES_IVA); its page redirects to /settings otherwise. The code is kept.
- Support link: NEXT_PUBLIC_SUPPORT_EMAIL (build-time); unset = no "Help & support" item.

## Platform admin
- Grant (no API, no env var): `docker exec nodedr-restaurant-backend node dist/scripts/make-platform-admin.js you@example.com` (dev: `pnpm --filter @nodedr-restaurant/backend make-platform-admin you@example.com`). Refuses unless exactly one user has that email.

## Rate limits
- In-memory throttler: 300/min per client IP app-wide; login, register and pin-login add 20/min per IP and 5/min per IP + email (or userId). Set TRUST_PROXY behind a reverse proxy. A shared store (Redis) is a later step, needed before running more than one backend.

## Cloud decisions
- One server, many restaurants (tenant = Restaurant). Every branchId from a client goes through BranchAccessService.assertAccess; every foreign id in a body is checked against the caller's branch/restaurant.
- Platform admin = User.isPlatformAdmin (UDYOG staff). Not a role or permission, not in any DTO or API; API keys never carry it. PlatformAdminGuard (`@PlatformAdmin()`) guards backup, server sync admin, system update, download stats and (in production) swagger. Backup alerts go to platform admins only. Grant it only with scripts/make-platform-admin.ts (see "Platform admin" above).
- Staff email is unique across all restaurants (checked in code; DB constraint is still per restaurant). PIN login needs the terminal's branchId.
- Deferred: UserBranch enforcement in assertAccess; limits on imageUrl/logoUrl and per-tenant upload folders; Redis-backed rate limits; review of the sync trigger SQL (migrations).
- Restaurant.status: TRIAL | ACTIVE | SUSPENDED (existing rows ACTIVE). getAccessState (packages/types/src/restaurant-status.ts) is the only rule: SUSPENDED or an expired TRIAL is locked (403 + code RESTAURANT_SUSPENDED / TRIAL_EXPIRED) in the JWT strategy, login, pin-login, Socket.IO and API keys; the QR menu and kiosk answer like an unknown token. Platform admins are exempt. Data is never deleted.
- Hosted sign-up (ALLOW_SIGNUP=true) is always open (GET /auth/setup-status -> signupOpen) and starts a TRIAL of TRIAL_DAYS days (default 14). First local setup stays ACTIVE.
- Platform screen (/platform, platform admins only): restaurant name, owner email, counts and status only; never orders, customers, menu or money. Actions: suspend, unsuspend, extend trial (1-90 days), mark active; each is audit-logged. An admin cannot suspend their own restaurant.
- Sync never copies User.isPlatformAdmin from another install (LOCAL_ONLY_COLUMNS in sync.service.ts).
- Known gaps: no email verification at sign-up, no payments yet; ALLOW_SIGNUP and TRIAL_DAYS are not passed to the backend container by docker-compose.yml yet.

## Billing decisions
- UDYOG's own subscriptions via Razorpay Subscriptions (apps/backend/src/modules/billing). Plans live in the DB (platform admin: /platform/plans); NO seed plans, no prices in code. Prices are paise EXCLUDING GST; Razorpay plan = price + GST (GST_RATE_PERCENT). A price change creates a new Razorpay plan; existing subscribers keep theirs.
- Restaurant ACTIVE with no Subscription row = free/complimentary (no limits). EXPIRED = paid subscription lapsed or cancelled and its period ended (code SUBSCRIPTION_EXPIRED). Expired trial/subscription can still log in and reach only the billing routes (@AllowWhenExpired); SUSPENDED cannot.
- The Razorpay webhook (POST /api/v1/billing/webhook, signature + event-id idempotency) is the source of truth; /billing/verify only checks the checkout signature. A daily reconcile job fixes missed webhooks (skipped without keys).
- Plan limits (maxBranches/maxUsers) apply only with a live subscription; staff create and re-activation are checked. Branches have no create API yet.
- GST invoices: UDYOG/<FY>/<6 digits>, per Indian FY (Asia/Kolkata), issued in the webhook transaction from the charged amount; snapshot JSON. Missing COMPANY_* / SUBSCRIPTION_SAC / GST_RATE_PERCENT = no invoice ("Invoice pending").
- Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, GRACE_DAYS (3), COMPANY_NAME, COMPANY_GSTIN, COMPANY_ADDRESS, SUBSCRIPTION_SAC, GST_RATE_PERCENT.
- Known gaps: no plan change/upgrade flow; trial has no limits; SAC and GST rate need a CA check before launch; refunds not handled; invoice is HTML only (print to PDF); no email verification at sign-up.

## Desktop decisions
- Printers belong to the PC, not the branch: the Windows app stores them in %LOCALAPPDATA%\UDYOGPOS\printers.json (roles RECEIPT and KITCHEN; Ctrl+Shift+P). Paper width, code page and columns stay branch settings (Branch.printerPaperWidthMm/printerCodepage/printerColumns).
- The backend only builds ESC/POS bytes (GET orders/:id/print/escpos, orders/:id/kot/escpos, orders/print/drawer/escpos, orders/print/test/escpos); the shell prints them (winspool RAW or TCP 9100). The drawer pulse goes through printRaw to RECEIPT.
- Server-side printing (USB/9100 from the server, KDS print/reprint) is OFF unless ALLOW_SERVER_PRINT=true; otherwise those routes answer 409 SERVER_PRINT_DISABLED. /auth/me returns serverPrintEnabled.
- Bridge trust (windows/msix/Launcher/NativeBridge.cs): only messages whose Source is the configured server origin, only on WebViews the shell created; max 1 MB; no file or process access; the web can read the printer config but never change it. BridgeVersion = 1.
- HTML window.print() is always the fallback: on a bridge error the web offers "Print in browser" once, never prints twice. Outside the Windows app the web behaves as before.
- Kitchen auto-print uses the existing kot.created event (payload now also has orderId), de-duplicated per window (memory + sessionStorage udyogpos_autoprinted_kots).
- MIN_SHELL_VERSION (optional): GET /system/shell-check reads the UDYOGPOS-Shell/<version> user-agent token; older apps see a non-blocking update banner.
- Known gaps: no serial/Bluetooth printers, no label printers, no per-station printer routing beyond the station filter, C# is not unit-tested (compiled only by the manual windows-msix workflow), Store identity and code signing pending.
