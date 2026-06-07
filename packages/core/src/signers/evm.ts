/**
 * EVM Signer Helper
 *
 * Handles all EVM transaction types using viem.
 * Works with any EVM chain: Ethereum, Base, Polygon, Arbitrum, Optimism, etc.
 *
 * Peer dependency: viem ^2.0.0
 *
 * Usage (in your onApprove handler):
 * ```ts
 * import { handleEvmTransaction } from "@mcp-web3/wallet-bridge/signers/evm";
 *
 * onApprove={async (request) => {
 *   return handleEvmTransaction(request, {
 *     walletClient,   // from wagmi's useWalletClient()
 *     publicClient,   // from wagmi's usePublicClient()
 *   });
 * }}
 * ```
 */

import type {
  ContractCallTx,
  PendingRequest,
  PendingResult,
  SignMessageTx,
  SignTypedTx,
  TokenTransferTx,
  TransferTx,
} from "../types/index.js";
import { BUILT_IN_CHAINS } from "../chains/index.js";

// ─── Minimal viem type shims (avoids hard dep at type level) ──────────────────

type Hex = `0x${string}`;
type Address = Hex;

interface WalletClient {
  account: { address: Address };
  sendTransaction(args: {
    to: Address;
    value?: bigint;
    data?: Hex;
  }): Promise<Hex>;
  writeContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
    value?: bigint;
  }): Promise<Hex>;
  signMessage(args: { message: string }): Promise<Hex>;
  signTypedData(args: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
}

