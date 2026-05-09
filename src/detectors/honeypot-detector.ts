import { erc20Abi, encodeFunctionData, decodeFunctionResult, formatUnits } from "viem";
import type { Detector, DetectorContext } from "./types.js";
import { isBaseToken, getBaseToken, TOKENS_BY_CHAIN, ROUTERS_BY_CHAIN } from "../config/tokens.js";

// Uniswap V2 Router ABI (just what we need)
const ROUTER_ABI = [
  {
    name: "getAmountsOut",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "path", type: "address[]" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

// Suspicious function selectors in token bytecode
const HONEYPOT_SELECTORS: Record<string, string> = {
  "a9059cbb": "transfer", // expected
  "23b872dd": "transferFrom", // expected
  "dd62ed3e": "allowance", // expected
  "095ea7b3": "approve", // expected
  "06fdde03": "name", // expected
  // Suspicious ones:
  "49bd5a5e": "uniswapV2Pair", // hardcoded pair — could be used to restrict trading
  "c9567bf9": "openTrading", // owner-gated trading enable
  "8f70ccf7": "setTradingOpen", // same
  "e01af92c": "setAntiBot", // antibot that blocks sells
  "2b14ca56": "sellFee", // dynamic sell fee
  "1694505e": "setUniswapRouter", // can change router
  "bbc0c742": "tradingOpen", // trading flag
};

const MAX_ACCEPTABLE_TAX = 15; // percent — anything above this is likely a scam

export const honeypotDetector: Detector = {
  name: "honeypot",
  description: "Detects honeypot tokens in new pool pairs by simulating buy+sell",

  async detect(ctx: DetectorContext) {
    const { contract, client } = ctx;

    // Only run on factory-created pools
    if (!contract.poolInfo) return;

    const { token0, token1 } = contract.poolInfo;
    const chain = contract.chain;

    // Figure out which token is the "new" one
    const token0IsBase = isBaseToken(chain, token0);
    const token1IsBase = isBaseToken(chain, token1);

    // If both are base tokens or neither is, skip
    if (token0IsBase === token1IsBase) return;

    const newToken = token0IsBase ? token1 : token0;
    const baseTokenAddr = token0IsBase ? token0 : token1;
    const baseToken = getBaseToken(chain, baseTokenAddr);
    if (!baseToken) return;

    ctx.tags.add("new-pool");
    ctx.meta.newToken = newToken;
    ctx.meta.baseToken = baseTokenAddr;
    ctx.meta.baseTokenSymbol = baseToken.symbol;

    // Get the new token's bytecode and check for suspicious patterns
    const tokenBytecode = await client.getCode({ address: newToken });
    if (!tokenBytecode || tokenBytecode === "0x") return;

    const code = tokenBytecode.slice(2);
    const suspiciousFindings: string[] = [];

    // Check for trading restrictions
    for (const [selector, name] of Object.entries(HONEYPOT_SELECTORS)) {
      if (["transfer", "transferFrom", "allowance", "approve", "name"].includes(name)) continue;
      if (code.includes(selector)) {
        suspiciousFindings.push(name);
      }
    }

    // Try to read token metadata
    let tokenSymbol = "UNKNOWN";
    let tokenDecimals = 18;
    try {
      tokenSymbol = await client.readContract({
        address: newToken,
        abi: erc20Abi,
        functionName: "symbol",
      });
    } catch {}
    try {
      tokenDecimals = await client.readContract({
        address: newToken,
        abi: erc20Abi,
        functionName: "decimals",
      });
    } catch {}

    ctx.meta.tokenSymbol = tokenSymbol;
    ctx.meta.tokenDecimals = tokenDecimals;

    // Check total supply
    let totalSupply = 0n;
    try {
      totalSupply = await client.readContract({
        address: newToken,
        abi: erc20Abi,
        functionName: "totalSupply",
      });
    } catch {}

    // Check liquidity in the pool
    let baseLiquidity = 0n;
    try {
      baseLiquidity = await client.readContract({
        address: baseTokenAddr,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [contract.address],
      });
    } catch {}

    const baseLiqFormatted = formatUnits(baseLiquidity, baseToken.decimals);
    ctx.meta.baseLiquidity = baseLiqFormatted;
    ctx.meta.baseLiquidityRaw = baseLiquidity.toString();

    // Simulate buy+sell via router getAmountsOut
    const router = ROUTERS_BY_CHAIN[chain];
    if (!router) return;

    // Simulate buying with a small amount of base token
    const testAmount = baseToken.decimals === 18
      ? 10n ** 16n // 0.01 ETH/WETH
      : 10n ** BigInt(baseToken.decimals); // 1 USDC/USDT/DAI

    let buyOutput = 0n;
    let sellOutput = 0n;
    let buyReverted = false;
    let sellReverted = false;

    // Simulate buy: base → new token
    try {
      const buyResult = await client.readContract({
        address: router,
        abi: ROUTER_ABI,
        functionName: "getAmountsOut",
        args: [testAmount, [baseTokenAddr, newToken]],
      });
      buyOutput = buyResult[1];
    } catch {
      buyReverted = true;
    }

    // Simulate sell: new token → base
    if (buyOutput > 0n) {
      try {
        const sellResult = await client.readContract({
          address: router,
          abi: ROUTER_ABI,
          functionName: "getAmountsOut",
          args: [buyOutput, [newToken, baseTokenAddr]],
        });
        sellOutput = sellResult[1];
      } catch {
        sellReverted = true;
      }
    }

    // Assess the results
    const isHoneypot = buyReverted || sellReverted || (buyOutput > 0n && sellOutput === 0n);

    // Calculate effective tax (buy + sell combined)
    let effectiveTax = 100;
    if (!buyReverted && !sellReverted && sellOutput > 0n) {
      effectiveTax = Number((testAmount - sellOutput) * 100n / testAmount);
    }

    ctx.meta.effectiveTax = effectiveTax;
    ctx.meta.buySimulated = !buyReverted;
    ctx.meta.sellSimulated = !sellReverted;

    if (isHoneypot) {
      ctx.findings.push({
        detector: "honeypot",
        severity: "critical",
        title: `Honeypot detected: ${tokenSymbol}`,
        description: buyReverted
          ? `Buy simulation reverted — token cannot be purchased`
          : `Sell simulation reverted — token cannot be sold. Classic honeypot.`,
      });
      ctx.tags.add("honeypot");
      return;
    }

    if (effectiveTax > MAX_ACCEPTABLE_TAX) {
      ctx.findings.push({
        detector: "honeypot",
        severity: "high",
        title: `High tax token: ${tokenSymbol} (~${effectiveTax}% round-trip)`,
        description: `Buy+sell round trip loses ~${effectiveTax}%. ${suspiciousFindings.length > 0 ? `Suspicious: ${suspiciousFindings.join(", ")}` : ""}`,
      });
      ctx.tags.add("high-tax");
      return;
    }

    if (suspiciousFindings.length > 0) {
      ctx.findings.push({
        detector: "honeypot",
        severity: "medium",
        title: `Suspicious patterns in ${tokenSymbol}`,
        description: `Found: ${suspiciousFindings.join(", ")}. Tax: ~${effectiveTax}%. May become honeypot later.`,
      });
      ctx.tags.add("suspicious-token");
    }

    // If it passed all checks — it's snipeable
    if (effectiveTax <= MAX_ACCEPTABLE_TAX && !isHoneypot && baseLiquidity > 0n) {
      ctx.tags.add("snipeable");
      ctx.findings.push({
        detector: "honeypot",
        severity: "low",
        title: `Snipeable: ${tokenSymbol}/${baseToken.symbol}`,
        description: `Tax: ~${effectiveTax}%. Liquidity: ${baseLiqFormatted} ${baseToken.symbol}. ${suspiciousFindings.length > 0 ? `Caution: ${suspiciousFindings.join(", ")}` : "Looks clean."}`,
      });
    }
  },
};
