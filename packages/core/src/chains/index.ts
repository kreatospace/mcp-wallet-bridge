import type { ChainConfig, ChainFamily, SupportedChain } from "../types/index.js";

export const BUILT_IN_CHAINS: Record<string, ChainConfig> = {
  ethereum: {
    id: "ethereum",
    family: "evm",
    name: "Ethereum",
    chainId: 1,
    nativeCurrency: { symbol: "ETH", decimals: 18 },
  },
  base: {
    id: "base",
    family: "evm",
    name: "Base",
    chainId: 8453,
    nativeCurrency: { symbol: "ETH", decimals: 18 },
  },
  "base-sepolia": {
    id: "base-sepolia",
    family: "evm",
    name: "Base Sepolia",
    chainId: 84532,
    nativeCurrency: { symbol: "ETH", decimals: 18 },
  },
  polygon: {
    id: "polygon",
    family: "evm",
    name: "Polygon",
    chainId: 137,
    nativeCurrency: { symbol: "POL", decimals: 18 },
  },
  arbitrum: {
    id: "arbitrum",
    family: "evm",
    name: "Arbitrum One",
    chainId: 42161,
    nativeCurrency: { symbol: "ETH", decimals: 18 },
  },
  optimism: {
    id: "optimism",
    family: "evm",
    name: "Optimism",
    chainId: 10,
    nativeCurrency: { symbol: "ETH", decimals: 18 },
  },
  solana: {
    id: "solana",
    family: "solana",
    name: "Solana",
    nativeCurrency: { symbol: "SOL", decimals: 9 },
  },
  "solana-devnet": {
    id: "solana-devnet",
    family: "solana",
    name: "Solana Devnet",
    nativeCurrency: { symbol: "SOL", decimals: 9 },
  },
};

export function getChainFamily(chain: SupportedChain): ChainFamily {
  const config = BUILT_IN_CHAINS[chain];
  if (config) return config.family;
  // Heuristic for custom chains: if it looks like an EVM chain id, treat as EVM
  return "evm";
}

export function getChainConfig(chain: SupportedChain): ChainConfig | null {
  return BUILT_IN_CHAINS[chain] ?? null;
}

export function isEvmChain(chain: SupportedChain): boolean {
  return getChainFamily(chain) === "evm";
}

export function isSolanaChain(chain: SupportedChain): boolean {
  return getChainFamily(chain) === "solana";
}
