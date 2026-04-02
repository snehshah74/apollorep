// Scans all target accounts for buying signals and enriches them with AI analysis.
// First stage in the pipeline — transforms raw signals into actionable intelligence.
// Batches all Gemini analysis into one call per run to stay within free-tier rate limits.

import { callGemini } from "../lib/gemini";
import { searchSignals, Signal } from "../tools/webSearch";
import { Account } from "../tools/crmLookup";

export interface MonitoredSignal extends Signal {
  relevanceScore: number;
  buyingStageGuess: string;
  urgency: "low" | "medium" | "high";
  aiSummary: string;
}

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

const SYSTEM_PROMPT = `You are a B2B sales intelligence analyst specializing in identifying purchase intent signals. Analyze the following buying signals and for each one determine: relevance to a sales engagement platform purchase (1-10), likely buying stage, urgency level, and a brief plain-English summary of why this signal matters. Return a JSON array matching the input array with these four fields added to each signal object: relevanceScore (number 1-10), buyingStageGuess (string: "awareness" | "consideration" | "decision"), urgency (string: "low" | "medium" | "high"), aiSummary (string, 1-2 sentences).`;

export async function monitorSignals(
  accounts: Account[]
): Promise<Map<string, MonitoredSignal[]>> {
  console.log(
    `[${timestamp()}] [SignalMonitor] Starting signal scan for ${accounts.length} accounts`
  );

  const signalMap = new Map<string, MonitoredSignal[]>();
  const allRawSignals: Signal[] = [];
  const accountsWithSignals: string[] = [];

  // Collect all signals across all accounts
  for (const account of accounts) {
    const signals = await searchSignals(account.id);
    if (signals.length > 0) {
      allRawSignals.push(...signals);
      accountsWithSignals.push(account.id);
    }
  }

  if (allRawSignals.length === 0) {
    console.log(`[${timestamp()}] [SignalMonitor] No signals found across any accounts`);
    return signalMap;
  }

  console.log(
    `[${timestamp()}] [SignalMonitor] Sending ${allRawSignals.length} signals to Gemini for analysis`
  );

  // Single batched Gemini call for all signals to minimize API calls
  const rawResponse = await callGemini(
    SYSTEM_PROMPT,
    JSON.stringify(allRawSignals),
    true
  );

  let enrichedSignals: MonitoredSignal[] = [];

  if (rawResponse) {
    try {
      const parsed = JSON.parse(rawResponse);
      enrichedSignals = Array.isArray(parsed) ? parsed : allRawSignals.map(s => ({
        ...s,
        relevanceScore: s.strength,
        buyingStageGuess: "consideration",
        urgency: s.strength >= 8 ? "high" : s.strength >= 5 ? "medium" : "low",
        aiSummary: s.summary,
      }));
    } catch (parseError) {
      console.error(
        `[${timestamp()}] [SignalMonitor] Failed to parse Gemini response, using fallback enrichment. Raw: ${rawResponse.slice(0, 200)}`
      );
      // Graceful fallback: enrich with heuristics
      enrichedSignals = allRawSignals.map((s) => ({
        ...s,
        relevanceScore: s.strength,
        buyingStageGuess: s.strength >= 8 ? "decision" : s.strength >= 5 ? "consideration" : "awareness",
        urgency: (s.strength >= 8 ? "high" : s.strength >= 5 ? "medium" : "low") as "low" | "medium" | "high",
        aiSummary: s.summary,
      }));
    }
  } else {
    console.warn(
      `[${timestamp()}] [SignalMonitor] Empty Gemini response, using heuristic enrichment`
    );
    enrichedSignals = allRawSignals.map((s) => ({
      ...s,
      relevanceScore: s.strength,
      buyingStageGuess: s.strength >= 8 ? "decision" : s.strength >= 5 ? "consideration" : "awareness",
      urgency: (s.strength >= 8 ? "high" : s.strength >= 5 ? "medium" : "low") as "low" | "medium" | "high",
      aiSummary: s.summary,
    }));
  }

  // Group enriched signals back by accountId
  for (const signal of enrichedSignals) {
    const existing = signalMap.get(signal.accountId) || [];
    existing.push(signal as MonitoredSignal);
    signalMap.set(signal.accountId, existing);
  }

  console.log(
    `[${timestamp()}] [SignalMonitor] Signal monitoring complete: ${enrichedSignals.length} signals across ${signalMap.size} accounts`
  );

  return signalMap;
}
