import type { PipelineResult } from "../detectors/pipeline.js";
import type { ExecutionResult } from "../executor/index.js";

const EXPLORER_URLS: Record<string, string> = {
  ethereum: "https://etherscan.io",
  arbitrum: "https://arbiscan.io",
  base: "https://basescan.org",
};

export class TelegramAlert {
  private botToken: string;
  private chatId: string;
  private apiBase: string;

  constructor() {
    this.botToken = process.env.TG_BOT_TOKEN || "";
    this.chatId = process.env.TG_CHAT_ID || "";
    this.apiBase = `https://api.telegram.org/bot${this.botToken}`;
  }

  get enabled(): boolean {
    return this.botToken !== "" && this.chatId !== "";
  }

  private async send(text: string) {
    if (!this.enabled) return;

    try {
      await fetch(`${this.apiBase}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });
    } catch (err) {
      console.error("[telegram] Failed to send alert:", err);
    }
  }

  async alertFinding(result: PipelineResult) {
    const explorer = EXPLORER_URLS[result.contract.chain] || "";
    const addressUrl = `${explorer}/address/${result.contract.address}`;
    const txUrl = `${explorer}/tx/${result.contract.txHash}`;

    const findings = result.findings
      .map((f) => `  <b>[${f.severity.toUpperCase()}]</b> ${f.detector} → ${f.title}`)
      .join("\n");

    const balances = result.meta.estimatedUsd
      ? `\n💰 Est. value: ~$${result.meta.estimatedUsd}`
      : "";

    const text = [
      `🚨 <b>Backdraft Alert — Score ${result.score}/100</b>`,
      ``,
      `<b>Chain:</b> ${result.contract.chain}`,
      `<b>Contract:</b> <a href="${addressUrl}">${result.contract.address}</a>`,
      `<b>Deployer:</b> <code>${result.contract.deployer}</code>`,
      `<b>Tx:</b> <a href="${txUrl}">${result.contract.txHash.slice(0, 18)}…</a>`,
      `<b>Tags:</b> ${[...result.tags].join(", ") || "none"}${balances}`,
      ``,
      `<b>Findings:</b>`,
      findings,
    ].join("\n");

    await this.send(text);
  }

  async alertExecution(result: PipelineResult, execResults: ExecutionResult[]) {
    const explorer = EXPLORER_URLS[result.contract.chain] || "";

    const lines = execResults.map((e) => {
      const status = e.success ? "✅" : "❌";
      const mode = e.simulated ? "(simulated)" : "(LIVE)";
      const txLink = e.txHash ? `<a href="${explorer}/tx/${e.txHash}">tx</a>` : "";
      return `  ${status} ${e.action} ${mode} ${txLink}`;
    });

    const text = [
      `⚡ <b>Execution ${execResults.some(e => e.success && !e.simulated) ? "SUCCESS" : "attempted"}</b>`,
      ``,
      `<b>Contract:</b> <code>${result.contract.address}</code>`,
      `<b>Chain:</b> ${result.contract.chain}`,
      ``,
      ...lines,
    ].join("\n");

    await this.send(text);
  }
}
