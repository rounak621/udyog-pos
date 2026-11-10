#!/usr/bin/env bash
# UDYOG POS - deploy an image tag ON THIS SERVER (staging or production).
#
# Usage:  scripts/deploy.sh <image-tag>
#
# Run from the deploy folder (the one holding docker-compose.prod.yml,
# Caddyfile, .env.production and scripts/). GitHub Actions calls it over SSH;
# it can also be run by hand.
#
# Steps: remember the running tags -> pull the new images -> `up -d` ->
# wait for backend and web to be healthy (max 120 s). If they do not become
# healthy, the previous tag is started again automatically and the script
# exits non-zero.
#
# Migrations: the backend image runs `prisma migrate deploy` before it starts
# listening (apps/backend/Dockerfile CMD), and its health check only passes
# once the API is up, so the new version takes traffic only after its
# migrations are applied. Migrations are forward-only: a rollback restarts
# the old image on the already-migrated database (keep migrations additive).
#
# Idempotent: deploying the tag that is already running just re-checks health.

set -euo pipefail

NEW_TAG="${1:-}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-120}"

log() { printf '[deploy %s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

[[ -n "$NEW_TAG" ]] || die "usage: scripts/deploy.sh <image-tag>"
[[ "$NEW_TAG" =~ ^[A-Za-z0-9._-]{1,128}$ ]] || die "invalid tag: $NEW_TAG"

cd "$(dirname "$0")/.."
[[ -f docker-compose.prod.yml ]] || die "docker-compose.prod.yml not found in $(pwd)"
[[ -f .env.production ]] || die ".env.production not found in $(pwd) (copy .env.production.example)"

STATE_DIR=".deploy"
mkdir -p "$STATE_DIR"
PREVIOUS_TAGS_FILE="$STATE_DIR/PREVIOUS_TAGS"
CURRENT_TAG_FILE="$STATE_DIR/CURRENT_TAG"

# One deploy at a time on this server.
exec 9>"$STATE_DIR/lock"
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || die "another deploy is running"
fi

compose() {
  docker compose --env-file .env.production -f docker-compose.prod.yml "$@"
}

# Tag part of the image a service's container runs ("" if not running).
running_tag() {
  local cid image
  cid="$(TAG=unused compose ps -q "$1" 2>/dev/null || true)"
  [[ -n "$cid" ]] || { echo ""; return 0; }
  image="$(docker inspect -f '{{.Config.Image}}' "$cid" 2>/dev/null || true)"
  [[ "$image" == *:* ]] && echo "${image##*:}" || echo ""
}

health_of() {
  local cid
  cid="$(TAG="$1" compose ps -q "$2" 2>/dev/null || true)"
  [[ -n "$cid" ]] || { echo "missing"; return 0; }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || echo "missing"
}

wait_healthy() {
  local tag="$1" waited=0 backend web
  while (( waited < HEALTH_TIMEOUT_SECONDS )); do
    backend="$(health_of "$tag" backend)"
    web="$(health_of "$tag" web)"
    log "health: backend=$backend web=$web (${waited}s)"
    if [[ "$backend" == "healthy" && "$web" == "healthy" ]]; then
      return 0
    fi
    sleep 5
    waited=$(( waited + 5 ))
  done
  return 1
}

start_tag() {
  local tag="$1"
  log "pulling images for tag $tag"
  TAG="$tag" compose pull backend web
  log "starting tag $tag"
  TAG="$tag" compose up -d --remove-orphans
}

PREVIOUS_TAG="$(running_tag backend)"
{
  echo "# saved $(date -u +%Y-%m-%dT%H:%M:%SZ) before deploying $NEW_TAG"
  echo "backend=$(running_tag backend)"
  echo "web=$(running_tag web)"
} > "$PREVIOUS_TAGS_FILE"
log "previous tag: ${PREVIOUS_TAG:-<none>} -> new tag: $NEW_TAG (saved in $PREVIOUS_TAGS_FILE)"

if start_tag "$NEW_TAG" && wait_healthy "$NEW_TAG"; then
  echo "$NEW_TAG" > "$CURRENT_TAG_FILE"
  # A changed Caddyfile (bind-mounted) needs a reload; harmless if unchanged.
  TAG="$NEW_TAG" compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile \
    || log "warning: caddy reload failed (check: docker compose logs caddy)"
  TAG="$NEW_TAG" compose ps
  log "OK: running $NEW_TAG"
  exit 0
fi

log "new tag $NEW_TAG did not become healthy"
TAG="$NEW_TAG" compose logs --tail=80 backend web || true

if [[ -n "$PREVIOUS_TAG" && "$PREVIOUS_TAG" != "$NEW_TAG" ]]; then
  log "restoring previous tag $PREVIOUS_TAG"
  if start_tag "$PREVIOUS_TAG" && wait_healthy "$PREVIOUS_TAG"; then
    echo "$PREVIOUS_TAG" > "$CURRENT_TAG_FILE"
    log "restored $PREVIOUS_TAG; deploy of $NEW_TAG FAILED"
  else
    log "previous tag $PREVIOUS_TAG is not healthy either - check the server now"
  fi
else
  log "no previous tag to restore"
fi
exit 1
