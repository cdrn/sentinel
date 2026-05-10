import {
  type PublicClient,
  type Chain,
  type Transport,
  parseAbi,
  formatUnits,
} from "viem";
import { BASE_PAIRS, type PoolConfig, type PairPools } from "../config/dexes.js";

const V2_ABI = parseAbi([
  "function getReserves() view returns (uint112, uint112, uint32)",
  "function token0() view returns (address)",
]);

const V3_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function liquidity() view returns (uint128)",
  "function token0() view returns (address)",
]);

export interface PoolPrice {
  pool: PoolConfig;
  // For V2: reserves
  reserve0?: bigint;
  reserve1?: bigint;
  // For V3: sqrtPriceX96
  sqrtPriceX96?: bigint;
  tick?: number;
  liquidity?: bigint;
  // Computed: how much token1 you get for 1 unit of token0
  price: number;
  timestamp: number;
}

export interface ArbOpportunity {
  pair: PairPools;
  buyPool: PoolPrice;
  sellPool: PoolPrice;
  profitBps: number; // estimated profit in basis points
  estimatedProfit: bigint; // in token0 (usually WETH)
  amountIn: bigint;
}

type ArbHandler = (opp: ArbOpportunity) => void | Promise<void>;

export class ArbListener {
  private client: PublicClient<Transport, Chain>;
  private handlers: ArbHandler[] = [];
  private interval: ReturnType<typeof setInterval> | null = null;
  private pollMs: number;
  private minProfitBps: number;

  constructor(
    client: PublicClient<Transport, Chain>,
    pollMs = 1000,
    minProfitBps = 5, // 0.05% minimum profit
  ) {
    this.client = client;
    this.pollMs = pollMs;
    this.minProfitBps = minProfitBps;
  }

  onOpportunity(handler: ArbHandler) {
    this.handlers.push(handler);
  }

