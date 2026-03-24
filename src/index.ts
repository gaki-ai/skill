#!/usr/bin/env node
/**
 * Gaki Marketplace MCP Server — stateless.
 *
 * All browse/search endpoints are public. Buy is two-step (no auth).
 * Seller writes + rate require pre-signed EIP-191 signatures (agent signs locally).
 *
 * Env vars:
 *   GAKI_GATEWAY_URL  — Gateway URL (default: https://api.gaki.ai)
 *   GAKI_ADDRESS      — Wallet address for personalized queries (optional)
 *   GAKI_CHAIN        — Default chain name: "base" or "bsc" (default: "base")
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { GakiClient } from "./client.js";

// ── Config ──

const gatewayUrl =
  process.env.GAKI_GATEWAY_URL ?? "https://api.gaki.ai";
const defaultAddress = process.env.GAKI_ADDRESS;
const defaultChain = process.env.GAKI_CHAIN ?? "base";

const client = new GakiClient({ gatewayUrl });

// ── Helpers ──

function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

function json(data: any) {
  return text(JSON.stringify(data, null, 2));
}

// ── Server ──

const server = new McpServer({
  name: "gaki-marketplace",
  version: "0.2.0",
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PUBLIC — browse, search, recommend
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.tool(
  "gaki_browse",
  "Browse and search AI model offerings. No API key needed.",
  {
    model: z.string().optional().describe("Filter by model name (e.g. 'gpt-4o')"),
    format: z.enum(["openai", "anthropic"]).optional().describe("Filter by API format"),
    max_price_input: z.number().optional().describe("Max price per million input tokens (USDC, 6 decimals)"),
    sort: z.enum(["price", "trust", "rating", "relevance"]).optional().describe("Sort order"),
    query: z.string().optional().describe("Free-text search"),
  },
  async (params) => {
    const qs = new URLSearchParams();
    if (params.model) qs.set("model", params.model);
    if (params.format) qs.set("format", params.format);
    if (params.max_price_input) qs.set("max_price_input", params.max_price_input.toString());
    if (params.sort) qs.set("sort", params.sort);
    if (params.query) qs.set("q", params.query);

    const path =
      params.model && !params.query && !params.sort
        ? `/v1/models/${encodeURIComponent(params.model)}`
        : `/v1/models/search?${qs}`;

    const res = await client.get(path);
    return json(res.body);
  }
);

server.tool(
  "gaki_recommend",
  "Auto-pick the best seller for a model. No API key needed.",
  {
    model: z.string().describe("Model name (e.g. 'gpt-4o')"),
    format: z.enum(["openai", "anthropic"]).optional().describe("API format preference"),
  },
  async (params) => {
    const qs = new URLSearchParams({ model: params.model });
    if (params.format) qs.set("format", params.format);
    const res = await client.get(`/v1/models/recommend?${qs}`);
    return json(res.body);
  }
);

server.tool(
  "gaki_chains",
  "List supported chains with contract addresses.",
  {},
  async () => {
    const res = await client.get("/v1/chains");
    return json(res.body);
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BUY — two-step 402 flow (stateless, no auth)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.tool(
  "gaki_buy",
  `Purchase API access. Two-step 402 flow:
  - Without txHash: returns payment instructions.
  - With txHash: verifies payment on-chain, returns API key.`,
  {
    seller: z.string().describe("Seller address (0x...)"),
    model: z.string().describe("Model name"),
    chain: z.string().optional().describe("Chain name (use gaki_chains to list supported chains). Default: GAKI_CHAIN or \"base\""),
    address: z.string().optional().describe("Your address for personalized hints (pendingRatings, existingAccess)"),
    txHash: z.string().optional().describe("Tx hash after on-chain payment. Omit for step 1."),
  },
  async (params) => {
    const body: any = {
      seller: params.seller,
      model: params.model,
      chain: params.chain ?? defaultChain,
    };
    if (params.address) body.address = params.address;
    if (params.txHash) body.txHash = params.txHash;

    const res = await client.post("/v1/buy", body);

    if (res.status === 422) {
      return text(`Cannot buy: ${res.body.error?.message ?? "Seller not registered on-chain. The seller must call gaki_register first."}`);
    }

    if (res.status === 402) {
      const p = res.body.payment;
      const humanAmount = (Number(p.amount) / 1e6).toFixed(6);
      let msg =
        `Payment required.\n\n` +
        `Pay ${humanAmount} USDC (raw: ${p.amount}) to ${p.seller}\n` +
        `Chain: ${p.chainId} | Contract: ${p.contract}\n` +
        `Method: pay(address,uint256) — pass raw amount ${p.amount} as uint256\n`;
      if (res.body.existingAccess) {
        const ea = res.body.existingAccess;
        msg += `\nExisting access: ${ea.status} (expires: ${ea.expiresAt ?? "never"})\n`;
      }
      if (res.body.pendingRatings > 0) {
        msg += `\n${res.body.pendingRatings} unrated purchase(s).\n`;
      }
      msg += `\nCall gaki_buy again with txHash after paying.`;
      return text(msg);
    }

    if (res.status === 200) {
      const a = res.body.access;
      return text(
        `Purchase complete!\n\n` +
        `Purchase ID: ${res.body.purchase.id}\n` +
        `API Key: ${a.apiKey}\n` +
        `Endpoint: ${a.endpoint}\n` +
        `Model: ${a.model} (${a.format})\n` +
        `Expires: ${a.expiresAt ?? "perpetual"}`
      );
    }

    return text(`Error (${res.status}): ${JSON.stringify(res.body)}`);
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// PUBLIC READS — purchases, seller models, seller stats, balance
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.tool(
  "gaki_purchases",
  "View purchase history with access status.",
  {
    address: z.string().optional().describe("Buyer address (default: GAKI_ADDRESS)"),
    limit: z.number().optional(),
  },
  async (params) => {
    const addr = params.address ?? defaultAddress;
    if (!addr) return text("Error: address required. Set GAKI_ADDRESS or pass address param.");
    const qs = new URLSearchParams({ address: addr });
    if (params.limit) qs.set("limit", params.limit.toString());
    const res = await client.get(`/v1/purchases?${qs}`);
    return json(res.body);
  }
);

server.tool(
  "gaki_seller_models",
  "List a seller's model offerings.",
  {
    address: z.string().optional().describe("Seller address (default: GAKI_ADDRESS)"),
  },
  async (params) => {
    const addr = params.address ?? defaultAddress;
    if (!addr) return text("Error: address required. Set GAKI_ADDRESS or pass address param.");
    const res = await client.get(`/v1/models?seller=${addr}`);
    return json(res.body);
  }
);

server.tool(
  "gaki_seller_stats",
  "View seller sales stats and ratings.",
  {
    address: z.string().optional().describe("Seller address (default: GAKI_ADDRESS)"),
  },
  async (params) => {
    const addr = params.address ?? defaultAddress;
    if (!addr) return text("Error: address required. Set GAKI_ADDRESS or pass address param.");
    const res = await client.get(`/v1/seller/stats?address=${addr}`);
    return json(res.body);
  }
);

server.tool(
  "gaki_balance",
  "Check on-chain balance (stake + registration).",
  {
    address: z.string().optional().describe("Address (default: GAKI_ADDRESS)"),
    chain: z.string().optional().describe("Chain name (use gaki_chains to list supported chains). Default: GAKI_CHAIN or \"base\""),
  },
  async (params) => {
    const addr = params.address ?? defaultAddress;
    if (!addr) return text("Error: address required. Set GAKI_ADDRESS or pass address param.");
    const chain = params.chain ?? defaultChain;
    const res = await client.get(`/v1/seller/balance?address=${addr}&chain=${chain}`);
    return json(res.body);
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// REGISTER — on-chain seller registration (must do before selling)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.tool(
  "gaki_register",
  `Register as a seller on-chain. MUST be done before listing models with gaki_sell.
  Returns unsigned transaction(s) for the agent to sign and submit.
  Stake is optional (0 is OK) but higher stake = higher trust ranking.
  Stake has a 30-day timelock for withdrawal.`,
  {
    chain: z.string().optional().describe("Chain to register on. Default: GAKI_CHAIN or \"base\""),
    amount: z.string().optional().describe("USDC stake amount in raw units (6 decimals). 0 = no stake. Default: 0"),
    address: z.string().optional().describe("Your wallet address to check status (default: GAKI_ADDRESS)"),
  },
  async (params) => {
    const chain = params.chain ?? defaultChain;
    const addr = params.address ?? defaultAddress;

    // Check if already registered
    if (addr) {
      const balRes = await client.get(`/v1/seller/balance?address=${addr}&chain=${chain}`);
      if (balRes.status === 200 && balRes.body.active) {
        return text(
          `Already registered on ${chain}.\n\n` +
          `Stake: ${balRes.body.stake} USDC (raw)\n` +
          `Registered at: ${new Date(balRes.body.registeredAt * 1000).toISOString()}\n\n` +
          `You can now list models with gaki_sell.`
        );
      }
    }

    // Get unsigned register tx
    const res = await client.post("/v1/seller/tx/register", {
      amount: params.amount ?? "0",
      chain,
    });

    if (res.status !== 200) {
      return text(`Error (${res.status}): ${JSON.stringify(res.body)}`);
    }

    const txs = res.body.transactions;
    let msg = `Register on ${chain} — sign and submit these transaction(s):\n\n`;
    for (const tx of txs) {
      msg += `Step ${tx.step}: ${tx.description}\n`;
      msg += `  to: ${tx.to}\n`;
      msg += `  data: ${tx.data}\n`;
      msg += `  chainId: ${tx.chainId}\n\n`;
    }
    msg += `After submitting, you can list models with gaki_sell.`;
    return text(msg);
  }
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WRITE OPS — agent signs locally, passes signature here
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

server.tool(
  "gaki_sell",
  `Register a model offering. Requires EIP-191 signature.
  Sign message: "gaki:seller:register:<model>:<format>:<timestamp>"`,
  {
    model: z.string().describe("Model name (e.g. 'gpt-4o')"),
    endpoint: z.string().describe("Your API endpoint URL"),
    format: z.enum(["openai", "anthropic"]).describe("API format"),
    callbackUrl: z.string().optional().describe("Callback URL for purchase notifications"),
    chains: z.array(z.string()).optional().describe("Chains to accept payment on (e.g. ['base','bsc']). Default: all supported."),
    pricePerMillionInput: z.number().optional().describe("Price per million input tokens (USDC, 6 decimals)"),
    pricePerMillionOutput: z.number().optional().describe("Price per million output tokens (USDC, 6 decimals)"),
    description: z.string().optional().describe("Model description"),
    address: z.string().describe("Your wallet address (0x...)"),
    signature: z.string().describe("EIP-191 signature of 'gaki:seller:register:<model>:<format>:<timestamp>'"),
    timestamp: z.number().describe("Unix timestamp used in signature"),
  },
  async (params) => {
    // Gate: check on-chain registration first
    const chain = params.chains?.[0] ?? defaultChain;
    const balRes = await client.get(`/v1/seller/balance?address=${params.address}&chain=${chain}`);
    if (balRes.status === 200 && !balRes.body.active) {
      return text(
        `Cannot list model: you are not registered on-chain.\n\n` +
        `Use gaki_register first to register on ${chain}, then try gaki_sell again.`
      );
    }

    const res = await client.post("/v1/models", params);
    if (res.status === 201) {
      return text(`Model ${params.model} registered successfully.\n\n${JSON.stringify(res.body, null, 2)}`);
    }
    if (res.status === 422 && res.body.error?.code === "seller_not_registered") {
      return text(
        `Cannot list model: you are not registered on-chain.\n\n` +
        `Use gaki_register first, then try gaki_sell again.\n\n` +
        `Details: ${res.body.error.message}`
      );
    }
    return text(`Error (${res.status}): ${JSON.stringify(res.body)}`);
  }
);

server.tool(
  "gaki_sell_update",
  `Update a model offering. Requires EIP-191 signature.
  Sign message: "gaki:seller:update:<model>:<timestamp>"`,
  {
    model: z.string().describe("Model name to update"),
    endpoint: z.string().optional().describe("New API endpoint URL"),
    callbackUrl: z.string().optional().describe("New callback URL"),
    chains: z.array(z.string()).optional().describe("New accepted chains (e.g. ['base'])"),
    pricePerMillionInput: z.number().optional().describe("New input price"),
    pricePerMillionOutput: z.number().optional().describe("New output price"),
    description: z.string().optional().describe("New description"),
    active: z.boolean().optional().describe("Enable/disable the listing"),
    address: z.string().describe("Your wallet address (0x...)"),
    signature: z.string().describe("EIP-191 signature of 'gaki:seller:update:<model>:<timestamp>'"),
    timestamp: z.number().describe("Unix timestamp used in signature"),
  },
  async (params) => {
    const { model, ...body } = params;
    const res = await client.put(`/v1/models/${encodeURIComponent(model)}`, body);
    if (res.status === 200) {
      return text(`Model ${model} updated successfully.`);
    }
    return text(`Error (${res.status}): ${JSON.stringify(res.body)}`);
  }
);

server.tool(
  "gaki_sell_delete",
  `Remove a model offering. Requires EIP-191 signature.
  Sign message: "gaki:seller:delete:<model>:<timestamp>"`,
  {
    model: z.string().describe("Model name to delete"),
    address: z.string().describe("Your wallet address (0x...)"),
    signature: z.string().describe("EIP-191 signature of 'gaki:seller:delete:<model>:<timestamp>'"),
    timestamp: z.number().describe("Unix timestamp used in signature"),
  },
  async (params) => {
    const qs = new URLSearchParams({
      address: params.address,
      signature: params.signature,
      timestamp: params.timestamp.toString(),
    });
    const res = await client.delete(`/v1/models/${encodeURIComponent(params.model)}?${qs}`);
    if (res.status === 200) {
      return text(`Model ${params.model} deleted.`);
    }
    return text(`Error (${res.status}): ${JSON.stringify(res.body)}`);
  }
);

server.tool(
  "gaki_rate",
  `Rate a purchase (1-5). Requires EIP-191 signature.
  Sign message: "gaki:rate:<purchaseId>:<score>:<timestamp>"`,
  {
    purchaseId: z.string().describe("Purchase ID to rate"),
    score: z.number().min(1).max(5).describe("Rating score (1-5)"),
    address: z.string().describe("Your wallet address (0x...)"),
    signature: z.string().describe("EIP-191 signature of 'gaki:rate:<purchaseId>:<score>:<timestamp>'"),
    timestamp: z.number().describe("Unix timestamp used in signature"),
  },
  async (params) => {
    const res = await client.post("/v1/rate", params);
    if (res.status === 200) {
      return text(`Rated purchase ${params.purchaseId} with score ${params.score}.`);
    }
    return text(`Error (${res.status}): ${JSON.stringify(res.body)}`);
  }
);

// ── Start ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[gaki-mcp] Running gateway=${gatewayUrl} address=${defaultAddress ?? "none"} chain=${defaultChain}`
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
