/**
 * Auto-Router
 *
 * Detects the chain family from a PendingRequest and dispatches
 * to the correct signer (EVM or Solana) automatically.
 *
 * This is the highest-level helper — most consumers should use this
 * instead of importing the EVM or Solana signers directly.
 *
 * Usage:
 * ```ts
 * import { handleTransaction } from "@mcp-web3/wallet-bridge/signers";
 *
 * onApprove={async (request) => {
 *   return handleTransaction(request, {
 *     evm: { walletClient, publicClient },
 *     solana: { wallet, connection },
 *   });
 * }}
 * ```
 */

import type { PendingRequest, PendingResult } from "../types/index.js";
import { getChainFamily } from "../chains/index.js";
import { handleEvmTransaction, type EvmSignerOptions } from "./evm.js";
import { handleSolanaTransaction, type SolanaSignerOptions } from "./solana.js";

export interface MultiChainSignerOptions {
  /** EVM signer config — required if you support any EVM chain */
  evm?: EvmSignerOptions;
  /** Solana signer config — required if you support Solana */
  solana?: SolanaSignerOptions;
}

/**
 * handleTransaction
 *
 * The top-level signing router. Detects chain family and delegates.
 * Throws if the required signer config is not provided.
 */
export async function handleTransaction(
  request: PendingRequest,
  options: MultiChainSignerOptions
): Promise<PendingResult> {
  const chain = request.transaction.chain;
  const family = getChainFamily(chain);

  if (family === "evm") {
    if (!options.evm) {
      throw new Error(
        `Transaction is on EVM chain "${chain}" but no EVM signer config was provided. ` +
        `Pass { evm: { walletClient, publicClient } } to handleTransaction().`
      );
    }
    return handleEvmTransaction(request, options.evm);
  }

  if (family === "solana") {
    if (!options.solana) {
      throw new Error(
        `Transaction is on Solana chain "${chain}" but no Solana signer config was provided. ` +
        `Pass { solana: { wallet, connection } } to handleTransaction().`
      );
    }
    return handleSolanaTransaction(request, options.solana);
  }

  throw new Error(`Unknown chain family for chain "${chain}"`);
}

// Re-export individual signers for consumers who want direct access
export { handleEvmTransaction, type EvmSignerOptions } from "./evm.js";
export { handleSolanaTransaction, type SolanaSignerOptions } from "./solana.js";
