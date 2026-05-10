# Backdraft

Real-time contract deployment scanner and MEV searcher. Watches Ethereum, Arbitrum, and Base for newly deployed contracts and token launches, runs them through a modular detection pipeline, and optionally executes profitable actions.

## Architecture

```
Listeners                    Pipeline                         Output
─────────────────           ──────────────────────           ──────────
Deployment Listener  ──┐    Prescreen (bytecode, 0 RPC)     SQLite DB
  (watches blocks)     ├──► Proxy Detector          ──────► Telegram
Factory Listener     ──┘    Initializer Detector             Executor
  (Uniswap events)          Open Withdrawal Detector           ├─ Claim
                            Ownership Detector                 ├─ Drain
                            Value Detector                     └─ Snipe
                            Honeypot Detector
```

**Listeners** watch for new contracts via two methods:
- **Deployment listener** — watches every block for `CREATE` transactions (tx.to === null)
- **Factory listener** — watches Uniswap V2/V3 factory events for new pool creation

**Detectors** run in a two-phase pipeline:
- **Phase 1 (prescreen)** — bytecode-only selector scanning, zero RPC calls
- **Phase 2 (gated)** — RPC-heavy analysis, only runs if prescreen found something interesting or the contract is a new pool

**Executor** acts on critical findings:
- Claim uninitialized proxies
- Drain open withdrawal functions
- Snipe new token launches (with honeypot protection)

## Setup

```bash
git clone git@github.com:cdrn/backdraft.git
cd backdraft
npm install
cp .env.example .env
# Edit .env with your RPC URLs and config
npm run dev
```

## Feature Flags

All flags default to `true`. Set to `false` in `.env` to disable.

| Flag | What it controls |
|------|-----------------|
| `ENABLE_DEPLOYMENT_LISTENER` | Watch blocks for direct contract deployments |
| `ENABLE_FACTORY_LISTENER` | Watch Uniswap factory events for new pools |
| `ENABLE_VULN_DETECTORS` | Proxy, initializer, withdrawal, ownership detectors |
| `ENABLE_SNIPER` | Honeypot detection and pool sniping |
| `ENABLE_EXECUTOR` | Transaction execution (dry-run or live) |

### Cost optimization examples

Only run the pool sniper (lowest RPC usage):
```
ENABLE_DEPLOYMENT_LISTENER=false
ENABLE_VULN_DETECTORS=false
ENABLE_SNIPER=true
```

Only monitor, no execution:
```
ENABLE_EXECUTOR=false
```

## Chain Configuration

Set WebSocket RPC URLs for the chains you want to monitor. Chains without a URL are skipped.

```
ETH_RPC_WS=wss://eth-mainnet.g.alchemy.com/v2/YOUR_KEY
ARB_RPC_WS=wss://arb-mainnet.g.alchemy.com/v2/YOUR_KEY
BASE_RPC_WS=wss://base-mainnet.g.alchemy.com/v2/YOUR_KEY
```

### RPC cost notes

Block watching is the dominant cost (~97 CU/s across 3 chains). Arbitrum is the most expensive due to fast block times (~4/sec). If costs are a concern, drop Arbitrum first and disable the deployment listener to rely only on factory events.

## Executor

The executor is in **dry-run mode by default**. It simulates transactions and logs results without submitting.

To go live:
```
EXECUTOR_PRIVATE_KEY=0xyour_private_key
EXECUTOR_LIVE=true
```

## Telegram Alerts

1. Create a bot via @BotFather on Telegram
2. Get your chat/channel ID
3. Add to `.env`:
```
TG_BOT_TOKEN=your_token
TG_CHAT_ID=your_chat_id
```

## Deployment

Docker Compose with Watchtower for auto-deploy:

```bash
docker compose up -d
```

Watchtower polls ghcr.io every 60 seconds. Push to master triggers CI → builds image → Watchtower pulls and restarts.

## Project Structure

```
src/
  config/
    flags.ts              Feature flag system
    tokens.ts             Verified token addresses per chain
  listener/
    deployment-listener.ts  Block watching for CREATE txs
    factory-listener.ts     Uniswap factory event watching
  detectors/
    pipeline.ts           Two-phase detector pipeline
    prescreen-detector.ts Bytecode-only prescreen (0 RPC)
    proxy-detector.ts     EIP-1967/1167 proxy detection
    initializer-detector.ts Uninitialized proxy detection
    open-withdrawal-detector.ts Open withdraw/drain functions
    ownership-detector.ts Zero-owner / claimable ownership
    value-detector.ts     ETH + blue-chip ERC20 balance check
    honeypot-detector.ts  Buy+sell simulation, sniper trap detection
  executor/
    index.ts              Transaction builder and submitter
    strategies/
      snipe.ts            Uniswap V2 swap execution
  store/
    index.ts              SQLite persistence
  alerts/
    telegram.ts           Telegram bot alerts
  index.ts                Entry point
```
