import {
  type PublicClient,
  type Chain,
  type Transport,
  parseAbi,
  getAddress,
  zeroAddress,
} from "viem";
import { BASE_FACTORIES, BASE_WETH, type PairPools, type PoolConfig } from "../config/dexes.js";
import type { Store } from "../store/index.js";
import type { DeployedContract } from "./deployment-listener.js";

const ERC20_ABI = parseAbi([
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);

const V2_FACTORY_ABI = parseAbi([
  "function getPair(address, address) view returns (address)",
]);

const V3_FACTORY_ABI = parseAbi([
  "function getPool(address, address, uint24) view returns (address)",
]);

const V2_PAIR_ABI = parseAbi([
  "function getReserves() view returns (uint112, uint112, uint32)",
]);

// Aerodrome V2 factory uses a different signature
const AERO_FACTORY_ABI = parseAbi([
  "function getPool(address, address, bool) view returns (address)",
]);

const V3_FEE_TIERS = [100, 500, 3000, 10000] as const;

// Minimum reserve in WETH terms to consider a pool worth arbing (0.1 ETH)
const MIN_WETH_RESERVE = 100000000000000000n;

type PairHandler = (pair: PairPools) => void | Promise<void>;

export class PairDiscovery {
  private client: PublicClient<Transport, Chain>;
  private store: Store;
  private handlers: PairHandler[] = [];
  // Track tokens we've already checked to avoid redundant RPC calls
  private checkedTokens = new Set<string>();

  constructor(client: PublicClient<Transport, Chain>, store: Store) {
    this.client = client;
    this.store = store;
  }

  onNewPair(handler: PairHandler) {
    this.handlers.push(handler);
  }

  async handleFactoryEvent(contract: DeployedContract) {
    if (contract.chain !== "base") return;
    if (!contract.poolInfo) return;

    const { token0, token1, dexType } = contract.poolInfo;

    // We only care about pairs involving WETH
    const weth = BASE_WETH.toLowerCase();
    let otherToken: `0x${string}`;

    if (token0.toLowerCase() === weth) {
      otherToken = token1;
    } else if (token1.toLowerCase() === weth) {
      otherToken = token0;
    } else {
      return; // Not a WETH pair, skip
    }

    const tokenKey = otherToken.toLowerCase();
    if (this.checkedTokens.has(tokenKey)) return;
    this.checkedTokens.add(tokenKey);

    // This is a new WETH pair on one DEX — check if it exists on other DEXes
    console.log(`[discovery] New WETH pool for ${otherToken.slice(0, 10)}… on ${dexType}, checking other DEXes…`);

    try {
      const pools = await this.findAllPools(otherToken);
      if (pools.length < 2) {
        console.log(`[discovery] Only ${pools.length} pool(s) found for ${otherToken.slice(0, 10)}…, skipping`);
        return;
      }

      // Get token info
      const [symbol, decimals] = await this.getTokenInfo(otherToken);

      const pair: PairPools = {
        token0: otherToken.toLowerCase() as `0x${string}`,
        token1: BASE_WETH,
        decimals0: decimals,
        decimals1: 18,
        symbol: `${symbol}/WETH`,
        pools,
      };

      const isNew = this.store.saveArbPair(pair);
      if (isNew) {
        console.log(`[discovery] Added ${pair.symbol} with ${pools.length} pools: ${pools.map(p => p.label).join(", ")}`);
        for (const handler of this.handlers) {
          try {
            await handler(pair);
          } catch (err) {
            console.error("[discovery] Handler error:", err);
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[discovery] Error checking ${otherToken.slice(0, 10)}…: ${msg.slice(0, 150)}`);
    }
  }

  private async findAllPools(token: `0x${string}`): Promise<PoolConfig[]> {
    const pools: PoolConfig[] = [];
    const tokenAddr = getAddress(token);
    const wethAddr = getAddress(BASE_WETH);

    // Check Uniswap V2
    try {
      const v2Pool = await this.client.readContract({
        address: BASE_FACTORIES.uniswapV2,
        abi: V2_FACTORY_ABI,
        functionName: "getPair",
        args: [tokenAddr, wethAddr],
      });

      if (v2Pool && v2Pool !== zeroAddress) {
        if (await this.hasLiquidity(v2Pool)) {
          pools.push({
            address: v2Pool,
            type: "uniswap-v2",
            token0: token.toLowerCase() as `0x${string}`,
            token1: BASE_WETH,
            label: "Uni V2",
          });
        }
      }
    } catch {}

    // Check Uniswap V3 — all fee tiers
    for (const fee of V3_FEE_TIERS) {
      try {
        const v3Pool = await this.client.readContract({
          address: BASE_FACTORIES.uniswapV3,
          abi: V3_FACTORY_ABI,
          functionName: "getPool",
          args: [tokenAddr, wethAddr, fee],
        });

        if (v3Pool && v3Pool !== zeroAddress) {
          if (await this.hasLiquidity(v3Pool)) {
            const feeLabel = fee >= 10000 ? `${fee / 10000}%` : `${fee / 100}%`;
            pools.push({
              address: v3Pool,
              type: "uniswap-v3",
              token0: token.toLowerCase() as `0x${string}`,
              token1: BASE_WETH,
              fee,
              label: `Uni V3 ${feeLabel}`,
            });
          }
        }
      } catch {}
    }

    // Check Aerodrome V2 (volatile pool)
    try {
      const aeroPool = await this.client.readContract({
        address: BASE_FACTORIES.aerodromeV2,
        abi: AERO_FACTORY_ABI,
        functionName: "getPool",
        args: [tokenAddr, wethAddr, false], // false = volatile
      });

      if (aeroPool && aeroPool !== zeroAddress) {
        if (await this.hasLiquidity(aeroPool)) {
          pools.push({
            address: aeroPool,
            type: "aerodrome-v2",
            token0: token.toLowerCase() as `0x${string}`,
            token1: BASE_WETH,
            label: "Aerodrome",
          });
        }
      }
    } catch {}

    return pools;
  }

  private async hasLiquidity(poolAddress: `0x${string}`): Promise<boolean> {
    try {
      const [r0, r1] = await this.client.readContract({
        address: poolAddress,
        abi: V2_PAIR_ABI,
        functionName: "getReserves",
      });
      // Check if either reserve is meaningful
      return r0 > MIN_WETH_RESERVE || r1 > MIN_WETH_RESERVE;
    } catch {
      // V3 pool — if it exists and has code, assume it has some liquidity
      // The arb listener will verify when it polls prices
      const code = await this.client.getCode({ address: poolAddress });
      return !!code && code !== "0x";
    }
  }

  private async getTokenInfo(token: `0x${string}`): Promise<[string, number]> {
    try {
      const [symbol, decimals] = await Promise.all([
        this.client.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: "symbol",
        }),
        this.client.readContract({
          address: token,
          abi: ERC20_ABI,
          functionName: "decimals",
        }),
      ]);
      return [symbol, decimals];
    } catch {
      return ["???", 18];
    }
  }
}
