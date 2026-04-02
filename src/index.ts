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
║ LLM:          Gemini 2.0 Flash (free tier)        ║
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

    // Start server first so UI is available even if pipeline is slow
    const port = process.env.PORT || "3000";
    startServer();

    // Run pipeline in background — server stays up even if pipeline errors
    runPipeline()
      .then(() => {
        console.log(`\nPipeline complete. Open http://localhost:${port} to review pending actions.`);
      })
      .catch((err) => {
        console.error("Pipeline error (server still running):", err);
      });
  } else {
    console.error(`Unknown mode: "${mode}". Valid modes: pipeline, heartbeat, server, eval, demo`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
