#!/usr/bin/env bash
# Step 2: Publish gaki-ai skill as a Gene+Capsule bundle to EvoMap
#
# Requires: EVOMAP_NODE_ID and EVOMAP_NODE_SECRET in .env or environment

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# Load .env if present
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  source "$SCRIPT_DIR/.env"
fi

if [[ -z "${EVOMAP_NODE_ID:-}" || -z "${EVOMAP_NODE_SECRET:-}" ]]; then
  echo "Error: EVOMAP_NODE_ID and EVOMAP_NODE_SECRET must be set."
  echo "Run ./register.sh first and save the values to .env"
  exit 1
fi

MSG_ID="msg_$(date +%s)_$(openssl rand -hex 4)"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# ── Build the Gene (reusable strategy) ──
read -r -d '' GENE_JSON <<'GENE' || true
{
  "type": "Gene",
  "schema_version": "1.5.0",
  "category": "innovate",
  "signals_match": [
    "llm-inference-marketplace",
    "onchain-api-access",
    "permissionless-ai-market",
    "mcp-tool-server",
    "agent-to-agent-commerce"
  ],
  "summary": "Gaki Marketplace MCP Server — permissionless on-chain marketplace for buying and selling LLM inference access (USDC). 15 MCP tools for browsing, buying, selling, rating, and trust-building via staking. Zero fees, stateless, EIP-191 signed.",
  "strategy": "Deploy an MCP server that exposes a permissionless AI inference marketplace. Buyers browse models, pay USDC on-chain (Base/BSC), and receive API keys instantly. Sellers register on-chain, stake USDC for trust ranking, list models with EIP-191 signatures, and earn 100% of revenue. Ratings (1-5, weighted by spend) build reputation. No API keys, no sessions, no middleman.",
  "constraints": [
    "Requires Node.js runtime",
    "Network access to api.gaki.ai",
    "On-chain transactions require wallet with USDC on Base or BSC",
    "Seller operations require EIP-191 signature capability",
    "Ratings available 24h-14d after purchase only"
  ],
  "validation": [
    "npm run build",
    "node dist/index.js --help"
  ],
  "tags": [
    "ai", "agent", "mcp", "marketplace", "llm", "inference", "api",
    "token", "permissionless", "zero-fee", "onchain", "usdc", "crypto",
    "web3", "base", "bsc", "eip-191", "stateless", "trust", "reputation",
    "rating", "stake", "p2p", "decentralized", "peer-to-peer",
    "seller", "buyer", "model-access", "pay-per-use"
  ]
}
GENE

# ── Build the Capsule (validated implementation) ──
SKILL_CONTENT=$(cat "$SCRIPT_DIR/../skills/gaki-ai/SKILL.md")
CAPSULE_CONTENT=$(cat <<EOF
Intent: Provide a permissionless MCP server for on-chain LLM inference marketplace

Strategy:
1. 15 MCP tools organized by auth level (public, chain-proven, EIP-191 signed)
2. Two-step 402 buy flow: get payment instructions → pay on-chain → receive API key
3. Seller registration with optional USDC staking for trust ranking
4. Spend-weighted rating system (1-5) for reputation building
5. Stateless architecture — no sessions, no API keys, all identity chain-proven or signed

Key features:
- Browse/search/recommend models (no auth)
- Buy API access with on-chain USDC payment (Base, BSC)
- Register as seller, stake USDC for trust ranking
- List/update/delete model offerings (EIP-191 signed)
- Rate purchases (EIP-191 signed, weighted by spend)
- Zero protocol fee — sellers keep 100%
- 30-day timelock on stake withdrawal (anti-scam)

Outcome score: 0.90
EOF
)

read -r -d '' CAPSULE_JSON <<CAPSULE || true
{
  "type": "Capsule",
  "schema_version": "1.5.0",
  "trigger": [
    "llm-inference-marketplace",
    "onchain-api-access",
    "permissionless-ai-market",
    "mcp-tool-server",
    "agent-to-agent-commerce"
  ],
  "gene": "GENE_HASH_PLACEHOLDER",
  "summary": "Gaki Marketplace MCP Server — 15 tools for permissionless on-chain LLM inference trading. Buy/sell API access with USDC on Base/BSC. Trust via staking, reputation via spend-weighted ratings.",
  "content": $(echo "$CAPSULE_CONTENT" | jq -Rs .),
  "confidence": 0.90,
  "blast_radius": { "files": 4, "lines": 450 },
  "outcome": { "status": "success", "score": 0.90 },
  "env_fingerprint": { "platform": "linux", "arch": "x64" }
}
CAPSULE

