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
  decimals0: number;
  decimals1: number;
  symbol: string; // e.g. "WETH/USDC"
  pools: PoolConfig[];
}

// Base token addresses — verified on basescan.org
const WETH = "0x4200000000000000000000000000000000000006" as const;
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const AERO = "0x940181a94a35a4569e4529a3cdfb74e38fd98631" as const;
const DEGEN = "0x4ed4e862860bed51a9570b96d89af5e1b0efefed" as const;
const BRETT = "0x532f27101965dd16442e59d40670faf5ebb142e4" as const;
const TOSHI = "0xAC1Bd2486aAf3B5C0fc3Fd868558b082a531B2B4" as const;
const cbETH = "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22" as const;

// Verified pool addresses — confirmed via basescan.org, GeckoTerminal, DexScreener
export const BASE_PAIRS: PairPools[] = [
  {
    token0: WETH,
    token1: USDC,
    decimals0: 18,
    decimals1: 6,
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
  {
    token0: AERO,
    token1: WETH,
    decimals0: 18,
    decimals1: 18,
    symbol: "AERO/WETH",
    pools: [
      {
        address: "0x7f670f78b17dec44d5ef68a48740b6f8849cc2e6",
        type: "aerodrome-v2",
        token0: AERO,
        token1: WETH,
        label: "Aerodrome",
      },
      {
        address: "0x3d5d143381916280ff91407febeb52f2b60f33cf",
        type: "uniswap-v3",
        token0: AERO,
        token1: WETH,
        fee: 3000,
        label: "Uni V3 0.3%",
      },
      {
        address: "0x0d5959a52e7004b601f0be70618d01ac3cdce976",
        type: "uniswap-v3",
        token0: AERO,
        token1: WETH,
        fee: 10000,
        label: "Uni V3 1%",
      },
    ],
  },
  {
    token0: DEGEN,
    token1: WETH,
    decimals0: 18,
    decimals1: 18,
    symbol: "DEGEN/WETH",
    pools: [
      {
        address: "0xc9034c3e7f58003e6ae0c8438e7c8f4598d5acaa",
        type: "uniswap-v3",
        token0: DEGEN,
        token1: WETH,
        fee: 3000,
        label: "Uni V3 0.3%",
      },
      {
        address: "0x0ca6485b7e9cf814a3fd09d81672b07323535b64",
        type: "uniswap-v3",
        token0: DEGEN,
        token1: WETH,
        fee: 10000,
        label: "Uni V3 1%",
      },
    ],
  },
  {
    token0: BRETT,
    token1: WETH,
    decimals0: 18,
    decimals1: 18,
    symbol: "BRETT/WETH",
    pools: [
      {
        address: "0xba3f945812a83471d709bce9c3ca699a19fb46f7",
        type: "uniswap-v3",
        token0: BRETT,
        token1: WETH,
        fee: 10000,
        label: "Uni V3 1%",
      },
      {
        address: "0x76bf0abd20f1e0155ce40a62615a90a709a6c3d8",
        type: "uniswap-v3",
        token0: BRETT,
        token1: WETH,
        fee: 3000,
        label: "Uni V3 0.3%",
      },
      {
        address: "0x4e829f8a5213c42535ab84aa40bd4adcce9cba02",
        type: "aerodrome-v2",
        token0: BRETT,
        token1: WETH,
        label: "Aerodrome",
      },
    ],
  },
  {
    token0: TOSHI,
    token1: WETH,
    decimals0: 18,
    decimals1: 18,
    symbol: "TOSHI/WETH",
    pools: [
      {
        address: "0x4b0aaf3ebb163dd45f663b38b6d93f6093ebc2d3",
        type: "uniswap-v3",
        token0: TOSHI,
        token1: WETH,
        fee: 10000,
        label: "Uni V3 1%",
      },
      {
        address: "0x5aa4ad647580bfe86258d300bc9852f4434e2c61",
        type: "uniswap-v3",
        token0: TOSHI,
        token1: WETH,
        fee: 3000,
        label: "Uni V3 0.3%",
      },
      {
        address: "0xbfc74e1de81e81b0a807469502f6662cc238795e",
        type: "uniswap-v2",
        token0: TOSHI,
        token1: WETH,
        label: "Sushi V2",
      },
    ],
  },
  {
    token0: cbETH,
    token1: WETH,
    decimals0: 18,
    decimals1: 18,
    symbol: "cbETH/WETH",
    pools: [
      {
        address: "0x10648ba41b8565907cfa1496765fa4d95390aa0d",
        type: "uniswap-v3",
        token0: cbETH,
        token1: WETH,
        fee: 500,
        label: "Uni V3 0.05%",
      },
      {
        address: "0xa9dafa443a02fbc907cb0093276b3e6f4ef02a46",
        type: "uniswap-v3",
        token0: cbETH,
        token1: WETH,
        fee: 100,
        label: "Uni V3 0.01%",
      },
    ],
  },
];

// Arb contract address on Base
export const ARB_CONTRACT = "0xce8bb30aa456bea30b93d79dc3a77957ddb265d0" as const;

// WETH address exported for pair discovery
export const BASE_WETH = WETH;

// Factory addresses on Base — for querying existing pools
export const BASE_FACTORIES = {
  uniswapV2: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6" as `0x${string}`,
  uniswapV3: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD" as `0x${string}`,
  aerodromeV2: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da" as `0x${string}`,
};