interface PublicClient {
  waitForTransactionReceipt(args: { hash: Hex }): Promise<{ blockHash: Hex }>;
  readContract(args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<unknown>;
  getBalance(args: { address: Address }): Promise<bigint>;
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface EvmSignerOptions {
  walletClient: WalletClient;
  publicClient?: PublicClient;
  /** Whether to wait for tx confirmation (default: false — returns hash immediately) */
  waitForConfirmation?: boolean;
}

// ─── ERC-20 minimal ABI ───────────────────────────────────────────────────────

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

const ERC20_DECIMALS_ABI = [
  {
    name: "decimals",
    type: "function",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
] as const;

// ─── Main handler ─────────────────────────────────────────────────────────────

/**
 * handleEvmTransaction
 *
 * Routes a PendingRequest to the correct viem call based on transaction type.
 * Returns a PendingResult ready to pass to bridge.resolve().
 */
export async function handleEvmTransaction(
  request: PendingRequest,
  options: EvmSignerOptions
): Promise<PendingResult> {
  const { walletClient, publicClient, waitForConfirmation = false } = options;
  const { transaction } = request;
  const signerAddress = walletClient.account.address;

  switch (transaction.type) {
    case "transfer":
      return handleTransfer(transaction as TransferTx, walletClient, publicClient, signerAddress, waitForConfirmation);

    case "token_transfer":
      return handleTokenTransfer(transaction as TokenTransferTx, walletClient, publicClient, signerAddress, waitForConfirmation);

    case "contract_call":
      return handleContractCall(transaction as ContractCallTx, walletClient, publicClient, signerAddress, waitForConfirmation);

    case "sign_message":
      return handleSignMessage(transaction as SignMessageTx, walletClient, signerAddress);

    case "sign_typed":
      return handleSignTyped(transaction as SignTypedTx, walletClient, signerAddress);

    default:
      throw new Error(`Unsupported EVM transaction type: ${(transaction as { type: string }).type}`);
  }
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleTransfer(
  tx: TransferTx,
  wallet: WalletClient,
  publicClient: PublicClient | undefined,
  signerAddress: Address,
  waitForConfirmation: boolean
): Promise<PendingResult> {
  if (!tx.to) throw new Error("transfer: missing `to` address");
  if (!tx.value) throw new Error("transfer: missing `value`");

  const valueWei = parseEther(tx.value);
  const hash = await wallet.sendTransaction({
    to: tx.to as Address,
    value: valueWei,
  });

  if (waitForConfirmation && publicClient) {
    await publicClient.waitForTransactionReceipt({ hash });
  }

  return { txHash: hash, signerAddress };
}

async function handleTokenTransfer(
  tx: TokenTransferTx,
  wallet: WalletClient,
  publicClient: PublicClient | undefined,
  signerAddress: Address,
  waitForConfirmation: boolean
): Promise<PendingResult> {
  if (!tx.tokenAddress) throw new Error("token_transfer: missing `tokenAddress`");
  if (!tx.to) throw new Error("token_transfer: missing `to`");
  if (!tx.amount) throw new Error("token_transfer: missing `amount`");

  let decimals = tx.decimals ?? 18;

  // Auto-fetch decimals if not provided and publicClient is available
  if (!tx.decimals && publicClient) {
    try {
      decimals = Number(
        await publicClient.readContract({
          address: tx.tokenAddress as Address,
          abi: ERC20_DECIMALS_ABI,
          functionName: "decimals",
          args: [],
        })
      );
    } catch {
      // Fall back to 18
    }
  }

  const amountRaw = parseUnits(tx.amount, decimals);

  const hash = await wallet.writeContract({
    address: tx.tokenAddress as Address,
    abi: ERC20_TRANSFER_ABI,
    functionName: "transfer",
    args: [tx.to as Address, amountRaw],
  });

  if (waitForConfirmation && publicClient) {
    await publicClient.waitForTransactionReceipt({ hash });
  }

  return { txHash: hash, signerAddress };
}

async function handleContractCall(
  tx: ContractCallTx,
  wallet: WalletClient,
  publicClient: PublicClient | undefined,
  signerAddress: Address,
  waitForConfirmation: boolean
): Promise<PendingResult> {
  if (!tx.to) throw new Error("contract_call: missing `to`");
  if (!tx.abi) throw new Error("contract_call: missing `abi`");
  if (!tx.functionName) throw new Error("contract_call: missing `functionName`");

  const hash = await wallet.writeContract({
    address: tx.to as Address,
    abi: tx.abi,
    functionName: tx.functionName,
    args: tx.args ?? [],
    value: tx.value ? parseEther(tx.value) : undefined,
  });

  if (waitForConfirmation && publicClient) {
    await publicClient.waitForTransactionReceipt({ hash });
  }

  return { txHash: hash, signerAddress };
}

async function handleSignMessage(
  tx: SignMessageTx,
  wallet: WalletClient,
  signerAddress: Address
): Promise<PendingResult> {
  if (!tx.message) throw new Error("sign_message: missing `message`");

  const signature = await wallet.signMessage({ message: tx.message });
  return { signature, signerAddress };
}

async function handleSignTyped(
  tx: SignTypedTx,
  wallet: WalletClient,
  signerAddress: Address
): Promise<PendingResult> {
  // Extract primaryType from types — it's the key that isn't EIP712Domain
  const primaryType = Object.keys(tx.types).find((k) => k !== "EIP712Domain") ?? "Message";

  const signature = await wallet.signTypedData({
    domain: tx.domain,
    types: tx.types,
    primaryType,
    message: tx.value as Record<string, unknown>,
  });

  return { signature, signerAddress };
}

// ─── Chain helpers ────────────────────────────────────────────────────────────

/**
 * getEvmChainId
 * Returns the numeric chainId for a supported EVM chain string.
 */
export function getEvmChainId(chain: string): number | undefined {
  return BUILT_IN_CHAINS[chain]?.chainId;
}

// ─── Pure math helpers (avoids viem import at module level) ──────────────────

function parseEther(value: string): bigint {
  return parseUnits(value, 18);
}

function parseUnits(value: string, decimals: number): bigint {
  const [whole, frac = ""] = value.split(".");
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole + fracPadded);
}
