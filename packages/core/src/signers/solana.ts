/**
 * Solana Signer Helper
 *
 * Handles all Solana transaction types using @solana/web3.js + @solana/spl-token.
 * Works with Phantom, Backpack, Solflare, and any wallet implementing the
 * Solana Wallet Standard.
 *
 * Peer dependencies:
 *   @solana/web3.js ^1.95.0
 *   @solana/spl-token ^0.4.0  (only needed for token_transfer)
 *
 * Usage (in your onApprove handler):
 * ```ts
 * import { handleSolanaTransaction } from "@mcp-web3/wallet-bridge/signers/solana";
 * import { useWallet, useConnection } from "@solana/wallet-adapter-react";
 *
 * const { connection } = useConnection();
 * const wallet = useWallet();
 *
 * onApprove={async (request) => {
 *   return handleSolanaTransaction(request, { wallet, connection });
 * }}
 * ```
 */

import type {
  PendingRequest,
  PendingResult,
  SignMessageTx,
  TokenTransferTx,
  TransferTx,
  CustomTx,
} from "../types/index.js";

// ─── Minimal type shims for @solana/web3.js ───────────────────────────────────
// Using `any` shims to avoid a hard peer dependency at the type level.
// Consumers get full type safety from their own installed @solana/web3.js.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SolanaConnection = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SolanaPublicKey = any;

