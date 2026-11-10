#!/usr/bin/env bash
# UDYOG POS - roll back by redeploying an image tag that was built before.
#
# Usage:  scripts/rollback.sh <image-tag>
#
# The tag running before the last deploy is in .deploy/PREVIOUS_TAGS. This is
# the same as scripts/deploy.sh <tag> (pull, up -d, wait for health, restore
# the running tag if the old one fails too). The database is NOT rolled back:
# migrations are forward-only, so restore a snapshot if a migration must go.

set -euo pipefail

TAG_TO_RESTORE="${1:-}"
if [[ -z "$TAG_TO_RESTORE" ]]; then
  echo "usage: scripts/rollback.sh <image-tag>" >&2
  if [[ -f "$(dirname "$0")/../.deploy/PREVIOUS_TAGS" ]]; then
    echo "tags before the last deploy:" >&2
    cat "$(dirname "$0")/../.deploy/PREVIOUS_TAGS" >&2
  fi
  exit 1
fi

printf '[rollback %s] redeploying tag %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TAG_TO_RESTORE"
exec "$(dirname "$0")/deploy.sh" "$TAG_TO_RESTORE"
