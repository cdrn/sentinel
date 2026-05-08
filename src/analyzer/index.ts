import type { DeployedContract } from "../listener/deployment-listener.js";
import { scanBytecode, type PatternMatch } from "./patterns.js";

export interface AnalysisResult {
  contract: DeployedContract;
  patterns: PatternMatch[];
  score: number; // 0-100, higher = more interesting
  interesting: boolean;
}

export function analyze(contract: DeployedContract): AnalysisResult {
  const patterns = scanBytecode(contract.bytecode);

  // Score based on severity of findings
  const severityScores = { low: 5, medium: 15, high: 30, critical: 50 };
  const score = Math.min(
    100,
    patterns.reduce((sum, p) => sum + severityScores[p.severity], 0)
  );

  // Consider it interesting if score is above threshold
  // or if bytecode is small (might be a simple vulnerable contract)
  const bytecodeSize = (contract.bytecode.length - 2) / 2;
  const interesting = score >= 30 || (bytecodeSize < 500 && score >= 10);

  return { contract, patterns, score, interesting };
}

export function formatResult(result: AnalysisResult): string {
  const lines = [
    `\n${"=".repeat(60)}`,
    `Contract: ${result.contract.address}`,
    `Chain:    ${result.contract.chain}`,
    `Deployer: ${result.contract.deployer}`,
    `Tx:       ${result.contract.txHash}`,
    `Size:     ${(result.contract.bytecode.length - 2) / 2} bytes`,
    `Score:    ${result.score}/100`,
    ``,
  ];

  if (result.patterns.length > 0) {
    lines.push("Findings:");
    for (const p of result.patterns) {
      lines.push(`  [${p.severity.toUpperCase()}] ${p.name}: ${p.description}`);
    }
  } else {
    lines.push("No patterns matched.");
  }

  lines.push("=".repeat(60));
  return lines.join("\n");
}
