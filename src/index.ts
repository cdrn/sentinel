import "dotenv/config";
import { createPublicClient, webSocket, type Chain, type PublicClient, type Transport } from "viem";
import { mainnet, arbitrum, base } from "viem/chains";
import { DeploymentListener, type DeployedContract } from "./listener/deployment-listener.js";
import { FactoryListener } from "./listener/factory-listener.js";
import {
  Pipeline,
  formatResult,
  prescreenDetector,
  proxyDetector,
  initializerDetector,
  openWithdrawalDetector,
  ownershipDetector,
  valueDetector,
  honeypotDetector,
} from "./detectors/index.js";
import { Store } from "./store/index.js";
import { Executor } from "./executor/index.js";
import { TelegramAlert } from "./alerts/telegram.js";
import { flags, printFlags } from "./config/flags.js";
import { ArbListener } from "./listener/arb-listener.js";
import { PairDiscovery } from "./listener/pair-discovery.js";
import { executeArb } from "./executor/strategies/arb.js";

interface ChainConfig {
  chain: Chain;
  envKey: string;
  name: string;
}

const CHAINS: ChainConfig[] = [
  { chain: mainnet, envKey: "ETH_RPC_WS", name: "ethereum" },
  { chain: arbitrum, envKey: "ARB_RPC_WS", name: "arbitrum" },
  { chain: base, envKey: "BASE_RPC_WS", name: "base" },
];

const SCORE_THRESHOLD = 30;
const EXECUTE_THRESHOLD = 50;

async function main() {
  console.log("Backdraft - Contract Deployment Scanner");
  console.log("=======================================\n");

  const store = new Store();
  console.log("Database: backdraft.db\n");

  printFlags();

  const pipeline = new Pipeline();
  console.log("Loading detectors:");
  pipeline.register(prescreenDetector);

  if (flags.vulnDetectors) {
    pipeline.register(proxyDetector, true);
    pipeline.register(initializerDetector, true);
    pipeline.register(openWithdrawalDetector, true);
    pipeline.register(ownershipDetector, true);
    pipeline.register(valueDetector, true);
  }

  if (flags.sniper) {
    pipeline.register(honeypotDetector, true);
  }
  console.log("");

  let executor: Executor | null = null;
  if (flags.executor) {
    console.log("Executor:");
    executor = new Executor();
    console.log("");
  }

  const tg = new TelegramAlert();
  console.log(`Telegram: ${tg.enabled ? "enabled" : "disabled (set TG_BOT_TOKEN + TG_CHAT_ID)"}\n`);

  let totalScanned = 0;
  let totalFlagged = 0;
  let totalExecuted = 0;
  let totalArbsFound = 0;
  let totalArbsExecuted = 0;

  const stoppers: (() => void)[] = [];

  function makeHandler(client: PublicClient<Transport, Chain>) {
    return async (contract: DeployedContract) => {
      const result = await pipeline.run(contract, client);
      totalScanned++;

      let contractId = 0;
      if (result.findings.length > 0) {
        contractId = store.save(result);
      }

      if (result.score >= SCORE_THRESHOLD) {
        totalFlagged++;
        console.log(formatResult(result));
        tg.alertFinding(result);
      }

      if (!executor) return;

      const shouldExecute = (result.score >= EXECUTE_THRESHOLD && result.findings.some(f => f.severity === "critical"))
        || result.tags.has("snipeable");
      if (shouldExecute) {
        const execResults = await executor.execute(result, client);
        totalExecuted += execResults.length;

        if (contractId > 0) {
          for (const exec of execResults) {
            store.saveExecution(contractId, exec);
          }
        }

        tg.alertExecution(result, execResults);
      }
    };
  }

  let hasChains = false;

  for (const { chain, envKey, name } of CHAINS) {
    const rpcUrl = process.env[envKey];
    if (!rpcUrl) {
      console.log(`Skipping ${name} — ${envKey} not set`);
      continue;
    }
    hasChains = true;

    const client = createPublicClient({
      chain,
      transport: webSocket(rpcUrl),
    });

    const handler = makeHandler(client);

    if (flags.deploymentListener) {
      const deployListener = new DeploymentListener(client, name);
      deployListener.onDeploy(handler);
      await deployListener.start();
      stoppers.push(() => deployListener.stop());
    }

    // Set up pair discovery for Base before factory listener so we can hook into it
    let discovery: PairDiscovery | null = null;
    if (flags.arbScanner && name === "base") {
      discovery = new PairDiscovery(client, store);
    }

    if (flags.factoryListener) {
      const factoryListener = new FactoryListener(client, name);
      factoryListener.onDeploy(handler);
      if (discovery) {
        factoryListener.onDeploy((contract) => discovery!.handleFactoryEvent(contract));
      }
      await factoryListener.start();
      stoppers.push(() => factoryListener.stop());
    }

    // Arb scanner — only on Base
    if (flags.arbScanner && name === "base") {
      const dryRun = process.env.EXECUTOR_LIVE !== "true";
      const arbListener = new ArbListener(client, 2000, 5);

      // Load saved dynamic pairs from DB
      const savedPairs = store.getActiveArbPairs();
      for (const pair of savedPairs) {
        arbListener.addPair(pair);
      }
      if (savedPairs.length > 0) {
        console.log(`[discovery] Loaded ${savedPairs.length} saved pairs from DB`);
      }

      // Wire discovery into arb listener
      if (discovery) {
        discovery.onNewPair((pair) => arbListener.addPair(pair));
      }

      arbListener.onOpportunity(async (opp) => {
        totalArbsFound++;
        console.log(`[arb] Found: ${opp.pair.symbol} ${opp.buyPool.pool.label} → ${opp.sellPool.pool.label} (${opp.profitBps.toFixed(1)}bps)`);

        const result = await executeArb(opp, client, dryRun);
        if (result.success) {
          totalArbsExecuted++;
          tg.alertFinding({
            contract: { address: opp.buyPool.pool.address, chain: "base", deployer: "0x" as any, bytecode: "0x" as any, txHash: "0x" as any, blockNumber: 0n, timestamp: 0 },
            findings: [{ detector: "arb", severity: "low", title: `Arb: ${opp.pair.symbol}`, description: `${opp.buyPool.pool.label} → ${opp.sellPool.pool.label} | ${opp.profitBps.toFixed(1)}bps` }],
            tags: new Set(["arb"]),
            meta: {},
            score: 10,
          });
        }
      });

      await arbListener.start();
      stoppers.push(() => arbListener.stop());
    }
  }

  if (!hasChains) {
    console.error("No RPC endpoints configured. Copy .env.example to .env and add your keys.");
    process.exit(1);
  }

  setInterval(() => {
    console.log(`\n--- Scanned: ${totalScanned} | Flagged: ${totalFlagged} | Executed: ${totalExecuted} | Arbs: ${totalArbsFound}/${totalArbsExecuted} ---\n`);
  }, 60_000);

  process.on("SIGINT", () => {
    console.log(`\nShutting down... Scanned ${totalScanned}, flagged ${totalFlagged}, executed ${totalExecuted}.`);
    const stats = store.getStats();
    if (stats.length > 0) {
      console.log("\nSession stats by chain:");
      console.table(stats);
    }
    store.close();
    stoppers.forEach((stop) => stop());
    process.exit(0);
  });
}

main().catch(console.error);
