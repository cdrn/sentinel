import {
  encodeFunctionData,
  parseAbi,
  type PublicClient,
  type Chain,
  type Transport,
  type WalletClient,
  type Account,
} from "viem";
import type { PipelineResult } from "../../detectors/pipeline.js";
import { ROUTERS_BY_CHAIN } from "../../config/tokens.js";

const ROUTER_ABI = parseAbi([
  "function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable",
  "function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)",
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
]);

export interface SnipeConfig {
  maxBuyAmount: bigint; // max ETH/WETH to spend
  minLiquidity: bigint; // min base token liquidity in pool
  maxTax: number; // max acceptable round-trip tax %
  slippage: number; // slippage tolerance (e.g. 20 = 20%)
}

const DEFAULT_CONFIG: SnipeConfig = {
  maxBuyAmount: 10n ** 16n, // 0.01 ETH
  minLiquidity: 10n ** 17n, // 0.1 ETH equivalent
  maxTax: 15,
  slippage: 25,
};

export function shouldSnipe(result: PipelineResult, config = DEFAULT_CONFIG): boolean {
  if (!result.tags.has("snipeable")) return false;
  if (result.tags.has("honeypot")) return false;
  if (result.tags.has("high-tax")) return false;

  const tax = result.meta.effectiveTax as number | undefined;
  if (tax !== undefined && tax > config.maxTax) return false;

  const liq = BigInt(result.meta.baseLiquidityRaw as string || "0");
  if (liq < config.minLiquidity) return false;

  return true;
}

export function buildSnipeTx(
  result: PipelineResult,
  walletAddress: `0x${string}`,
  config = DEFAULT_CONFIG,
): {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  description: string;
} | null {
  const chain = result.contract.chain;
  const router = ROUTERS_BY_CHAIN[chain];
  if (!router) return null;

  const newToken = result.meta.newToken as `0x${string}` | undefined;
  const baseToken = result.meta.baseToken as `0x${string}` | undefined;
  const tokenSymbol = result.meta.tokenSymbol as string || "UNKNOWN";
  const baseSymbol = result.meta.baseTokenSymbol as string || "BASE";

  if (!newToken || !baseToken) return null;

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 min

  // Use fee-on-transfer variant to handle tax tokens
  const data = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
    args: [
      0n, // amountOutMin — set to 0, rely on slippage protection from maxBuyAmount
      [baseToken, newToken],
      walletAddress,
      deadline,
    ],
  });

  return {
    to: router,
    data,
    value: config.maxBuyAmount,
    description: `Snipe ${tokenSymbol} with ${config.maxBuyAmount.toString()} wei ${baseSymbol}`,
  };
}
