import { erc20Abi, formatEther, formatUnits } from "viem";
import type { Detector, DetectorContext } from "./types.js";
import { TOKENS_BY_CHAIN, type TokenInfo } from "../config/tokens.js";

export interface TokenBalance {
  symbol: string;
  balance: bigint;
  formatted: string;
  decimals: number;
}

export const valueDetector: Detector = {
  name: "value",
  description: "Checks ETH + blue-chip ERC20 balances on newly deployed contracts",

  async detect(ctx: DetectorContext) {
    const { contract, client } = ctx;
    const tokens = TOKENS_BY_CHAIN[contract.chain];
    if (!tokens) return;

    const balances: TokenBalance[] = [];

    // Check native ETH balance
    const ethBalance = await client.getBalance({ address: contract.address });
    if (ethBalance > 0n) {
      balances.push({
        symbol: "ETH",
        balance: ethBalance,
        formatted: formatEther(ethBalance),
        decimals: 18,
      });
    }

    // Check ERC20 balances in parallel
    const results = await Promise.allSettled(
      tokens.map(async (token) => {
        const balance = await client.readContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [contract.address],
        });
        return { token, balance };
      })
    );

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { token, balance } = result.value;
      if (balance > 0n) {
        balances.push({
          symbol: token.symbol,
          balance,
          formatted: formatUnits(balance, token.decimals),
          decimals: token.decimals,
        });
      }
    }

    if (balances.length === 0) return;

    // Store balances for downstream use
    ctx.meta.balances = balances.map((b) => ({
      symbol: b.symbol,
      formatted: b.formatted,
    }));
    ctx.tags.add("has-value");

    // Estimate USD value (rough — we don't have price feeds)
    // For scoring purposes: stables = face value, ETH/WETH ~ $3k, WBTC ~ $100k
    const ROUGH_PRICES: Record<string, number> = {
      ETH: 3000, WETH: 3000, WBTC: 100000,
      USDC: 1, USDT: 1, DAI: 1,
    };

    let estimatedUsd = 0;
    for (const b of balances) {
      const price = ROUGH_PRICES[b.symbol] || 0;
      estimatedUsd += parseFloat(b.formatted) * price;
    }

    ctx.meta.estimatedUsd = Math.round(estimatedUsd);

    const severity = estimatedUsd >= 10000 ? "critical"
      : estimatedUsd >= 1000 ? "high"
      : estimatedUsd >= 100 ? "medium"
      : "low";

    const balanceSummary = balances
      .map((b) => `${b.formatted} ${b.symbol}`)
      .join(", ");

    ctx.findings.push({
      detector: "value",
      severity,
      title: `Contract holds value (~$${ctx.meta.estimatedUsd})`,
      description: `Balances: ${balanceSummary}`,
    });
  },
};
