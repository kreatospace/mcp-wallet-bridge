import { randomUUID } from "crypto";
import { MemoryAdapter } from "./store/memory.js";
import type {
  BridgeToolResult,
  PendingRequest,
  PendingResult,
  RequestSignatureOptions,
  StorageAdapter,
  WalletBridge,
  WalletBridgeConfig,
} from "./types/index.js";

const DEFAULT_TTL = 600; // 10 minutes
const DEFAULT_POLL_INTERVAL = 2000; // 2 seconds
const DEFAULT_WAIT_TIMEOUT = 300_000; // 5 minutes

/**
 * createWalletBridge
 *
 * Factory function — the primary entry point for MCP server authors.
 *
 * @example
 * ```ts
 * import { createWalletBridge } from "@mcp-web3/wallet-bridge";
 *
 * const bridge = createWalletBridge({
 *   approvalBaseUrl: "https://myapp.xyz/wallet/approve",
 * });
 *
 * // Inside an MCP tool handler:
 * const req = await bridge.requestSignature({
 *   sessionId: ctx.user.id,
 *   transaction: {
 *     type: "transfer",
 *     chain: "base",
 *     to: "0xRecipient...",
 *     value: "0.01",
 *   },
 * });
 *
 * return {
 *   status: "pending_approval",
 *   approvalUrl: req.approvalUrl,
 *   requestId: req.requestId,
 * };
 * ```
 */
export function createWalletBridge(config: WalletBridgeConfig): WalletBridge {
  const storage: StorageAdapter = config.storage ?? new MemoryAdapter();
  const ttl = config.ttl ?? DEFAULT_TTL;

  // ── Internal helpers ────────────────────────────────────────────────────────

  function buildApprovalUrl(requestId: string): string {
    const base = config.approvalBaseUrl.replace(/\/$/, "");
    return `${base}/${requestId}`;
  }

  async function markExpiredIfNeeded(req: PendingRequest): Promise<PendingRequest> {
    if (req.status === "pending" && req.expiresAt <= new Date()) {
      const expired = await storage.update(req.id, { status: "expired" });
      config.onExpired?.(expired);
      config.onResolved?.(expired);
      return expired;
    }
    return req;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  const bridge: WalletBridge = {
    async requestSignature(options: RequestSignatureOptions) {
      const requestTtl = options.ttl ?? ttl;
      const now = new Date();
      const expiresAt = new Date(now.getTime() + requestTtl * 1000);
      const tempId = randomUUID(); // used to build the URL before DB insert
      const approvalUrl = buildApprovalUrl(tempId);

      const record = await storage.create({
        sessionId: options.sessionId,
        transaction: options.transaction,
        status: "pending",
        approvalUrl,
        createdAt: now,
        expiresAt,
      });

      // If storage generated its own id (e.g. cuid), rebuild the URL with it
      const finalUrl =
        record.id === tempId ? approvalUrl : buildApprovalUrl(record.id);

      if (record.id !== tempId) {
        await storage.update(record.id, { approvalUrl: finalUrl });
      }

      return {
        requestId: record.id,
        approvalUrl: finalUrl,
        expiresAt,
        status: "pending" as const,
      };
    },

    async getRequest(requestId: string) {
      const req = await storage.findById(requestId);
      if (!req) return null;
      return markExpiredIfNeeded(req);
    },

    async waitForApproval(requestId, options = {}) {
      const pollInterval = options.pollInterval ?? DEFAULT_POLL_INTERVAL;
      const timeout = options.timeout ?? DEFAULT_WAIT_TIMEOUT;
      const deadline = Date.now() + timeout;

      while (Date.now() < deadline) {
        const req = await bridge.getRequest(requestId);
        if (!req) throw new Error(`Request ${requestId} not found`);
        if (req.status !== "pending") return req;
        await new Promise((r) => setTimeout(r, pollInterval));
      }

      throw new Error(`Timed out waiting for approval of request ${requestId}`);
    },

    async resolve(requestId: string, result: PendingResult) {
      const req = await storage.findById(requestId);
      if (!req) throw new Error(`Request ${requestId} not found`);
      if (req.status !== "pending") {
        throw new Error(`Request ${requestId} is already ${req.status}`);
      }

      const isSigning =
        req.transaction.type === "sign_message" ||
        req.transaction.type === "sign_typed";

      const resolved = await storage.update(requestId, {
        status: isSigning ? "signed" : "broadcast",
        resolvedAt: new Date(),
        result,
      });

      config.onResolved?.(resolved);
      return resolved;
    },

    async reject(requestId: string, reason?: string) {
      const req = await storage.findById(requestId);
      if (!req) throw new Error(`Request ${requestId} not found`);
      if (req.status !== "pending") {
        throw new Error(`Request ${requestId} is already ${req.status}`);
      }

      const rejected = await storage.update(requestId, {
        status: "rejected",
        resolvedAt: new Date(),
        error: reason ?? "User rejected",
      });

      config.onResolved?.(rejected);
      return rejected;
    },

    async listPending(sessionId: string) {
      const requests = await storage.findBySession(sessionId);
      const now = new Date();
      return requests.filter(
        (r) => r.status === "pending" && r.expiresAt > now
      );
    },

    async cleanup() {
      return storage.cleanup();
    },
  };

  return bridge;
}

// ── MCP Tool Helper ───────────────────────────────────────────────────────────

/**
 * formatBridgeResult
 *
 * Converts a PendingRequest into a clean, serializable object
 * to return directly from an MCP tool handler.
 */
export function formatBridgeResult(req: {
  requestId: string;
  approvalUrl: string;
  expiresAt: Date;
  status: "pending";
}): BridgeToolResult {
  return {
    status: "pending_approval",
    requestId: req.requestId,
    approvalUrl: req.approvalUrl,
    expiresAt: req.expiresAt.toISOString(),
    message: `Please approve this transaction at: ${req.approvalUrl}`,
  };
}

export { MemoryAdapter } from "./store/memory.js";
export { PrismaAdapter } from "./store/prisma.js";
export * from "./chains/index.js";
export * from "./types/index.js";
export {
  handleTransaction,
  handleEvmTransaction,
  handleSolanaTransaction,
} from "./signers/index.js";
export type {
  MultiChainSignerOptions,
  EvmSignerOptions,
  SolanaSignerOptions,
} from "./signers/index.js";
