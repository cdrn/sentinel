import Database from "better-sqlite3";
import path from "path";
import type { PipelineResult } from "../detectors/pipeline.js";
import type { Finding } from "../detectors/types.js";
import type { ExecutionResult } from "../executor/index.js";
import type { PairPools, PoolConfig } from "../config/dexes.js";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "backdraft.db");

export class Store {
  private db: Database.Database;

  constructor(dbPath: string = DB_PATH) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS contracts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        address TEXT NOT NULL,
        chain TEXT NOT NULL,
        deployer TEXT NOT NULL,
        tx_hash TEXT NOT NULL,
        block_number INTEGER NOT NULL,
        bytecode_size INTEGER NOT NULL,
        score INTEGER NOT NULL,
        tags TEXT NOT NULL DEFAULT '[]',
        meta TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(chain, address)
      );

      CREATE TABLE IF NOT EXISTS findings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id INTEGER NOT NULL REFERENCES contracts(id),
        detector TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_contracts_chain ON contracts(chain);
      CREATE INDEX IF NOT EXISTS idx_contracts_score ON contracts(score);
      CREATE INDEX IF NOT EXISTS idx_contracts_deployer ON contracts(deployer);
      CREATE INDEX IF NOT EXISTS idx_contracts_created ON contracts(created_at);
      CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);
      CREATE INDEX IF NOT EXISTS idx_findings_detector ON findings(detector);

      CREATE TABLE IF NOT EXISTS executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contract_id INTEGER NOT NULL REFERENCES contracts(id),
        action TEXT NOT NULL,
        tx_hash TEXT,
        simulated INTEGER NOT NULL DEFAULT 1,
        success INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        gas_estimate TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS arb_pairs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token0 TEXT NOT NULL,
        token1 TEXT NOT NULL,
        decimals0 INTEGER NOT NULL DEFAULT 18,
        decimals1 INTEGER NOT NULL DEFAULT 18,
        symbol TEXT NOT NULL,
        pools TEXT NOT NULL DEFAULT '[]',
        active INTEGER NOT NULL DEFAULT 1,
        discovered_at TEXT NOT NULL DEFAULT (datetime('now')),
        last_checked TEXT,
        UNIQUE(token0, token1)
      );

      CREATE INDEX IF NOT EXISTS idx_arb_pairs_active ON arb_pairs(active);
    `);
  }

  save(result: PipelineResult): number {
    const insertContract = this.db.prepare(`
      INSERT OR IGNORE INTO contracts (address, chain, deployer, tx_hash, block_number, bytecode_size, score, tags, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertFinding = this.db.prepare(`
      INSERT INTO findings (contract_id, detector, severity, title, description)
      VALUES (?, ?, ?, ?, ?)
    `);

    const txn = this.db.transaction(() => {
      const info = insertContract.run(
        result.contract.address,
        result.contract.chain,
        result.contract.deployer,
        result.contract.txHash,
        Number(result.contract.blockNumber),
        (result.contract.bytecode.length - 2) / 2,
        result.score,
        JSON.stringify([...result.tags]),
        JSON.stringify(result.meta)
      );

      const contractId = info.lastInsertRowid as number;
      if (contractId === 0) return 0; // already existed

      for (const f of result.findings) {
        insertFinding.run(contractId, f.detector, f.severity, f.title, f.description);
      }

      return contractId;
    });

    return txn();
  }

  getCriticalFindings(chain?: string, limit = 50) {
    const where = chain ? "WHERE f.severity = 'critical' AND c.chain = ?" : "WHERE f.severity = 'critical'";
    const params = chain ? [chain, limit] : [limit];

    return this.db.prepare(`
      SELECT c.address, c.chain, c.deployer, c.score, c.created_at,
             f.detector, f.title, f.description
      FROM findings f
      JOIN contracts c ON c.id = f.contract_id
      ${where}
      ORDER BY c.created_at DESC
      LIMIT ?
    `).all(...params);
  }

  getStats() {
    return this.db.prepare(`
      SELECT
        chain,
        COUNT(*) as total_contracts,
        SUM(CASE WHEN score >= 30 THEN 1 ELSE 0 END) as interesting,
        SUM(CASE WHEN score >= 50 THEN 1 ELSE 0 END) as high_score,
        MAX(score) as max_score
      FROM contracts
      GROUP BY chain
    `).all();
  }

  getTopDeployers(limit = 20) {
    return this.db.prepare(`
      SELECT deployer, chain, COUNT(*) as contract_count, AVG(score) as avg_score
      FROM contracts
      GROUP BY deployer, chain
      ORDER BY contract_count DESC
      LIMIT ?
    `).all(limit);
  }

  saveExecution(contractId: number, exec: ExecutionResult) {
    this.db.prepare(`
      INSERT INTO executions (contract_id, action, tx_hash, simulated, success, error, gas_estimate)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      contractId,
      exec.action,
      exec.txHash || null,
      exec.simulated ? 1 : 0,
      exec.success ? 1 : 0,
      exec.error || null,
      exec.gasEstimate?.toString() || null
    );
  }

  saveArbPair(pair: PairPools): boolean {
    const existing = this.db.prepare(
      "SELECT id, pools FROM arb_pairs WHERE token0 = ? AND token1 = ?"
    ).get(pair.token0.toLowerCase(), pair.token1.toLowerCase()) as any;

    if (existing) {
      // Merge pools — add any new pool addresses
      const existingPools: PoolConfig[] = JSON.parse(existing.pools);
      const existingAddrs = new Set(existingPools.map(p => p.address.toLowerCase()));
      let added = false;
      for (const pool of pair.pools) {
        if (!existingAddrs.has(pool.address.toLowerCase())) {
          existingPools.push(pool);
          added = true;
        }
      }
      if (added) {
        this.db.prepare(
          "UPDATE arb_pairs SET pools = ?, active = 1 WHERE id = ?"
        ).run(JSON.stringify(existingPools), existing.id);
      }
      return added;
    }

    this.db.prepare(
      "INSERT INTO arb_pairs (token0, token1, decimals0, decimals1, symbol, pools) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      pair.token0.toLowerCase(),
      pair.token1.toLowerCase(),
      pair.decimals0,
      pair.decimals1,
      pair.symbol,
      JSON.stringify(pair.pools),
    );
    return true;
  }

  getActiveArbPairs(): PairPools[] {
    const rows = this.db.prepare(
      "SELECT * FROM arb_pairs WHERE active = 1"
    ).all() as any[];

    return rows.map(row => ({
      token0: row.token0 as `0x${string}`,
      token1: row.token1 as `0x${string}`,
      decimals0: row.decimals0,
      decimals1: row.decimals1,
      symbol: row.symbol,
      pools: JSON.parse(row.pools),
    }));
  }

  deactivateArbPair(token0: string, token1: string) {
    this.db.prepare(
      "UPDATE arb_pairs SET active = 0 WHERE token0 = ? AND token1 = ?"
    ).run(token0.toLowerCase(), token1.toLowerCase());
  }

  touchArbPair(token0: string, token1: string) {
    this.db.prepare(
      "UPDATE arb_pairs SET last_checked = datetime('now') WHERE token0 = ? AND token1 = ?"
    ).run(token0.toLowerCase(), token1.toLowerCase());
  }

  close() {
    this.db.close();
  }
}
