// ─── Chain Support ────────────────────────────────────────────────────────────

export type SupportedChain =
  | "ethereum"
  | "base"
  | "polygon"
  | "arbitrum"
  | "optimism"
  | "solana"
  | string; // extensible for custom chains

export type ChainFamily = "evm" | "solana";

export interface ChainConfig {
  id: SupportedChain;
  family: ChainFamily;
  name: string;
  rpcUrl?: string;
  chainId?: number; // EVM only
  nativeCurrency: {
    symbol: string;
    decimals: number;
  };
}

// ─── Transaction Types ────────────────────────────────────────────────────────

export type TxType =
  | "transfer"       // native token transfer
  | "token_transfer" // ERC-20 / SPL token
  | "contract_call"  // arbitrary contract interaction
  | "sign_message"   // message signing only (no tx)
  | "sign_typed"     // EIP-712 typed data
  | "custom";        // arbitrary payload

export interface BaseTransaction {
  chain: SupportedChain;
  from?: string; // wallet address — filled by bridge if omitted
  metadata?: Record<string, unknown>; // arbitrary context for the approval UI
}

export interface TransferTx extends BaseTransaction {
  type: "transfer";
  to: string;
  value: string; // human-readable amount (e.g. "0.01")
}

export interface TokenTransferTx extends BaseTransaction {
  type: "token_transfer";
  to: string;
  tokenAddress: string;
  amount: string;
  decimals?: number;
}

export interface ContractCallTx extends BaseTransaction {
  type: "contract_call";
  to: string;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
  value?: string;
}

export interface SignMessageTx extends BaseTransaction {
  type: "sign_message";
  message: string;
}

export interface SignTypedTx extends BaseTransaction {
  type: "sign_typed";
  domain: Record<string, unknown>;
  types: Record<string, unknown>;
  value: Record<string, unknown>;
}

export interface CustomTx extends BaseTransaction {
  type: "custom";
  payload: unknown;
}

export type Transaction =
  | TransferTx
  | TokenTransferTx
  | ContractCallTx
  | SignMessageTx
  | SignTypedTx
  | CustomTx;

// ─── Pending Request ──────────────────────────────────────────────────────────

export type PendingStatus =
  | "pending"    // waiting for user to open approval URL
  | "approved"   // user approved, broadcasting
  | "signed"     // signed (for message signing)
  | "broadcast"  // tx submitted to chain
  | "confirmed"  // tx confirmed on-chain
  | "rejected"   // user rejected
  | "expired"    // TTL exceeded
  | "failed";    // error during broadcast

export interface PendingRequest {
  id: string;
  sessionId: string;           // ties to the MCP-authenticated user
  transaction: Transaction;
  status: PendingStatus;
  approvalUrl: string;
  createdAt: Date;
  expiresAt: Date;
  resolvedAt?: Date;
  result?: PendingResult;
  error?: string;
}

export interface PendingResult {
  txHash?: string;      // for on-chain transactions
  signature?: string;   // for message/typed signing
  signerAddress: string;
  confirmedAt?: Date;
}

// ─── Storage Adapter Interface ────────────────────────────────────────────────

export interface StorageAdapter {
  create(request: Omit<PendingRequest, "id">): Promise<PendingRequest>;
  findById(id: string): Promise<PendingRequest | null>;
  findBySession(sessionId: string): Promise<PendingRequest[]>;
  update(id: string, patch: Partial<PendingRequest>): Promise<PendingRequest>;
  delete(id: string): Promise<void>;
  cleanup(olderThan?: Date): Promise<number>; // returns count deleted
}

// ─── Bridge Config ────────────────────────────────────────────────────────────

export interface WalletBridgeConfig {
  /** Base URL of your app where the approval page is hosted */
  approvalBaseUrl: string;

  /** Storage adapter — defaults to in-memory */
  storage?: StorageAdapter;

  /** Supported chains — defaults to ["ethereum", "base", "solana"] */
  chains?: SupportedChain[];

  /** How long a pending request lives before expiring (seconds, default 600) */
  ttl?: number;

  /** Hook called when a request is resolved (approved/rejected/expired) */
  onResolved?: (request: PendingRequest) => void | Promise<void>;

  /** Hook called when a request expires */
  onExpired?: (request: PendingRequest) => void | Promise<void>;
}

// ─── Bridge API ───────────────────────────────────────────────────────────────

export interface RequestSignatureOptions {
  sessionId: string;
  transaction: Transaction;
  /** Override TTL for this specific request */
  ttl?: number;
}

export interface WalletBridge {
  /** Create a new pending signature request. Returns immediately with approvalUrl. */
  requestSignature(options: RequestSignatureOptions): Promise<{
    requestId: string;
    approvalUrl: string;
    expiresAt: Date;
    status: "pending";
  }>;

  /** Poll the status of a request */
  getRequest(requestId: string): Promise<PendingRequest | null>;

  /** Wait for a request to resolve (polling internally) */
  waitForApproval(
    requestId: string,
    options?: { pollInterval?: number; timeout?: number }
  ): Promise<PendingRequest>;

  /** Resolve a request (called by the approval UI backend) */
  resolve(requestId: string, result: PendingResult): Promise<PendingRequest>;

  /** Reject a request (called by the approval UI backend) */
  reject(requestId: string, reason?: string): Promise<PendingRequest>;

  /** List pending requests for a session */
  listPending(sessionId: string): Promise<PendingRequest[]>;

  /** Run cleanup of expired requests */
  cleanup(): Promise<number>;
}

// ─── MCP Tool Helpers ─────────────────────────────────────────────────────────

/** Standardized return shape for MCP tools using the bridge */
export interface BridgeToolResult {
  status: "pending_approval" | "approved" | "rejected" | "expired" | "failed";
  requestId?: string;
  approvalUrl?: string;
  txHash?: string;
  signature?: string;
  signerAddress?: string;
  message?: string;
  expiresAt?: string;
}
