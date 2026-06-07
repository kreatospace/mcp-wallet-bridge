/**
 * examples/mcp-server-integration.ts
 *
 * How to integrate @mcp-web3/wallet-bridge into your MCP server.
 * This pattern works for any remote MCP server using HTTP transport.
 *
 * Compatible with: @modelcontextprotocol/sdk, fastmcp, any MCP framework.
 */

import { createWalletBridge, PrismaAdapter, formatBridgeResult } from "@mcp-web3/wallet-bridge";
// If using Prisma — import your own client:
// import { prisma } from "./lib/prisma.js";

// ─── 1. Initialize the bridge (once, at server startup) ───────────────────────

const bridge = createWalletBridge({
  // Where your approval page lives (the page that renders <WalletApproval />)
  approvalBaseUrl: "https://yourapp.xyz/wallet/approve",

  // Use PrismaAdapter for production (multi-process safe)
  // storage: new PrismaAdapter(prisma),

  // Or leave it out for in-memory (development / single-process)

  ttl: 600, // 10 minutes

  onResolved: async (req) => {
    console.log(`Request ${req.id} resolved: ${req.status}`);
    // Send a webhook, emit a socket event, update UI, etc.
  },
});

// ─── 2. Example MCP tool: buy_product ─────────────────────────────────────────

// This shows how any MCP tool returns a pending approval instead of blocking.
// The user gets an approvalUrl to open in their browser.

async function buyProductTool(args: {
  productId: string;
  buyerAddress: string;
  price: string;
  sessionId: string; // from your MCP auth/session
}) {
  const pending = await bridge.requestSignature({
    sessionId: args.sessionId,
    transaction: {
      type: "transfer",
      chain: "base",
      to: "0xYourPlatformWallet", // or the creator's wallet
      value: args.price,
      metadata: {
        action: "buy_product",
        productId: args.productId,
        buyer: args.buyerAddress,
      },
    },
  });

  // Return this directly from your MCP tool handler.
  // Claude will relay the approvalUrl to the user.
  return formatBridgeResult(pending);
  // → { status: "pending_approval", approvalUrl: "...", requestId: "...", expiresAt: "..." }
}

// ─── 3. Example: waiting for approval (optional, for async flows) ─────────────

async function buyProductAndWait(args: {
  productId: string;
  sessionId: string;
  price: string;
}) {
  const pending = await bridge.requestSignature({
    sessionId: args.sessionId,
    transaction: {
      type: "transfer",
      chain: "base",
      to: "0xPlatformWallet",
      value: args.price,
      metadata: { productId: args.productId },
    },
  });

  // For long-polling MCP tools — waits up to 5 minutes for user approval.
  // Only use this if your MCP client supports long-running tool calls.
  const resolved = await bridge.waitForApproval(pending.requestId, {
    pollInterval: 2000,
    timeout: 300_000,
  });

  if (resolved.status === "broadcast" || resolved.status === "confirmed") {
    return { success: true, txHash: resolved.result?.txHash };
  }

  return { success: false, reason: resolved.status };
}

// ─── 4. Backend API routes needed ─────────────────────────────────────────────
//
// Your web backend needs 3 routes to support the bridge:
//
// GET  /api/wallet-bridge/requests/:id  → bridge.getRequest(id)
// POST /api/wallet-bridge/resolve/:id   → bridge.resolve(id, result)
// POST /api/wallet-bridge/reject/:id    → bridge.reject(id, reason)
//
// See examples/nextjs-api-routes.ts for Next.js App Router implementation.

export { bridge, buyProductTool };
