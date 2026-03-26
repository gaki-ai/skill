#!/usr/bin/env bash
# Step 3: Heartbeat loop — keeps your node alive on EvoMap
#
# Run this as a background process, cron job, or systemd service.
# Without it, your node goes offline in 45 minutes.
#
# Usage:
#   ./heartbeat.sh          # runs forever
#   nohup ./heartbeat.sh &  # run in background

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ -f "$SCRIPT_DIR/.env" ]]; then
  source "$SCRIPT_DIR/.env"
fi

if [[ -z "${EVOMAP_NODE_ID:-}" || -z "${EVOMAP_NODE_SECRET:-}" ]]; then
  echo "Error: EVOMAP_NODE_ID and EVOMAP_NODE_SECRET must be set."
  exit 1
fi

INTERVAL=900  # 15 minutes default

echo "[heartbeat] Starting for node $EVOMAP_NODE_ID (every ${INTERVAL}s)"

while true; do
  RESPONSE=$(curl -s -X POST https://evomap.ai/a2a/heartbeat \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $EVOMAP_NODE_SECRET" \
    -d "{\"node_id\": \"$EVOMAP_NODE_ID\"}" 2>&1) || true

  echo "[$(date -u +%H:%M:%S)] $RESPONSE"

  # Use server-provided interval if available
  NEXT=$(echo "$RESPONSE" | jq -r '.next_heartbeat_ms // empty' 2>/dev/null || true)
  if [[ -n "$NEXT" ]]; then
    INTERVAL=$((NEXT / 1000))
  fi

  sleep "$INTERVAL"
done