interface SolanaWalletAdapter {
  publicKey: SolanaPublicKey | null;
  signTransaction?<T>(transaction: T): Promise<T>;
  sendTransaction(
    transaction: unknown,
    connection: SolanaConnection,
    options?: unknown
  ): Promise<string>;
  signMessage?(message: Uint8Array): Promise<{ signature: Uint8Array }>;
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface SolanaSignerOptions {
  wallet: SolanaWalletAdapter;
  connection: SolanaConnection;
  /** Commitment level for confirmation (default: "confirmed") */
  commitment?: "processed" | "confirmed" | "finalized";
  /** Whether to wait for confirmation before returning (default: true) */
  waitForConfirmation?: boolean;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

/**
 * handleSolanaTransaction
 *
 * Routes a PendingRequest to the correct Solana operation based on type.
 * Returns a PendingResult ready to pass to bridge.resolve().
 */
export async function handleSolanaTransaction(
  request: PendingRequest,
  options: SolanaSignerOptions
): Promise<PendingResult> {
  const { wallet } = options;

  if (!wallet.publicKey) {
    throw new Error("Wallet not connected — publicKey is null");
  }

  const { transaction } = request;

  switch (transaction.type) {
    case "transfer":
      return handleSolTransfer(transaction as TransferTx, options);

    case "token_transfer":
      return handleSplTransfer(transaction as TokenTransferTx, options);

    case "sign_message":
      return handleSignMessage(transaction as SignMessageTx, options);

    case "custom":
      return handleCustom(transaction as CustomTx, options);

    default:
      throw new Error(
        `Unsupported Solana transaction type: ${(transaction as { type: string }).type}`
      );
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleSolTransfer(
  tx: TransferTx,
  { wallet, connection, commitment = "confirmed", waitForConfirmation = true }: SolanaSignerOptions
): Promise<PendingResult> {
  if (!tx.to) throw new Error("transfer: missing `to` address");
  if (!tx.value) throw new Error("transfer: missing `value`");

  // Dynamic import to avoid hard dep
  const { Transaction, SystemProgram, PublicKey, LAMPORTS_PER_SOL } =
    await import("@solana/web3.js");

  const toPubkey = new PublicKey(tx.to);
  const lamports = Math.round(parseFloat(tx.value) * LAMPORTS_PER_SOL);

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash(commitment);

  const transaction = new Transaction({
    recentBlockhash: blockhash,
    feePayer: wallet.publicKey,
  }).add(
    SystemProgram.transfer({
      fromPubkey: wallet.publicKey,
      toPubkey,
      lamports,
    })
  );

  const signature = await wallet.sendTransaction(transaction, connection);

  if (waitForConfirmation) {
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      commitment
    );
  }

  return {
    txHash: signature,
    signerAddress: wallet.publicKey.toBase58(),
  };
}

async function handleSplTransfer(
  tx: TokenTransferTx,
  { wallet, connection, commitment = "confirmed", waitForConfirmation = true }: SolanaSignerOptions
): Promise<PendingResult> {
  if (!tx.tokenAddress) throw new Error("token_transfer: missing `tokenAddress`");
  if (!tx.to) throw new Error("token_transfer: missing `to`");
  if (!tx.amount) throw new Error("token_transfer: missing `amount`");

  const { PublicKey, Transaction } = await import("@solana/web3.js");
  const {
    getOrCreateAssociatedTokenAccount,
    createTransferInstruction,
    getMint,
  } = await import("@solana/spl-token");

  const mintPubkey = new PublicKey(tx.tokenAddress);
  const toPubkey = new PublicKey(tx.to);

  // Get mint decimals
  const mintInfo = await getMint(connection, mintPubkey);
  const decimals = tx.decimals ?? mintInfo.decimals;
  const amountRaw = BigInt(
    Math.round(parseFloat(tx.amount) * Math.pow(10, decimals))
  );

  // Get or create associated token accounts
  // Note: getOrCreateAssociatedTokenAccount requires a Signer — in browser
  // environments use getAssociatedTokenAddressSync instead for read-only lookup.
  const fromAta = await getAssociatedTokenAddressSync(
    mintPubkey,
    wallet.publicKey!,
    connection
  );
  const toAta = await getAssociatedTokenAddressSync(
    mintPubkey,
    toPubkey,
    connection
  );

  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash(commitment);

  const transaction = new Transaction({
    recentBlockhash: blockhash,
    feePayer: wallet.publicKey,
  }).add(
    createTransferInstruction(fromAta, toAta, wallet.publicKey!, amountRaw)
  );

  const signature = await wallet.sendTransaction(transaction, connection);

  if (waitForConfirmation) {
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      commitment
    );
  }

  return {
    txHash: signature,
    signerAddress: wallet.publicKey!.toBase58(),
  };
}

async function handleSignMessage(
  tx: SignMessageTx,
  { wallet }: SolanaSignerOptions
): Promise<PendingResult> {
  if (!tx.message) throw new Error("sign_message: missing `message`");
  if (!wallet.signMessage) {
    throw new Error("Wallet does not support signMessage");
  }

  const encoded = new Uint8Array(
    Array.from(tx.message).map((c) => c.charCodeAt(0))
  );
  const { signature } = await wallet.signMessage(encoded);

  // Base58-encode the signature
  const { bs58Encode } = await import("../utils/bs58.js");
  const sigBase58 = bs58Encode(signature);

  return {
    signature: sigBase58,
    signerAddress: wallet.publicKey!.toBase58(),
  };
}

async function handleCustom(
  tx: CustomTx,
  { wallet, connection, commitment = "confirmed", waitForConfirmation = true }: SolanaSignerOptions
): Promise<PendingResult> {
  // Expects payload to be a serialized Transaction or VersionedTransaction
  const { Transaction, VersionedTransaction } = await import("@solana/web3.js");

  const payload = tx.payload;
  if (!payload || typeof payload !== "object") {
    throw new Error("custom: payload must be a serialized Solana transaction object");
  }

  // Accept either a raw Uint8Array or a pre-built transaction
  let transaction: unknown;
  if (payload instanceof Uint8Array) {
    try {
      transaction = VersionedTransaction.deserialize(payload);
    } catch {
      transaction = Transaction.from(payload);
    }
  } else {
    transaction = payload;
  }

  const signature = await wallet.sendTransaction(transaction, connection);

  if (waitForConfirmation) {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash(commitment);
    await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      commitment
    );
  }

  return {
    txHash: signature,
    signerAddress: wallet.publicKey!.toBase58(),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * getAssociatedTokenAddressSync (browser-safe ATA lookup)
 * Falls back to @solana/spl-token's getAssociatedTokenAddressSync if available.
 */
async function getAssociatedTokenAddressSync(
  mint: SolanaPublicKey,
  owner: SolanaPublicKey,
  connection: SolanaConnection
): Promise<SolanaPublicKey> {
  const { getAssociatedTokenAddressSync: splGetAta, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } =
    await import("@solana/spl-token");
  return splGetAta(mint, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
}

/**
 * isSolanaChain
 * Quick check to decide which signer to use.
 */
export function isSolanaChain(chain: string): boolean {
  return chain === "solana" || chain === "solana-devnet" || chain.startsWith("solana");
}
