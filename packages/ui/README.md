# mcp-wallet-bridge

**The missing bridge between remote MCP servers and Web3 wallets.**

MCP servers run on your backend. User wallets (MetaMask, Phantom, WalletConnect) live in the browser. This package connects them — without ever touching private keys.

```
Claude → MCP tool → wallet-bridge → Approval URL → User's wallet → Signed tx
```

---

## The Problem

Every existing approach forces a bad tradeoff:

| Approach                             | Problem                                     |
| ------------------------------------ | ------------------------------------------- |
| Private key in env                   | Agent has full unsupervised access to funds |
| Custodial wallet (Coinbase AgentKit) | You own the keys, not the user              |
| `mcp-wallet-signer`                  | stdio only — breaks with remote/HTTP MCP    |
| Phantom MCP server                   | Phantom accounts only                       |

`@kreato-mcp/wallet-bridge` works with **remote MCP over HTTP** (the transport used by claude.ai connectors, Claude Desktop remote servers, and any production deployment) and supports **any wallet** the user already has.

---

## How It Works

1. **MCP tool is called** → bridge creates a pending request in storage, returns an `approvalUrl`
2. **User opens the URL** → sees a clear breakdown of what's being requested
3. **User approves in their wallet** → MetaMask / Phantom popup appears, they confirm
4. **Your frontend calls `bridge.resolve()`** → MCP tool can now confirm the action

No keys ever leave the user's wallet.

---

## Install

```bash
# Core server SDK
npm install @kreato-mcp/wallet-bridge

# React UI component (optional)
npm install @kreato-mcp/wallet-bridge-ui
```

---

## Quick Start

### 1. Initialize the bridge (MCP server)

```ts
import { createWalletBridge } from "@kreato-mcp/wallet-bridge";

export const bridge = createWalletBridge({
  approvalBaseUrl: "https://yourapp.xyz/wallet/approve",
  // storage: new PrismaAdapter(prisma),  // for production
  ttl: 600, // 10 minutes
});
```

### 2. Use it in any MCP tool

```ts
import { bridge, formatBridgeResult } from "@kreato-mcp/wallet-bridge";

// Inside your MCP tool handler:
server.tool("buy_product", async ({ productId, price }, ctx) => {
  const pending = await bridge.requestSignature({
    sessionId: ctx.user.id,
    transaction: {
      type: "transfer",
      chain: "base",
      to: "0xRecipient...",
      value: price,
      metadata: { productId, action: "buy_product" },
    },
  });

  return formatBridgeResult(pending);
  // Claude returns: "Please approve this transaction at: https://yourapp.xyz/wallet/approve/abc123"
});
```

### 3. Add the approval page (Next.js)

```tsx
// app/wallet/approve/[id]/page.tsx
"use client";
import { WalletApproval } from "@kreato-mcp/wallet-bridge-ui";
import { useSendTransaction } from "wagmi";

export default function ApprovePage({ params }: { params: { id: string } }) {
  return (
    <WalletApproval
      requestId={params.id}
      appName="Your App"
      fetchRequest={async (id) => {
        const res = await fetch(`/api/wallet-bridge/requests/${id}`);
        return res.json();
      }}
      onApprove={async (request) => {
        // Sign with wagmi / viem / @solana/web3.js
        const hash = await sendTransaction({ ... });

        // Tell the bridge
        await fetch(`/api/wallet-bridge/resolve/${request.id}`, {
          method: "POST",
          body: JSON.stringify({ txHash: hash, signerAddress: address }),
        });
        return { txHash: hash, signerAddress: address };
      }}
      onReject={async (request) => {
        await fetch(`/api/wallet-bridge/reject/${request.id}`, { method: "POST" });
      }}
    />
  );
}
```

### 4. Add 3 API routes

```ts
// GET  /api/wallet-bridge/requests/[id]  → bridge.getRequest(id)
// POST /api/wallet-bridge/resolve/[id]   → bridge.resolve(id, result)
// POST /api/wallet-bridge/reject/[id]    → bridge.reject(id, reason)
```

See `docs/examples/nextjs-api-routes.ts` for the full implementation.

---

## Storage Adapters

### In-Memory (default)

Zero config. Good for development and single-process deployments.

```ts
const bridge = createWalletBridge({ approvalBaseUrl: "..." });
```

