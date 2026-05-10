import {
  encodeFunctionData,
  parseAbi,
  type PublicClient,
  type Chain,
  type Transport,
  createWalletClient,
  http,
  formatEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import type { ArbOpportunity } from "../../listener/arb-listener.js";
import { ARB_CONTRACT } from "../../config/dexes.js";

const ARB_ABI = parseAbi([
  "function arbV2V2(address buyPool, address sellPool, address tokenIn, address tokenOut, uint256 amountIn, uint256 minProfit)",
  "function arbV2V3(address buyPool, address sellPool, address tokenIn, address tokenOut, uint256 amountIn, uint256 minProfit)",
  "function arbV3V2(address buyPool, address sellPool, address tokenIn, address tokenOut, uint256 amountIn, uint256 minProfit)",
  "function arbV3V3(address buyPool, address sellPool, address tokenIn, address tokenOut, uint256 amountIn, uint256 minProfit)",
]);

type ArbFunction = "arbV2V2" | "arbV2V3" | "arbV3V2" | "arbV3V3";

function getArbFunction(buyType: string, sellType: string): ArbFunction {
  const buyV2 = buyType === "uniswap-v2" || buyType === "aerodrome-v2";
  const sellV2 = sellType === "uniswap-v2" || sellType === "aerodrome-v2";

  if (buyV2 && sellV2) return "arbV2V2";
  if (buyV2 && !sellV2) return "arbV2V3";
  if (!buyV2 && sellV2) return "arbV3V2";
  return "arbV3V3";
}

export interface ArbExecutionResult {
  opportunity: ArbOpportunity;
  txHash?: string;
  success: boolean;
  simulated: boolean;
  profit?: bigint;
  error?: string;
}

export async function executeArb(
  opp: ArbOpportunity,
  client: PublicClient<Transport, Chain>,
  dryRun: boolean,
): Promise<ArbExecutionResult> {
  const fnName = getArbFunction(opp.buyPool.pool.type, opp.sellPool.pool.type);

  // token0 is WETH (what we start and end with)
  // token1 is the other token (USDC etc)
  const tokenIn = opp.pair.token0;
  const tokenOut = opp.pair.token1;

  // Min profit: use 1 wei as minimum — the contract reverts if not profitable
  // The real check is in the simulation below
  const minProfit = 1n;

  const calldata = encodeFunctionData({
    abi: ARB_ABI,
    functionName: fnName,
    args: [
      opp.buyPool.pool.address,
      opp.sellPool.pool.address,
      tokenIn,
      tokenOut,
      opp.amountIn,
      minProfit,
    ],
  });

  // Simulate first
  try {
    await client.call({
      to: ARB_CONTRACT,
      data: calldata,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // If simulation reverts, the arb isn't profitable on-chain
    return {
      opportunity: opp,
      success: false,
      simulated: true,
      error: msg.slice(0, 200),
    };
  }

  console.log(`[arb] Opportunity: ${opp.pair.symbol} ${opp.buyPool.pool.label} → ${opp.sellPool.pool.label}`);
  console.log(`  Spread: ${opp.profitBps.toFixed(1)}bps | Est profit: ${formatEther(opp.estimatedProfit)} WETH`);

  if (dryRun) {
    console.log(`  Status: SIMULATED (dry run)`);
    return {
      opportunity: opp,
      success: true,
      simulated: true,
      profit: opp.estimatedProfit,
    };
  }

  // Live execution
  const pk = process.env.EXECUTOR_PRIVATE_KEY;
  if (!pk) {
    return { opportunity: opp, success: false, simulated: true, error: "no private key" };
  }

  const account = privateKeyToAccount(pk as `0x${string}`);
  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: http(process.env.BASE_RPC_HTTP || undefined),
  });

  try {
    const gasEstimate = await client.estimateGas({
      to: ARB_CONTRACT,
      data: calldata,
      account: account.address,
    });

    const txHash = await walletClient.sendTransaction({
      to: ARB_CONTRACT,
      data: calldata,
      gas: gasEstimate * 120n / 100n,
    });

    console.log(`  Status: SUBMITTED ${txHash}`);

    const receipt = await client.waitForTransactionReceipt({ hash: txHash });
    const success = receipt.status === "success";

    console.log(`  Result: ${success ? "SUCCESS" : "REVERTED"}`);

    return {
      opportunity: opp,
      txHash,
      success,
      simulated: false,
      profit: success ? opp.estimatedProfit : 0n,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`  Status: FAILED — ${msg.slice(0, 200)}`);
    return { opportunity: opp, success: false, simulated: false, error: msg };
  }
}