  async start() {
    console.log(`[arb] Monitoring ${BASE_PAIRS.length} pairs across ${BASE_PAIRS.reduce((s, p) => s + p.pools.length, 0)} pools`);
    console.log(`[arb] Poll interval: ${this.pollMs}ms, min profit: ${this.minProfitBps}bps`);

    // Initial scan
    await this.scan();

    // Poll
    this.interval = setInterval(() => this.scan(), this.pollMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async scan() {
    for (const pair of BASE_PAIRS) {
      try {
        const prices = await this.fetchPrices(pair);
        if (prices.length < 2) continue;

        const opportunities = this.findOpportunities(pair, prices);
        for (const opp of opportunities) {
          for (const handler of this.handlers) {
            try {
              await handler(opp);
            } catch (err) {
              console.error("[arb] Handler error:", err);
            }
          }
        }
      } catch (err) {
        // Silently skip — transient RPC errors are expected
      }
    }
  }

  private async fetchPrices(pair: PairPools): Promise<PoolPrice[]> {
    const now = Date.now();
    const results = await Promise.allSettled(
      pair.pools.map(async (pool): Promise<PoolPrice> => {
        if (pool.type === "uniswap-v2" || pool.type === "aerodrome-v2") {
          const [r0, r1] = await this.client.readContract({
            address: pool.address,
            abi: V2_ABI,
            functionName: "getReserves",
          });

          // Price = reserve1 / reserve0 (adjusted for decimals later)
          const price = Number(r1) / Number(r0);

          return {
            pool,
            reserve0: r0,
            reserve1: r1,
            price,
            timestamp: now,
          };
        } else {
          // V3
          const [sqrtPriceX96, tick] = await this.client.readContract({
            address: pool.address,
            abi: V3_ABI,
            functionName: "slot0",
          });

          const liq = await this.client.readContract({
            address: pool.address,
            abi: V3_ABI,
            functionName: "liquidity",
          });

          // Price from sqrtPriceX96: price = (sqrtPriceX96 / 2^96)^2
          const sqrtPrice = Number(sqrtPriceX96) / 2 ** 96;
          const price = sqrtPrice * sqrtPrice;

          return {
            pool,
            sqrtPriceX96,
            tick: Number(tick),
            liquidity: liq,
            price,
            timestamp: now,
          };
        }
      })
    );

    return results
      .filter((r): r is PromiseFulfilledResult<PoolPrice> => r.status === "fulfilled")
      .map((r) => r.value);
  }

  private findOpportunities(pair: PairPools, prices: PoolPrice[]): ArbOpportunity[] {
    const opportunities: ArbOpportunity[] = [];

    // Compare every pair of pools
    for (let i = 0; i < prices.length; i++) {
      for (let j = 0; j < prices.length; j++) {
        if (i === j) continue;

        const buyPool = prices[i]; // buy token1 here (higher price = more token1 per token0)
        const sellPool = prices[j]; // sell token1 here

        // For WETH/USDC: price = USDC per WETH
        // Buy where price is HIGHEST (get most USDC per WETH)
        // Then sell USDC back to WETH where price is LOWEST (USDC buys more WETH)
        // Profit if: amount_out_from_sell > amount_in_to_buy

        if (buyPool.price <= sellPool.price) continue; // no opportunity

        const spreadBps = ((buyPool.price - sellPool.price) / sellPool.price) * 10000;

        // Estimate fees
        const buyFeeBps = this.getFeeBps(buyPool.pool);
        const sellFeeBps = this.getFeeBps(sellPool.pool);
        const totalFeeBps = buyFeeBps + sellFeeBps;

        const profitBps = spreadBps - totalFeeBps;

        if (profitBps < this.minProfitBps) continue;

        // Calculate optimal amount — start with a test amount
        // Use smaller of the two pools' liquidity to avoid too much price impact
        const testAmount = 5000000000000000n; // 0.005 WETH

        // Simulate the actual arb to get exact profit
        const estimatedProfit = this.simulateArb(buyPool, sellPool, testAmount);

        if (estimatedProfit <= 0n) continue;

        opportunities.push({
          pair,
          buyPool,
          sellPool,
          profitBps,
          estimatedProfit,
          amountIn: testAmount,
        });
      }
    }

    return opportunities;
  }

  private simulateArb(buyPool: PoolPrice, sellPool: PoolPrice, amountIn: bigint): bigint {
    // Step 1: WETH → USDC on buyPool (where we get more USDC)
    const usdcOut = this.getAmountOut(buyPool, amountIn, true);
    if (usdcOut <= 0n) return 0n;

    // Step 2: USDC → WETH on sellPool (where USDC buys more WETH)
    const wethOut = this.getAmountOut(sellPool, usdcOut, false);
    if (wethOut <= 0n) return 0n;

    return wethOut - amountIn;
  }

  private getAmountOut(pool: PoolPrice, amountIn: bigint, zeroForOne: boolean): bigint {
    if (pool.pool.type === "uniswap-v2" || pool.pool.type === "aerodrome-v2") {
      if (!pool.reserve0 || !pool.reserve1) return 0n;
      const fee = pool.pool.type === "aerodrome-v2" ? 997n : 997n; // both use 0.3%
      const [reserveIn, reserveOut] = zeroForOne
        ? [pool.reserve0, pool.reserve1]
        : [pool.reserve1, pool.reserve0];

      const amountInWithFee = amountIn * fee;
      return (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee);
    } else {
      // V3 — approximate using sqrtPriceX96
      // This is rough — for exact amounts we'd need tick math
      // But good enough for opportunity detection; exact simulation happens on-chain
      if (!pool.sqrtPriceX96 || !pool.liquidity) return 0n;

      const sqrtPrice = pool.sqrtPriceX96;
      const liq = pool.liquidity;

      // Very rough V3 estimate using constant product around current tick
      // Real execution will differ, which is why the contract checks minProfit
      const feeBps = BigInt(pool.pool.fee || 3000);
      const feeMultiplier = 1000000n - feeBps * 100n;

      if (zeroForOne) {
        // token0 → token1
        const price = (sqrtPrice * sqrtPrice) / (1n << 192n);
        if (price === 0n) return 0n;
        const grossOut = (amountIn * price * feeMultiplier) / 1000000n;
        // Scale for WETH(18) → USDC(6) decimal difference
        return grossOut / (10n ** 12n);
      } else {
        // token1 → token0
        if (sqrtPrice === 0n) return 0n;
        const invPrice = (1n << 192n) / (sqrtPrice * sqrtPrice);
        const grossOut = (amountIn * invPrice * feeMultiplier) / 1000000n;
        return grossOut * (10n ** 12n);
      }
    }
  }

  private getFeeBps(pool: PoolConfig): number {
    if (pool.type === "uniswap-v2") return 30; // 0.3%
    if (pool.type === "aerodrome-v2") return 30; // 0.3%
    if (pool.type === "uniswap-v3") return (pool.fee || 3000) / 100; // fee is in hundredths of bps
    return 30;
  }
}
