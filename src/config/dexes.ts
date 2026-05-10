// Verified DEX pool addresses on Base.
// Only pools we've confirmed exist on-chain.

export type PoolType = "uniswap-v2" | "uniswap-v3" | "aerodrome-v2";

export interface PoolConfig {
  address: `0x${string}`;
  type: PoolType;
  token0: `0x${string}`;
  token1: `0x${string}`;
  fee?: number; // V3 fee tier in bps
  label: string;
}

export interface PairPools {
  token0: `0x${string}`;
  token1: `0x${string}`;
  symbol: string; // e.g. "WETH/USDC"
  pools: PoolConfig[];
}

// Base WETH
const WETH = "0x4200000000000000000000000000000000000006" as const;
// Base USDC
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;

// Verified pool addresses — confirmed on basescan.org
export const BASE_PAIRS: PairPools[] = [
  {
    token0: WETH,
    token1: USDC,
    symbol: "WETH/USDC",
    pools: [
      {
        address: "0x88A43bbDF9D098eEC7bCEda4e2494615dfD9bB9C",
        type: "uniswap-v2",
        token0: WETH,
        token1: USDC,
        label: "Uni V2",
      },
      {
        address: "0xb4CB800910B228ED3d0834cF79D697127BBB00e5",
        type: "uniswap-v3",
        token0: WETH,
        token1: USDC,
        fee: 100,
        label: "Uni V3 0.01%",
      },
      {
        address: "0xd0b53D9277642d899DF5C87A3966A349A798F224",
        type: "uniswap-v3",
        token0: WETH,
        token1: USDC,
        fee: 500,
        label: "Uni V3 0.05%",
      },
      {
        address: "0x6c561B446416E1A00E8E93E221854d6eA4171372",
        type: "uniswap-v3",
        token0: WETH,
        token1: USDC,
        fee: 3000,
        label: "Uni V3 0.3%",
      },
      {
        address: "0xcDAC0d6c6C59727a65F871236188350531885C43",
        type: "aerodrome-v2",
        token0: WETH,
        token1: USDC,
        label: "Aerodrome",
      },
    ],
  },
];

// Arb contract address on Base
export const ARB_CONTRACT = "0xce8bb30aa456bea30b93d79dc3a77957ddb265d0" as const;
