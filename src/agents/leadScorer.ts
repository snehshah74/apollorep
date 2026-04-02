// Scores and ranks accounts with signals using a structured 100-point rubric.
// Second pipeline stage — turns signal intelligence into a prioritized lead list.
// Score breakdown is surfaced to reps so they trust the ranking, not just the number.

import { callGemini } from "../lib/gemini";
import { Account, Contact } from "../tools/crmLookup";
import { MonitoredSignal } from "./signalMonitor";

export interface ScoredLead {
  accountId: string;
  company: string;
  contact: Contact;
  totalScore: number;
  scoreBreakdown: {
    icpFit: number;
    signalStrength: number;
    signalCount: number;
    recency: number;
  };
  topSignal: MonitoredSignal;
  allSignals: MonitoredSignal[];
  recommendedAction: string;
  scoringRationale: string;
}

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

const SYSTEM_PROMPT = `You are a revenue operations analyst. Score each lead from 0-100 using this exact breakdown: ICP fit (0-25 based on company size, industry, and current tech stack fit for a sales engagement platform), signal strength (0-35 based on the strongest single signal's relevance and urgency), signal count bonus (0-20, more signals = higher score — 1 signal = 5, 2 signals = 12, 3+ signals = 20), recency (0-20 based on how recent the signals are — signals from today score 20, signals from a week ago score 10). For each lead also provide a recommended action (one of: immediate_outreach, add_to_sequence, monitor, deprioritize) and a 2-3 sentence rationale explaining the score. Return a JSON array sorted by totalScore descending. Each element must have: accountId, totalScore, scoreBreakdown (object with icpFit, signalStrength, signalCount, recency), recommendedAction, scoringRationale.`;

interface GeminiScoreResult {
  accountId: string;
  totalScore: number;
  scoreBreakdown: {
    icpFit: number;
    signalStrength: number;
    signalCount: number;
    recency: number;
  };
  recommendedAction: string;
  scoringRationale: string;
}

export async function scoreLeads(
  signalMap: Map<string, MonitoredSignal[]>,
  accounts: Account[]
): Promise<ScoredLead[]> {
  const accountsWithSignals = accounts.filter(
    (a) => signalMap.has(a.id) && (signalMap.get(a.id)?.length ?? 0) > 0
  );

  if (accountsWithSignals.length === 0) {
    console.log(`[${timestamp()}] [LeadScorer] No accounts with signals to score`);
    return [];
  }

  console.log(
    `[${timestamp()}] [LeadScorer] Scoring ${accountsWithSignals.length} accounts with signals`
  );

  // Build rich context payload for Gemini
  const scoringPayload = accountsWithSignals.map((account) => {
    const signals = signalMap.get(account.id) || [];
    return {
      accountId: account.id,
      company: account.company,
      industry: account.industry,
      employees: account.employees,
      icpScore: account.icpScore,
      currentStack: account.currentStack,
      lastContactedDaysAgo: account.lastContactedDaysAgo,
      signals: signals.map((s) => ({
        type: s.type,
        strength: s.strength,
        relevanceScore: s.relevanceScore,
        urgency: s.urgency,
        buyingStageGuess: s.buyingStageGuess,
        detectedAt: s.detectedAt,
        aiSummary: s.aiSummary,
      })),
    };
  });

  const rawResponse = await callGemini(
    SYSTEM_PROMPT,
    JSON.stringify(scoringPayload),
    true
  );

  let geminiScores: GeminiScoreResult[] = [];

  if (rawResponse) {
    try {
      const parsed = JSON.parse(rawResponse);
      geminiScores = Array.isArray(parsed) ? parsed : [];
    } catch (parseError) {
      console.error(
        `[${timestamp()}] [LeadScorer] Failed to parse Gemini scores. Raw: ${rawResponse.slice(0, 200)}`
      );
      // Fallback: heuristic scoring
      geminiScores = accountsWithSignals.map((account) => {
        const signals = signalMap.get(account.id) || [];
        const topStrength = Math.max(...signals.map((s) => s.strength));
        const icpFit = Math.round((account.icpScore / 10) * 25);
        const signalStrength = Math.round((topStrength / 10) * 35);
        const signalCountScore = signals.length === 1 ? 5 : signals.length === 2 ? 12 : 20;
        const recency = 15; // middle value as fallback
        return {
          accountId: account.id,
          totalScore: Math.min(100, icpFit + signalStrength + signalCountScore + recency),
          scoreBreakdown: { icpFit, signalStrength, signalCount: signalCountScore, recency },
          recommendedAction: topStrength >= 8 ? "immediate_outreach" : "add_to_sequence",
          scoringRationale: `Account has ${signals.length} signal(s) with peak strength ${topStrength}/10 and an ICP score of ${account.icpScore}/10.`,
        };
      });
    }
  } else {
    console.warn(
      `[${timestamp()}] [LeadScorer] Empty Gemini response, using heuristic scoring`
    );
    geminiScores = accountsWithSignals.map((account) => {
      const signals = signalMap.get(account.id) || [];
      const topStrength = Math.max(...signals.map((s) => s.strength));
      const icpFit = Math.round((account.icpScore / 10) * 25);
      const signalStrength = Math.round((topStrength / 10) * 35);
      const signalCountScore = signals.length === 1 ? 5 : signals.length === 2 ? 12 : 20;
      return {
        accountId: account.id,
        totalScore: Math.min(100, icpFit + signalStrength + signalCountScore + 15),
        scoreBreakdown: { icpFit, signalStrength, signalCount: signalCountScore, recency: 15 },
        recommendedAction: topStrength >= 8 ? "immediate_outreach" : "add_to_sequence",
        scoringRationale: `Heuristic score: ${signals.length} signal(s), ICP ${account.icpScore}/10.`,
      };
    });
  }

  // Merge Gemini scores with account and signal data
  const scoredLeads: ScoredLead[] = geminiScores
    .map((score) => {
      const account = accounts.find((a) => a.id === score.accountId);
      if (!account) return null;

      const signals = signalMap.get(score.accountId) || [];
      const topSignal = signals.reduce((best, s) =>
        s.relevanceScore > best.relevanceScore ? s : best
      );

      return {
        accountId: score.accountId,
        company: account.company,
        contact: account.mainContact,
        totalScore: score.totalScore,
        scoreBreakdown: score.scoreBreakdown,
        topSignal,
        allSignals: signals,
        recommendedAction: score.recommendedAction,
        scoringRationale: score.scoringRationale,
      };
    })
    .filter((lead): lead is ScoredLead => lead !== null)
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 5);

  scoredLeads.forEach((lead) => {
    console.log(
      `[${timestamp()}] [LeadScorer] ${lead.company}: ${lead.totalScore}/100 — ${lead.recommendedAction}`
    );
  });

  return scoredLeads;
}
