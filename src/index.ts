import "dotenv/config";
import { createPublicClient, webSocket } from "viem";
import { mainnet, arbitrum, base, optimism } from "viem/chains";
import { DeploymentListener } from "./listener/deployment-listener.js";
import { analyze, formatResult } from "./analyzer/index.js";

interface ChainConfig {
  chain: typeof mainnet;
  envKey: string;
  name: string;
}

const CHAINS: ChainConfig[] = [
  { chain: mainnet, envKey: "ETH_RPC_WS", name: "ethereum" },
  { chain: arbitrum, envKey: "ARB_RPC_WS", name: "arbitrum" },
  { chain: base, envKey: "BASE_RPC_WS", name: "base" },
  { chain: optimism, envKey: "OP_RPC_WS", name: "optimism" },
];

async function main() {
  console.log("Sentinel - Contract Deployment Scanner");
  console.log("=======================================\n");

  const listeners: DeploymentListener[] = [];

  for (const { chain, envKey, name } of CHAINS) {
    const rpcUrl = process.env[envKey];
    if (!rpcUrl) {
      console.log(`Skipping ${name} — ${envKey} not set`);
      continue;
    }

    const client = createPublicClient({
      chain,
      transport: webSocket(rpcUrl),
    });

    const listener = new DeploymentListener(client, name);

    listener.onDeploy(async (contract) => {
      const result = analyze(contract);

      if (result.interesting) {
        console.log(formatResult(result));
        // TODO: deeper analysis, source fetching, execution
      }
    });

    listeners.push(listener);
  }

  if (listeners.length === 0) {
    console.error("No RPC endpoints configured. Copy .env.example to .env and add your keys.");
    process.exit(1);
  }

  // Start all listeners
  await Promise.all(listeners.map((l) => l.start()));

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    listeners.forEach((l) => l.stop());
    process.exit(0);
  });
}

main().catch(console.error);