### Prisma (production)

```ts
import { PrismaAdapter } from "@kreato-mcp/wallet-bridge/adapters/prisma";
import { prisma } from "./lib/prisma";

const bridge = createWalletBridge({
  approvalBaseUrl: "...",
  storage: new PrismaAdapter(prisma),
});
```

Add to your `schema.prisma`:

```prisma
model McpWalletRequest {
  id          String    @id @default(cuid())
  sessionId   String
  transaction Json
  status      String    @default("pending")
  approvalUrl String
  createdAt   DateTime  @default(now())
  expiresAt   DateTime
  resolvedAt  DateTime?
  result      Json?
  error       String?

  @@index([sessionId])
  @@index([status, expiresAt])
}
```

### Custom Adapter

Implement the `StorageAdapter` interface to use any database:

```ts
import { StorageAdapter, PendingRequest } from "@kreato-mcp/wallet-bridge";

class MyAdapter implements StorageAdapter {
  async create(req) { ... }
  async findById(id) { ... }
  async findBySession(sessionId) { ... }
  async update(id, patch) { ... }
  async delete(id) { ... }
  async cleanup(olderThan?) { ... }
}
```

---

## Supported Chains

| Chain         | ID              | Family |
| ------------- | --------------- | ------ |
| Ethereum      | `ethereum`      | EVM    |
| Base          | `base`          | EVM    |
| Base Sepolia  | `base-sepolia`  | EVM    |
| Polygon       | `polygon`       | EVM    |
| Arbitrum      | `arbitrum`      | EVM    |
| Optimism      | `optimism`      | EVM    |
| Solana        | `solana`        | Solana |
| Solana Devnet | `solana-devnet` | Solana |

Custom chains: pass any string as `chain` in your transaction — the bridge stores it and passes it through to the approval UI.

---

## Transaction Types

```ts
// Native token transfer
{ type: "transfer", chain: "base", to: "0x...", value: "0.01" }

// ERC-20 / SPL token
{ type: "token_transfer", chain: "base", to: "0x...", tokenAddress: "0x...", amount: "100" }

// Contract interaction
{ type: "contract_call", chain: "base", to: "0x...", abi: [...], functionName: "mint", args: [] }

// Message signing (no on-chain tx)
{ type: "sign_message", chain: "ethereum", message: "Sign in to YourApp" }

// EIP-712 typed data
{ type: "sign_typed", chain: "ethereum", domain: {...}, types: {...}, value: {...} }
```

---

## Bridge API

```ts
// Create a pending request
bridge.requestSignature({ sessionId, transaction, ttl? })
  → { requestId, approvalUrl, expiresAt, status: "pending" }

// Get current status
bridge.getRequest(requestId)
  → PendingRequest | null

// Wait for resolution (long-polling)
bridge.waitForApproval(requestId, { pollInterval?, timeout? })
  → PendingRequest

// Resolve (called by your frontend after signing)
bridge.resolve(requestId, { txHash?, signature?, signerAddress })
  → PendingRequest

// Reject
bridge.reject(requestId, reason?)
  → PendingRequest

// List pending requests for a session
bridge.listPending(sessionId)
  → PendingRequest[]

// Clean up expired requests
bridge.cleanup()
  → number (count cleaned)
```

---

## React Hooks

```ts
import {
  useWalletBridgeRequest,
  useBridgeApproval,
} from "@kreato-mcp/wallet-bridge-ui";

// Fetch + poll a request
const { request, loading, error, refetch } = useWalletBridgeRequest({
  endpoint: "/api/wallet-bridge/requests",
  requestId,
});

// Handle approve/reject actions
const { approve, reject, approving, phase } = useBridgeApproval({
  resolveEndpoint: "/api/wallet-bridge/resolve",
  rejectEndpoint: "/api/wallet-bridge/reject",
});
```

---

## Apps Using This

- [Kreato](https://kreato.space) — Web3 creator monetization platform

Add yours via PR.

---

## Roadmap

- [ ] Redis adapter
- [ ] WebSocket push (instead of polling)
- [ ] WalletConnect v3 deep-link support
- [ ] Transaction simulation preview (via Tenderly / Alchemy)
- [ ] Session key support (pre-authorized, scoped spending)
- [ ] React Native / mobile approval UI

---

## License

MIT
