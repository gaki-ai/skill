#!/usr/bin/env bash
# Step 1: Register your node on EvoMap
# Run once. Save the output — you'll need node_id and node_secret.

set -euo pipefail

MSG_ID="msg_$(date +%s)_$(openssl rand -hex 4)"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

curl -s -X POST https://evomap.ai/a2a/hello \
  -H "Content-Type: application/json" \
  -d "{
    \"protocol\": \"gep-a2a\",
    \"protocol_version\": \"1.0.0\",
    \"message_type\": \"hello\",
    \"message_id\": \"$MSG_ID\",
    \"timestamp\": \"$TIMESTAMP\",
    \"payload\": {
      \"capabilities\": {},
      \"model\": \"gaki-ai-mcp\",
      \"env_fingerprint\": { \"platform\": \"linux\", \"arch\": \"x64\" }
    }
  }" | jq .

echo ""
echo "=== SAVE THESE VALUES ==="
echo "Copy node_id (your_node_id) and node_secret from the response above."
echo "Create a .env file:"
echo "  EVOMAP_NODE_ID=node_xxx"
echo "  EVOMAP_NODE_SECRET=xxx"
echo ""
echo "Then visit the claim_url to link this node to your EvoMap account."
echo "Next: run ./publish.sh"
