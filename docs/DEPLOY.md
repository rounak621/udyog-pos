# Deploying UDYOG POS

One server runs one environment (staging or production): Caddy (HTTPS) in
front of the backend and web containers, plus Postgres (bundled or managed).
Pushing to `dev` deploys staging automatically. Production is deployed only
by hand from GitHub, after approval.

## 1. Create the server (AWS EC2)
1. Launch an instance: Ubuntu 24.04 LTS, at least 2 vCPU / 4 GB RAM, 30 GB disk.
   Use one server for staging and one for production.
2. Attach an Elastic IP so the address never changes.
3. Security group: SSH (22) only from your own IP; HTTP (80) and HTTPS (443) from anywhere.

## 2. DNS
1. Create an A record for the domain (e.g. `app.example.com`, and e.g.
   `staging.example.com` for staging) pointing at the Elastic IP.
2. Wait until `dig +short app.example.com` shows the IP. Caddy needs this to get the HTTPS certificate.

## 3. Prepare the server
1. Install Docker Engine and the compose plugin (Docker's official guide for Ubuntu).
2. Create a deploy user and give it Docker access:
   `sudo adduser --disabled-password deploy && sudo usermod -aG docker deploy`
3. Add the public half of a new SSH key pair to `/home/deploy/.ssh/authorized_keys`
   (the private half goes into GitHub, step 5).
4. Create the deploy folder: `sudo mkdir -p /opt/udyog-pos && sudo chown deploy: /opt/udyog-pos`
5. Copy `.env.production.example` from the repo to `/opt/udyog-pos/.env.production`
   and fill it in. Generate each secret with `openssl rand -hex 32`
   (JWT_SECRET, TWO_FACTOR_KEY, WEBHOOK_KEY, POSTGRES_PASSWORD; put the same
   password inside DATABASE_URL). Set DOMAIN and CORS_ORIGIN (`https://` + domain).
   Then `chmod 600 .env.production`.
6. `docker-compose.prod.yml`, `Caddyfile` and `scripts/` are copied by the
   GitHub workflow on every deploy; you do not need to copy them by hand.

## 4. Let the server pull images
1. On GitHub create a personal access token (classic) with only `read:packages`.
2. As the deploy user on the server: `docker login ghcr.io -u <github-user>` and paste the token.
   This is stored on the server only; never put it in the repository or a workflow.

## 5. GitHub settings
1. Settings → Environments: create `staging` and `production`. On `production`
   add Required reviewers (you), so every production deploy waits for approval.
2. Settings → Secrets and variables → Actions → Repository secrets:
   - `STAGING_HOST`, `STAGING_USER`, `STAGING_SSH_KEY`, `STAGING_DEPLOY_PATH`
   - `PRODUCTION_HOST`, `PRODUCTION_USER`, `PRODUCTION_SSH_KEY`, `PRODUCTION_DEPLOY_PATH`
   - optional `STAGING_SSH_KNOWN_HOSTS`, `PRODUCTION_SSH_KNOWN_HOSTS` (output of
     `ssh-keyscan <host>`; without them the workflow trusts the host key it sees)
   HOST = Elastic IP or hostname, USER = `deploy`, SSH_KEY = the private key,
   DEPLOY_PATH = `/opt/udyog-pos`.
3. Repository variable `NEXT_PUBLIC_SUPPORT_EMAIL` (may be empty: then no
   "Help & support" item). It is built into the web image.
4. Images go to `ghcr.io/rounak621/udyog-pos-backend` and `-web` using the
   workflow's own token; no extra secret is needed.

## 6. First staging deploy
1. Create the `dev` branch from `main` and push it: `git checkout -b dev && git push origin dev`.
2. Actions → "Deploy staging" runs: CI → build images → SSH → `scripts/deploy.sh <sha>`.
3. Open `https://<staging domain>`; the login page should load over HTTPS.

## 7. First run on a new environment
1. Sign up the first restaurant on the site (first setup is always open).
2. Make your own account platform admin (on the server, in the deploy folder):
   ```
   TAG=$(cat .deploy/CURRENT_TAG) docker compose --env-file .env.production \
     -f docker-compose.prod.yml exec backend node dist/scripts/make-platform-admin.js you@example.com
   ```
3. For hosted sign-ups set `ALLOW_SIGNUP=true` (and `TRIAL_DAYS`) in
   `.env.production`, then redeploy the running tag: `./scripts/deploy.sh $(cat .deploy/CURRENT_TAG)`.

## 8. Razorpay
1. Create plans in the app at `/platform/plans` (no prices are built in).
2. Razorpay Dashboard → Webhooks → URL `https://<domain>/api/v1/billing/webhook`,
   secret = `RAZORPAY_WEBHOOK_SECRET`, events:
   `subscription.authenticated`, `subscription.activated`, `subscription.charged`,
   `subscription.pending`, `subscription.halted`, `subscription.cancelled`,
   `subscription.completed`, `payment.failed`.
3. Put `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` and the
   `COMPANY_*`, `SUBSCRIPTION_SAC`, `GST_RATE_PERCENT` values in `.env.production`; redeploy.
   Test with Razorpay test keys on staging first.

## 9. Backups
1. Create a private S3 bucket (Block Public Access on) and an IAM user whose
   policy allows only `s3:PutObject`, `s3:GetObject`, `s3:ListBucket`,
   `s3:DeleteObject` on that bucket.
2. Set `S3_BACKUP_ENDPOINT` (e.g. `https://s3.ap-south-1.amazonaws.com`),
   `S3_BACKUP_BUCKET`, `S3_BACKUP_ACCESS_KEY_ID`, `S3_BACKUP_SECRET_ACCESS_KEY`,
   `S3_BACKUP_REGION`, `S3_BACKUP_INTERVAL_DAYS`, `S3_BACKUP_RETAIN_COUNT`; redeploy.
   (Platform admins can also set these in the app's Backup settings.)
3. Run a backup now from the Backup settings and check the bucket has a new
   `db.dump` (pg_dump custom format) and `uploads.tar.gz`.
4. Test a restore on a scratch copy, never on production:
   ```
   docker run -d --name restore-test -e POSTGRES_PASSWORD=test postgres:16-alpine
   docker cp db.dump restore-test:/tmp/db.dump
   docker exec restore-test pg_restore -U postgres -d postgres --create --no-owner /tmp/db.dump
   docker exec restore-test psql -U postgres -l   # the database is listed; spot-check tables
   docker rm -f restore-test
   ```
5. Also take an EBS snapshot of the server's disk (AWS console) before every production release.

## 10. Monitoring
Add a free uptime monitor (any HTTP checker) for `https://<domain>/api/health`
every 1-5 minutes with email alerts. Check `docker compose ... logs` when it fires.

## 11. Rollback
- Fastest: Actions → "Deploy production" → Run workflow with `ref` = the commit
  that was running before and `tag` = its image tag (shown in the earlier run's
  summary and in `/opt/udyog-pos/.deploy/PREVIOUS_TAGS`). This skips the build.
- On the server: `cd /opt/udyog-pos && ./scripts/rollback.sh <tag>`.
- `deploy.sh` already restores the previous tag by itself if the new one is not healthy within 120 s.
- The database is not rolled back (migrations only move forward). If a
  migration itself must be undone, restore the snapshot taken before the release.

## 12. Production release rules
1. Merge into `main` only what has run on staging.
2. Take a database backup and an EBS snapshot first.
3. Actions → "Deploy production" → Run workflow → `ref` = the commit on `main`
   (the run fails for commits not on `main`) → approve in the `production` environment.
4. Release at night (low traffic): the backend restarts and applies migrations, a short interruption.
5. Verify: `cat /opt/udyog-pos/.deploy/CURRENT_TAG` equals the short SHA of the
   commit (`git log --oneline -1 <ref>`), and `docker compose ... ps` shows backend and web healthy.
6. Never build images or edit code on the server; every change goes through GitHub.
