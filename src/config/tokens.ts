export interface TokenInfo {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
}

// Hardcoded, verified token addresses per chain.
// Sources: Etherscan, Arbiscan, Basescan — verified May 2026.
// ONLY trusted blue-chip tokens. Never trust random tokens for value assessment.
export const TOKENS_BY_CHAIN: Record<string, TokenInfo[]> = {
  ethereum: [
    { symbol: "USDC", address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6 },
    { symbol: "USDT", address: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6 },
    { symbol: "WETH", address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", decimals: 18 },
    { symbol: "DAI", address: "0x6b175474e89094c44da98b954eedeac495271d0f", decimals: 18 },
    { symbol: "WBTC", address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", decimals: 8 },
  ],
  arbitrum: [
    { symbol: "USDC", address: "0xaf88d065e77c8cc2239327c5edb3a432268e5831", decimals: 6 },
    { symbol: "USDT", address: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", decimals: 6 },
    { symbol: "WETH", address: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", decimals: 18 },
    { symbol: "DAI", address: "0xda10009cbd5d07dd0cecc66161fc93d7c9000da1", decimals: 18 },
    { symbol: "WBTC", address: "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f", decimals: 8 },
  ],
  base: [
    { symbol: "USDC", address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: 6 },
    { symbol: "USDT", address: "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2", decimals: 6 },
    { symbol: "WETH", address: "0x4200000000000000000000000000000000000006", decimals: 18 },
    { symbol: "DAI", address: "0x50c5725949a6f0c72e6c4a641f24049a917db0cb", decimals: 18 },
    { symbol: "WBTC", address: "0x0555e30da8f98308edb960aa94c0db47230d2b9c", decimals: 8 },
  ],
};

// Uniswap V2 router addresses per chain (for swap simulation)
export const ROUTERS_BY_CHAIN: Record<string, `0x${string}`> = {
  ethereum: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
  arbitrum: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
  base: "0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24",
};

// Uniswap V3 QuoterV2 addresses per chain (for V3 swap simulation)
export const V3_QUOTERS_BY_CHAIN: Record<string, `0x${string}`> = {
  ethereum: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  arbitrum: "0x61fFE014bA17989E743c5F6cB21bF9697530B21e",
  base: "0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a",
};

export function isBaseToken(chain: string, address: string): boolean {
  const tokens = TOKENS_BY_CHAIN[chain];
  if (!tokens) return false;
  return tokens.some((t) => t.address.toLowerCase() === address.toLowerCase());
}

export function getBaseToken(chain: string, address: string): TokenInfo | undefined {
  const tokens = TOKENS_BY_CHAIN[chain];
  if (!tokens) return undefined;
  return tokens.find((t) => t.address.toLowerCase() === address.toLowerCase());
}
