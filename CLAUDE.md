# Backdraft

## Overview
MEV searcher and contract scanner on Ethereum and Base. Modular pipeline architecture — listeners detect events, detectors analyze them, executor acts on findings. Currently focused on cross-DEX arbitrage on Base.

## Tech Stack
- **Off-chain:** TypeScript, viem, better-sqlite3, tsx
- **On-chain:** Solidity (Foundry), targeting Huff for gas-critical paths later
- **Infra:** Docker, GitHub Actions CI/CD, Watchtower auto-deploy, DigitalOcean VPS

## Architecture
- `src/listener/` — event sources (block watching, factory events, price monitoring)
- `src/detectors/` — two-phase pipeline: cheap prescreen then gated expensive detectors
- `src/executor/` — transaction building and submission, strategy-specific modules
- `src/config/` — feature flags, verified token/DEX addresses per chain
- `src/store/` — SQLite persistence
- `src/alerts/` — Telegram notifications
- `contracts/` — Solidity contracts (Foundry project)

## Key Decisions
- All token/DEX addresses are hardcoded and verified against block explorers — never trust user input or on-chain claims for these
- Feature flags via env vars (ENABLE_*) — no code change needed to toggle modules
- Prescreen detector gates expensive RPC calls — bytecode-only scan first, only hit RPC if interesting selectors found
- Executor defaults to dry-run mode (EXECUTOR_LIVE=false)

## Conventions
- Never add Co-Authored-By lines on commits or PRs
- Blue-chip token addresses must be verified against official block explorers before hardcoding
- New modules follow the listener → detector → executor pattern
- Keep RPC usage minimal — block watching is the dominant cost

## Deployment
- Push to master → CI builds Docker image → Watchtower on VPS pulls and restarts
- VPS runs docker-compose with Watchtower for auto-deploy
- Secrets in `.env` on the VPS, never in repo
- Master killswitch: set `KILLSWITCH=true` in env to halt all activity

## Active Development
- Cross-DEX arbitrage on Base (Uniswap V2/V3, Aerodrome, SushiSwap)
- Solidity arb contract for atomic swaps

## Detector forensics — 2026-05-10

34h forensic pass after a V3-detection bug was discovered.

### The bug
Buy/sell sim used Uniswap V2 router (`getAmountsOut`). For tokens whose pool only exists on V3, `factory.getPair` returns 0 and the V2 sim reverts — detector treated that revert as "sell blocked = honeypot." All 50 contracts we initially tagged `honeypot:critical` turned out to be V3 pools (zero V2). Fixed by branching on `poolInfo.dexType` and using `QuoterV2.quoteExactInputSingle` for V3.

### Corrected verdicts on the 50 contracts (after V3 sim)
- **14 real sell-block honeypots** (buy quotes, sell reverts). All on Base at 1% fee tier — nonsense-named auto-deploys (Gsfvv, Ugdbbd, Wffs, Dsdfg, Rff, DMD, AFS, zta, GOTCHI, asdad, PWEASE, GKOR, Xvt) + UCCO on Ethereum.
- **12 empty/drained pools** — no liquidity to simulate against.
- **24 not-actually-honeypots** — clean buy+sell sim. These are the false positives. Includes the Team.Finance `MintBurnTeamToken` cluster (HANTA, SR, LO0P-variants) deployed by `0x514C52CfD8Db898A95FDCEccBEe6e6556945630E` — clean OZ ERC20, no transfer trap. Rug surface (if any) is the uncapped `mint(address,uint256) onlyOwner`, not a sell block.

### Revenue (corrected)
Of the 14 confirmed sell-block honeypots, only **GOTCHI** had meaningful victim inflow in our window (~$395). The rest had bait but no bites. The original "$3,284 captured" number was wrong — it was summing volume across the 50 contaminated rows, mostly from non-honeypots doing legit / wash-trade activity. Treat earlier writeups as invalidated.

### Arb scanner
0 spreads above 5bps across 6 pairs / 18 pools over the same 34h. Polling at 2s is non-competitive with mempool-level searchers.

### Other notes
- Cross-query: 0 contracts had both meaningful value AND an exploit vector. Well-funded = well-built; vulnerable = empty test deploys.
- Operators are clearly running automated deployment pipelines — same bytecode under different vanity names, same operator wallet across multiple tokens.

### Detector TODO
- ✅ V3 quoter support (done — `V3_QUOTERS_BY_CHAIN`, branches on `poolInfo.dexType`).
- Consider a separate "uncapped-mint warning" finding for tokens where `mint()` is `onlyOwner` and there's no supply cap.
- Consider classifying pools by liquidity state (drained/empty vs live) before scoring.
