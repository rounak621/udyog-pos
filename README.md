# UDYOG POS

UDYOG POS is a restaurant point-of-sale and back-office web application run
by UDYOG (Mumbai, India) as one hosted service for many restaurants. It
covers billing at the counter and at tables, a kitchen display, a QR menu for
guests, menu and table management, India GST receipts (CGST/SGST/IGST,
HSN/SAC, FSSAI) with consecutive invoice numbers, staff roles and reports. A
Windows desktop app (`windows/`) hosts the same web app and prints receipts
and kitchen tickets on the restaurant's own printers.

## Local development

Requires Node 22+, pnpm (version in `package.json` → `packageManager`) and
Docker for the development database.

```bash
pnpm install
docker compose up -d postgres                      # development database only
cp apps/backend/.env.example apps/backend/.env     # point DATABASE_URL at it
pnpm --filter @nodedr-restaurant/types build
cd apps/backend && npx prisma migrate dev && cd ../..
pnpm dev                                           # backend :4001, web :1995
```

Optional demo data: `cd apps/backend && npx ts-node prisma/seed.ts`.

The full development stack in containers (`docker compose up -d --build`,
`docker-compose.yml`) is for local testing only.

Checks used by CI: `pnpm --filter @nodedr-restaurant/backend typecheck`,
`pnpm --filter web typecheck`, `pnpm --filter @nodedr-restaurant/backend test`,
`pnpm --filter web test`.

## Deployment

Staging and production run from `docker-compose.prod.yml` behind Caddy, with
images built by GitHub Actions. See [`docs/DEPLOY.md`](./docs/DEPLOY.md) and
[`docs/LAUNCH-CHECKLIST.md`](./docs/LAUNCH-CHECKLIST.md).

## Project layout

```
apps/backend    NestJS API (REST /api/v1, Socket.IO), Prisma + PostgreSQL
apps/web        Next.js web app: back office, POS, kitchen display, QR menu
packages/types  Shared Zod schemas and TypeScript types
windows/        Windows desktop app (WebView2 shell, MSIX)
scripts/        deploy.sh / rollback.sh (server), development helpers
docs/           Deployment guide, launch checklist, technical notes
brand/          UDYOG POS logo and icons
```

The package scope `@nodedr-restaurant/*`, the development database names and
the development container names are internal and intentionally unchanged.

## License

This software is licensed under the GNU Affero General Public License v3.0
(AGPL-3.0); the full text is in [`LICENSE`](./LICENSE). The original
copyright and attribution notices are kept in [`NOTICE.md`](./NOTICE.md).
Under the AGPL, users who interact with the service over a network can get
its source code: the app shows a "Source code" link to
https://github.com/rounak621/udyog-pos.
