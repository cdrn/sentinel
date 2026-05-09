import { type PublicClient, type Chain, type Transport, type Log } from "viem";

export interface DeployedContract {
  address: `0x${string}`;
  deployer: `0x${string}`;
  bytecode: `0x${string}`;
  txHash: `0x${string}`;
  blockNumber: bigint;
  chain: string;
  timestamp: number;
  poolInfo?: {
    token0: `0x${string}`;
    token1: `0x${string}`;
    factory: string;
    dexType: "uniswap-v2" | "uniswap-v3";
  };
}

type ContractHandler = (contract: DeployedContract) => void | Promise<void>;

export class DeploymentListener {
  private client: PublicClient<Transport, Chain>;
  private chainName: string;
  private handlers: ContractHandler[] = [];
  private unwatch: (() => void) | null = null;

  constructor(client: PublicClient<Transport, Chain>, chainName: string) {
    this.client = client;
    this.chainName = chainName;
  }

  onDeploy(handler: ContractHandler) {
    this.handlers.push(handler);
  }

  async start() {
    console.log(`[${this.chainName}] Watching for new contract deployments...`);

    this.unwatch = this.client.watchBlocks({
      onBlock: async (block) => {
        const blockNumber = block.number;
        if (!blockNumber) return;

        const fullBlock = await this.client.getBlock({
          blockNumber,
          includeTransactions: true,
        });

        for (const tx of fullBlock.transactions) {
          // Contract creation = tx sent to null address
          if (typeof tx === "string") continue;
          if (tx.to !== null) continue;

          // Get the receipt to find the deployed address
          const receipt = await this.client.getTransactionReceipt({
            hash: tx.hash,
          });

          if (!receipt.contractAddress) continue;

          // Fetch the deployed bytecode
          const bytecode = await this.client.getCode({
            address: receipt.contractAddress,
          });

          if (!bytecode || bytecode === "0x") continue;

          const deployed: DeployedContract = {
            address: receipt.contractAddress,
            deployer: tx.from,
            bytecode,
            txHash: tx.hash,
            blockNumber,
            chain: this.chainName,
            timestamp: Number(fullBlock.timestamp),
          };

          console.log(
            `[${this.chainName}] New contract: ${deployed.address} (${bytecode.length / 2 - 1} bytes)`
          );

          for (const handler of this.handlers) {
            try {
              await handler(deployed);
            } catch (err) {
              console.error(
                `[${this.chainName}] Handler error for ${deployed.address}:`,
                err
              );
            }
          }
        }
      },
    });
  }

  stop() {
    if (this.unwatch) {
      this.unwatch();
      this.unwatch = null;
      console.log(`[${this.chainName}] Stopped watching.`);
    }
  }
}
