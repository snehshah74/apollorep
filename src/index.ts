// Entry point for ApolloRep — routes to the correct run mode based on argv.
// Supports pipeline, heartbeat, server, eval, and demo modes from a single binary.
// Demo mode is the default: runs the pipeline then starts the approval server.

import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { getTrustLevel, getTrustLevelDescription } from "./trust/trustModel";
import { loadAllAccounts } from "./tools/crmLookup";

async function main() {
  const mode = process.argv[2] || "demo";

  const trustLevel = getTrustLevel();
  const trustDesc = getTrustLevelDescription(trustLevel);
  const accounts = await loadAllAccounts();

  const fromEmail = process.env.FROM_EMAIL || "apollorep@yourdomain.com";

  console.log(`
╔═══════════════════════════════════════════════════╗
║                  ApolloRep v1.0                   ║
║         Autonomous GTM Agent Prototype            ║
╠═══════════════════════════════════════════════════╣
║ Mode:         ${mode.padEnd(34)} ║
║ Trust Level:  ${String(trustLevel).padEnd(2)} — ${trustDesc.slice(0, 29).padEnd(30)} ║
║ Monitoring:   ${String(accounts.length).padEnd(2)} accounts                        ║
║ LLM:          Gemini 1.5 Flash (free tier)        ║
║ Email:        Resend (${fromEmail.slice(0, 27).padEnd(27)})║
╚═══════════════════════════════════════════════════╝`);

  if (mode === "pipeline") {
    const { runPipeline } = await import("./agents/orchestrator");
    await runPipeline();
    process.exit(0);
  } else if (mode === "heartbeat") {
    const { startHeartbeat } = await import("./agents/orchestrator");
    startHeartbeat();
    // Keep process alive
    setInterval(() => {}, 1000 * 60 * 60);
  } else if (mode === "server") {
    const { startServer } = await import("./server/approvalServer");
    startServer();
  } else if (mode === "eval") {
    // Eval module runs itself when imported
    await import("./eval/evaluator");
  } else if (mode === "demo") {
    const { runPipeline } = await import("./agents/orchestrator");
    const { startServer } = await import("./server/approvalServer");

    await runPipeline();

    const port = process.env.PORT || "3000";
    startServer();

    console.log(`
Pipeline complete. Approval UI running at http://localhost:${port}
Open your browser to review and approve pending actions.
    `);
  } else {
    console.error(`Unknown mode: "${mode}". Valid modes: pipeline, heartbeat, server, eval, demo`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
