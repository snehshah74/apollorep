// Simulates real-time web search to discover buying signals for a given account.
// Sits at the input edge of the pipeline, feeding raw signals to the signal monitor agent.
// Uses local JSON for prototype; production would fan out to multiple signal APIs.

import * as fs from "fs";
import * as path from "path";

export interface Signal {
  id: string;
  accountId: string;
  type:
    | "job_posting"
    | "funding_round"
    | "leadership_change"
    | "competitor_churn"
    | "tech_stack_change"
    | "intent_data";
  summary: string;
  detectedAt: string;
  strength: number;
  sourceUrl: string;
}

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

export async function searchSignals(accountId: string): Promise<Signal[]> {
  // Simulate network latency of a real API call
  await new Promise((resolve) => setTimeout(resolve, 300));

  try {
    const signalsPath = path.join(__dirname, "../data/signals.json");
    const raw = fs.readFileSync(signalsPath, "utf-8");
    const allSignals: Signal[] = JSON.parse(raw);
    const filtered = allSignals.filter((s) => s.accountId === accountId);
    console.log(
      `[${timestamp()}] [WebSearch] Signal search for ${accountId}: found ${filtered.length} signals`
    );
    return filtered;
  } catch (error) {
    console.error(
      `[${timestamp()}] [WebSearch] Error reading signals for ${accountId}:`,
      error
    );
    return [];
  }

  // PRODUCTION_EXTENSION: In production this would call Bombora intent API,
  // Apollo's own signal detection, or a webhook listener for real-time events
  // from LinkedIn, Crunchbase, G2. Each source would be called in parallel with
  // Promise.all() and results deduplicated by signal fingerprint before returning.
}
