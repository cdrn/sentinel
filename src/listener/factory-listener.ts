import {
  type PublicClient,
  type Chain,
  type Transport,
  parseAbiItem,
  getAddress,
} from "viem";
import type { DeployedContract } from "./deployment-listener.js";

type ContractHandler = (contract: DeployedContract) => void | Promise<void>;

// Uniswap V2 PairCreated(address indexed token0, address indexed token1, address pair, uint)
const PAIR_CREATED_EVENT = parseAbiItem(
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint256)"
);

// Uniswap V3 PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)
const POOL_CREATED_EVENT = parseAbiItem(
  "event PoolCreated(address indexed token0, address indexed token1, uint24 indexed fee, int24 tickSpacing, address pool)"
);

interface FactoryConfig {
  address: `0x${string}`;
  type: "uniswap-v2" | "uniswap-v3";
  label: string;
}

// Verified factory addresses per chain.
// Sources: Uniswap official docs (developers.uniswap.org), May 2026.
const FACTORIES_BY_CHAIN: Record<string, FactoryConfig[]> = {
  ethereum: [
    { address: "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f", type: "uniswap-v2", label: "Uniswap V2" },
    { address: "0x1F98431c8aD98523631AE4a59f267346ea31F984", type: "uniswap-v3", label: "Uniswap V3" },
  ],
  arbitrum: [
    { address: "0xf1D7CC64Fb4452F05c498126312eBE29f30Fbcf9", type: "uniswap-v2", label: "Uniswap V2" },
    { address: "0x1F98431c8aD98523631AE4a59f267346ea31F984", type: "uniswap-v3", label: "Uniswap V3" },
  ],
  base: [
    { address: "0x8909Dc15e40173Ff4699343b6eB8132c65e18eC6", type: "uniswap-v2", label: "Uniswap V2" },
    { address: "0x33128a8fC17869897dcE68Ed026d694621f6FDfD", type: "uniswap-v3", label: "Uniswap V3" },
  ],
};

export class FactoryListener {
  private client: PublicClient<Transport, Chain>;
  private chainName: string;
  private handlers: ContractHandler[] = [];
  private unwatchers: (() => void)[] = [];

  constructor(client: PublicClient<Transport, Chain>, chainName: string) {
    this.client = client;
    this.chainName = chainName;
  }

  onDeploy(handler: ContractHandler) {
    this.handlers.push(handler);
  }

  async start() {
    const factories = FACTORIES_BY_CHAIN[this.chainName];
    if (!factories || factories.length === 0) {
      console.log(`[${this.chainName}] No factory addresses configured`);
      return;
    }

    for (const factory of factories) {
      const event = factory.type === "uniswap-v2" ? PAIR_CREATED_EVENT : POOL_CREATED_EVENT;

      const unwatch = this.client.watchEvent({
        address: factory.address,
        event,
        onLogs: async (logs) => {
          for (const log of logs) {
            const newContractAddress = factory.type === "uniswap-v2"
              ? (log.args as any).pair
              : (log.args as any).pool;

            if (!newContractAddress) continue;

            const address = getAddress(newContractAddress);

            // Fetch bytecode of the new pool/pair
            const bytecode = await this.client.getCode({ address });
            if (!bytecode || bytecode === "0x") continue;

            const block = await this.client.getBlock({ blockNumber: log.blockNumber! });

            const token0 = (log.args as any).token0 as string;
            const token1 = (log.args as any).token1 as string;

            const deployed: DeployedContract = {
              address,
              deployer: factory.address,
              bytecode,
              txHash: log.transactionHash!,
              blockNumber: log.blockNumber!,
              chain: this.chainName,
              timestamp: Number(block.timestamp),
              poolInfo: {
                token0: token0 as `0x${string}`,
                token1: token1 as `0x${string}`,
                factory: factory.label,
                dexType: factory.type,
              },
            };

            console.log(
              `[${this.chainName}] ${factory.label} new pool: ${address} (${token0.slice(0, 8)}…/${token1.slice(0, 8)}…)`
            );

            for (const handler of this.handlers) {
              try {
                await handler(deployed);
              } catch (err) {
                console.error(
                  `[${this.chainName}] Handler error for factory contract ${address}:`,
                  err
                );
              }
            }
          }
        },
      });

      this.unwatchers.push(unwatch);
      console.log(`[${this.chainName}] Watching ${factory.label} factory (${factory.address.slice(0, 10)}…)`);
    }
  }

  stop() {
    for (const unwatch of this.unwatchers) {
      unwatch();
    }
    this.unwatchers = [];
  }
}