# ── Compute asset_id hashes ──
# asset_id = sha256(canonical_json(asset_without_asset_id))
# Canonical JSON = sorted keys at every level

GENE_HASH="sha256:$(echo "$GENE_JSON" | jq -cS '.' | sha256sum | awk '{print $1}')"
echo "Gene hash: $GENE_HASH"

# Replace gene reference in capsule
CAPSULE_JSON=$(echo "$CAPSULE_JSON" | sed "s|GENE_HASH_PLACEHOLDER|$GENE_HASH|")
CAPSULE_HASH="sha256:$(echo "$CAPSULE_JSON" | jq -cS '.' | sha256sum | awk '{print $1}')"
echo "Capsule hash: $CAPSULE_HASH"

# Add asset_ids
GENE_WITH_ID=$(echo "$GENE_JSON" | jq --arg id "$GENE_HASH" '. + {asset_id: $id}')
CAPSULE_WITH_ID=$(echo "$CAPSULE_JSON" | jq --arg id "$CAPSULE_HASH" '. + {asset_id: $id}')

# ── Build EvolutionEvent ──
read -r -d '' EVENT_JSON <<EVENT || true
{
  "type": "EvolutionEvent",
  "intent": "innovate",
  "capsule_id": "$CAPSULE_HASH",
  "genes_used": ["$GENE_HASH"],
  "outcome": { "status": "success", "score": 0.90 },
  "mutations_tried": 1,
  "total_cycles": 1
}
EVENT

EVENT_HASH="sha256:$(echo "$EVENT_JSON" | jq -cS '.' | sha256sum | awk '{print $1}')"
echo "Event hash: $EVENT_HASH"
EVENT_WITH_ID=$(echo "$EVENT_JSON" | jq --arg id "$EVENT_HASH" '. + {asset_id: $id}')

# ── Validate first ──
echo ""
echo "Validating bundle..."

VALIDATE_PAYLOAD=$(jq -n \
  --arg msg_id "$MSG_ID" \
  --arg sender "$EVOMAP_NODE_ID" \
  --arg ts "$TIMESTAMP" \
  --argjson gene "$GENE_WITH_ID" \
  --argjson capsule "$CAPSULE_WITH_ID" \
  --argjson event "$EVENT_WITH_ID" \
  '{
    protocol: "gep-a2a",
    protocol_version: "1.0.0",
    message_type: "validate",
    message_id: $msg_id,
    sender_id: $sender,
    timestamp: $ts,
    payload: { assets: [$gene, $capsule, $event] }
  }')

VALIDATE_RESULT=$(curl -s -X POST https://evomap.ai/a2a/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $EVOMAP_NODE_SECRET" \
  -d "$VALIDATE_PAYLOAD")

echo "$VALIDATE_RESULT" | jq .

# Check if validation passed
if echo "$VALIDATE_RESULT" | jq -e '.payload.valid == true' > /dev/null 2>&1; then
  echo ""
  echo "Validation passed. Publishing..."
else
  echo ""
  echo "Validation failed. Check errors above and fix before publishing."
  exit 1
fi

# ── Publish ──
MSG_ID2="msg_$(date +%s)_$(openssl rand -hex 4)"
TIMESTAMP2=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

PUBLISH_PAYLOAD=$(jq -n \
  --arg msg_id "$MSG_ID2" \
  --arg sender "$EVOMAP_NODE_ID" \
  --arg ts "$TIMESTAMP2" \
  --argjson gene "$GENE_WITH_ID" \
  --argjson capsule "$CAPSULE_WITH_ID" \
  --argjson event "$EVENT_WITH_ID" \
  '{
    protocol: "gep-a2a",
    protocol_version: "1.0.0",
    message_type: "publish",
    message_id: $msg_id,
    sender_id: $sender,
    timestamp: $ts,
    payload: { assets: [$gene, $capsule, $event] }
  }')

curl -s -X POST https://evomap.ai/a2a/publish \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $EVOMAP_NODE_SECRET" \
  -d "$PUBLISH_PAYLOAD" | jq .

echo ""
echo "Done! Your skill is now a candidate on EvoMap."
echo "Check status: GET https://evomap.ai/a2a/assets?status=candidate"
