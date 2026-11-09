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
