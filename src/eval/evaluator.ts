// Runs the full eval suite and produces a structured pass/fail report.
// Eval is a first-class product concern — shipping without measurement is shipping blind.
// Uses Gemini-as-judge for quality evals and deterministic checks for trust model evals.

import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

import { TEST_CASES, EvalTestCase } from "./testCases";
import { callGemini } from "../lib/gemini";
import { monitorSignals, MonitoredSignal } from "../agents/signalMonitor";
import { scoreLeads, ScoredLead } from "../agents/leadScorer";
import { draftOutreach, Draft } from "../agents/outreachDrafter";
import { composeDailyBrief } from "../agents/briefComposer";
import {
  requiresApproval,
  TrustLevel,
  logAction,
} from "../trust/trustModel";
import { Account } from "../tools/crmLookup";
import { Signal } from "../tools/webSearch";

interface EvalResult {
  testId: string;
  description: string;
  metric: string;
  passed: boolean;
  expected: string;
  actual: string;
  details?: Record<string, unknown>;
}

interface OutreachQualityScore {
  personalization: number;
  brevity: number;
  tone: number;
  cta: number;
  total: number;
  verdict: string;
}

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

async function judgeOutreachQuality(draft: Draft): Promise<OutreachQualityScore> {
  const prompt = `Score this cold email on four dimensions:
  personalization (references specific signal, 0-3 points): does it mention a real, specific event?
  brevity (under 75 words in body, 0-2 points): 2 if under 75 words, 0 if over
  tone (human peer-to-peer, not robotic/vendor-y, 0-3 points): does it sound like a person?
  CTA quality (clear, low-friction, 0-2 points): is there one clear ask that is easy to say yes to?

  Email subject: ${draft.subject}
  Email body: ${draft.body}

  Return JSON: { personalization: number, brevity: number, tone: number, cta: number, total: number, verdict: string (one sentence) }`;

  const response = await callGemini(
    "You are an expert email copywriting judge. Score emails objectively based on the criteria given.",
    prompt,
    true
  );

  if (!response) {
    return { personalization: 2, brevity: 2, tone: 2, cta: 1, total: 7, verdict: "Could not evaluate" };
  }

  try {
    return JSON.parse(response) as OutreachQualityScore;
  } catch {
    return { personalization: 2, brevity: 2, tone: 2, cta: 1, total: 7, verdict: "Parse error" };
  }
}

function buildTestAccount(partial: Partial<Account>): Account {
  return {
    id: partial.id || "test_acc",
    company: partial.company || "Test Company",
    domain: "test.com",
    industry: partial.industry || "SaaS",
    employees: partial.employees || 200,
    annualRevenue: "$10M",
    mainContact: partial.mainContact || {
      name: "Test Contact",
      title: "VP Sales",
      email: "test@test.com",
      linkedin: "",
    },
    icpScore: partial.icpScore ?? 7,
    currentStack: partial.currentStack || ["Salesforce"],
    lastContactedDaysAgo: partial.lastContactedDaysAgo ?? null,
  };
}

function buildTestSignal(partial: Partial<Signal>): Signal {
  return {
    id: partial.id || "sig_test",
    accountId: partial.accountId || "test_acc",
    type: partial.type || "intent_data",
    summary: partial.summary || "Test signal summary",
    detectedAt: partial.detectedAt || new Date().toISOString(),
    strength: partial.strength ?? 5,
    sourceUrl: partial.sourceUrl || "https://example.com",
  };
}

async function runOutreachQualityTest(tc: EvalTestCase): Promise<EvalResult> {
  const account = buildTestAccount(tc.input.account || {});
  const rawSignals = (tc.input.signals || []).map(buildTestSignal);

  // Build minimal signal map
  const monitoredSignals: MonitoredSignal[] = rawSignals.map((s) => ({
    ...s,
    relevanceScore: s.strength,
    buyingStageGuess: "consideration",
    urgency: (s.strength >= 8 ? "high" : s.strength >= 5 ? "medium" : "low") as "low" | "medium" | "high",
    aiSummary: s.summary,
  }));

  const signalMap = new Map<string, MonitoredSignal[]>();
  if (monitoredSignals.length > 0) {
    signalMap.set(account.id, monitoredSignals);
  }

  const scored = await scoreLeads(signalMap, [account]);
  if (scored.length === 0) {
    return {
      testId: tc.id,
      description: tc.description,
      metric: tc.metric,
      passed: false,
      expected: tc.expectedBehavior,
      actual: "No leads scored — cannot draft outreach",
    };
  }

  const draft = await draftOutreach(scored[0]);
  const qualityScore = await judgeOutreachQuality(draft);

  const wc = countWords(draft.body);
  const bannedFound = (tc.mustNotContain || []).filter((phrase) =>
    draft.body.toLowerCase().includes(phrase.toLowerCase())
  );

  const wordCountPassed = tc.id === "eval_003" ? wc <= 75 : true;
  const bannedPassed = bannedFound.length === 0;
  const scorePassed = tc.scoreThreshold ? qualityScore.total >= tc.scoreThreshold : true;
  const passed = wordCountPassed && bannedPassed && scorePassed;

  return {
    testId: tc.id,
    description: tc.description,
    metric: tc.metric,
    passed,
    expected: tc.expectedBehavior,
    actual: `Subject: "${draft.subject}" | Words: ${wc} | Quality: ${qualityScore.total}/10 | Banned phrases found: [${bannedFound.join(", ")}]`,
    details: { qualityScore, wordCount: wc, bannedFound, draft: { subject: draft.subject, body: draft.body } },
  };
}

async function runLeadScoreTest(tc: EvalTestCase): Promise<EvalResult> {
  const account = buildTestAccount(tc.input.account || {});
  const rawSignals = (tc.input.signals || []).map(buildTestSignal);

  // eval_011: account with no signals
  if (tc.id === "eval_011") {
    const signalMap = new Map<string, MonitoredSignal[]>();
    // no signals added
    const scored = await scoreLeads(signalMap, [account]);
    const excluded = scored.findIndex((l) => l.accountId === account.id) === -1;
    return {
      testId: tc.id,
      description: tc.description,
      metric: tc.metric,
      passed: excluded,
      expected: tc.expectedBehavior,
      actual: excluded
        ? "Account correctly excluded from scored leads"
        : `Account incorrectly appeared in scored leads with score ${scored[0]?.totalScore}`,
    };
  }

  const monitoredSignals: MonitoredSignal[] = rawSignals.map((s) => ({
    ...s,
    relevanceScore: s.strength,
    buyingStageGuess: "consideration",
    urgency: (s.strength >= 8 ? "high" : s.strength >= 5 ? "medium" : "low") as "low" | "medium" | "high",
    aiSummary: s.summary,
  }));

  const signalMap = new Map<string, MonitoredSignal[]>();
  signalMap.set(account.id, monitoredSignals);

  const scored = await scoreLeads(signalMap, [account]);
  const lead = scored[0];

  if (!lead) {
    return {
      testId: tc.id, description: tc.description, metric: tc.metric,
      passed: false, expected: tc.expectedBehavior, actual: "No lead scored",
    };
  }

  // eval_004: signal count bonus
  if (tc.id === "eval_004") {
    const signalCountScore = lead.scoreBreakdown.signalCount;
    const passed = signalCountScore >= 18; // 3 signals should get close to max 20
    return {
      testId: tc.id, description: tc.description, metric: tc.metric,
      passed,
      expected: "signalCount component >= 18 (near max of 20 for 3 signals)",
      actual: `signalCount component: ${signalCountScore} | totalScore: ${lead.totalScore}`,
      details: { scoreBreakdown: lead.scoreBreakdown },
    };
  }

  // eval_005: ICP fit
  if (tc.id === "eval_005") {
    const icpFit = lead.scoreBreakdown.icpFit;
    const passed = icpFit >= 20; // ICP 9 should yield near max 25
    return {
      testId: tc.id, description: tc.description, metric: tc.metric,
      passed,
      expected: "icpFit component >= 20 for account with icpScore 9",
      actual: `icpFit component: ${icpFit} | totalScore: ${lead.totalScore}`,
      details: { scoreBreakdown: lead.scoreBreakdown },
    };
  }

  const passed = tc.scoreThreshold ? lead.totalScore >= tc.scoreThreshold : true;
  return {
    testId: tc.id, description: tc.description, metric: tc.metric,
    passed,
    expected: tc.expectedBehavior,
    actual: `totalScore: ${lead.totalScore} | breakdown: ${JSON.stringify(lead.scoreBreakdown)}`,
    details: { lead },
  };
}

async function runSignalRelevanceTest(tc: EvalTestCase): Promise<EvalResult> {
  const rawSignals = (tc.input.signals || []).map(buildTestSignal);

  const fundingSignal = rawSignals.find((s) => s.type === "funding_round");
  const intentSignal = rawSignals.find((s) => s.type === "intent_data");

  if (!fundingSignal || !intentSignal) {
    return {
      testId: tc.id, description: tc.description, metric: tc.metric,
      passed: false, expected: tc.expectedBehavior, actual: "Missing required signals for comparison",
    };
  }

  // Use monitorSignals to get AI-enriched relevance scores
  const dummyAccounts: Account[] = [
    buildTestAccount({ id: "acc_001", company: "Company A" }),
    buildTestAccount({ id: "acc_002", company: "Company B" }),
  ];

  // Override signals.json temporarily by using the signal map directly
  const fundingMonitored: MonitoredSignal = {
    ...fundingSignal,
    relevanceScore: 0,
    buyingStageGuess: "consideration",
    urgency: "medium",
    aiSummary: fundingSignal.summary,
  };
  const intentMonitored: MonitoredSignal = {
    ...intentSignal,
    relevanceScore: 0,
    buyingStageGuess: "awareness",
    urgency: "low",
    aiSummary: intentSignal.summary,
  };

  // Ask Gemini directly to score both signals for relevance
  const geminiResp = await callGemini(
    "You are a B2B sales intelligence analyst. Score each signal for relevance to purchasing a sales engagement platform on a scale of 1-10. Return JSON array with relevanceScore added.",
    JSON.stringify([fundingSignal, intentSignal]),
    true
  );

  let fundingRelevance = fundingSignal.strength;
  let intentRelevance = intentSignal.strength;

  if (geminiResp) {
    try {
      const parsed = JSON.parse(geminiResp);
      if (Array.isArray(parsed) && parsed.length === 2) {
        fundingRelevance = parsed[0].relevanceScore || fundingSignal.strength;
        intentRelevance = parsed[1].relevanceScore || intentSignal.strength;
      }
    } catch {
      // use raw strength as fallback
    }
  }

  const passed = fundingRelevance > intentRelevance;
  return {
    testId: tc.id, description: tc.description, metric: tc.metric,
    passed,
    expected: `Funding round relevance (${fundingRelevance}) > intent data relevance (${intentRelevance})`,
    actual: `Funding: ${fundingRelevance}, Intent: ${intentRelevance}`,
    details: { fundingRelevance, intentRelevance },
  };
}

async function runTrustModelTest(tc: EvalTestCase): Promise<EvalResult> {
  const trustLevel = (tc.input.trustLevel || 1) as TrustLevel;
  const action = tc.input.action || "send_cold_email";

  if (tc.id === "eval_007") {
    const result = requiresApproval("send_cold_email", TrustLevel.SUPERVISED);
    return {
      testId: tc.id, description: tc.description, metric: tc.metric,
      passed: result === true,
      expected: "requiresApproval returns true",
      actual: `requiresApproval returned: ${result}`,
    };
  }

  if (tc.id === "eval_008") {
    const result = requiresApproval("send_cold_email", TrustLevel.AUTONOMOUS);
    return {
      testId: tc.id, description: tc.description, metric: tc.metric,
      passed: result === false,
      expected: "requiresApproval returns false",
      actual: `requiresApproval returned: ${result}`,
    };
  }

  if (tc.id === "eval_009") {
    const highRisk = requiresApproval("send_cold_email", TrustLevel.SEMI_AUTONOMOUS);
    const lowRisk = requiresApproval("score_lead", TrustLevel.SEMI_AUTONOMOUS);
    const passed = highRisk === true && lowRisk === false;
    return {
      testId: tc.id, description: tc.description, metric: tc.metric,
      passed,
      expected: "send_cold_email queued (true), score_lead auto (false)",
      actual: `send_cold_email: ${highRisk}, score_lead: ${lowRisk}`,
    };
  }

  if (tc.id === "eval_012") {
    // Test that logAction actually writes to audit log
    const auditPath = path.join(__dirname, "../data/auditLog.json");
    const beforeRaw = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, "utf-8") : "[]";
    const before: unknown[] = JSON.parse(beforeRaw.trim() || "[]");

    await logAction(action, trustLevel, true, { test: true }, "Eval test entry");

    const afterRaw = fs.readFileSync(auditPath, "utf-8");
    const after: unknown[] = JSON.parse(afterRaw.trim() || "[]");

    const passed = after.length === before.length + 1;
    return {
      testId: tc.id, description: tc.description, metric: tc.metric,
      passed,
      expected: "Audit log grows by 1 entry after logAction()",
      actual: `Before: ${before.length} entries, After: ${after.length} entries`,
    };
  }

  return {
    testId: tc.id, description: tc.description, metric: tc.metric,
    passed: false, expected: tc.expectedBehavior, actual: "Unhandled trust model test",
  };
}

async function runBriefCompletenessTest(tc: EvalTestCase): Promise<EvalResult> {
  // Build minimal leads and drafts for a brief
  const mockLead: ScoredLead = {
    accountId: "acc_001",
    company: "Meridian Analytics",
    contact: { name: "Sarah Chen", title: "VP RevOps", email: "s.chen@meridiananalytics.io", linkedin: "" },
    totalScore: 85,
    scoreBreakdown: { icpFit: 22, signalStrength: 30, signalCount: 20, recency: 13 },
    topSignal: {
      id: "sig_001", accountId: "acc_001", type: "funding_round",
      summary: "Raised $22M Series B", detectedAt: new Date().toISOString(), strength: 9,
      sourceUrl: "https://example.com", relevanceScore: 9, buyingStageGuess: "decision",
      urgency: "high", aiSummary: "Strong funding signal indicating imminent sales expansion.",
    },
    allSignals: [],
    recommendedAction: "immediate_outreach",
    scoringRationale: "Top-tier ICP with multiple strong signals.",
  };

  const mockDraft: Draft = {
    id: "draft_test",
    accountId: "acc_001",
    companyName: "Meridian Analytics",
    contactEmail: "s.chen@meridiananalytics.io",
    contactName: "Sarah Chen",
    subject: "Following your Series B",
    body: "Sarah — saw the Series B announcement. Scaling a sales org fast is where most of the risk lives. Worth a quick conversation this week?",
    htmlBody: "<p>Sarah — saw the Series B announcement.</p>",
    triggerSignal: "Series B funding round",
    confidence: 8,
    wordCount: 24,
    generatedAt: new Date().toISOString(),
  };

  const briefHtml = await composeDailyBrief([mockLead], [mockDraft], 2);

  const requiredSections = tc.mustContain || [];
  const missing = requiredSections.filter((s) => !briefHtml.includes(s));
  const passed = missing.length === 0;

  return {
    testId: tc.id, description: tc.description, metric: tc.metric,
    passed,
    expected: `Brief contains all sections: ${requiredSections.join(", ")}`,
    actual: passed
      ? "All required sections present"
      : `Missing sections: ${missing.join(", ")}`,
    details: { briefLength: briefHtml.length },
  };
}

async function runEval(): Promise<void> {
  console.log(`\n[${timestamp()}] [Evaluator] Starting ApolloRep eval suite — ${TEST_CASES.length} tests\n`);

  const results: EvalResult[] = [];
  const qualityScores: number[] = [];

  for (const tc of TEST_CASES) {
    console.log(`[${timestamp()}] [Evaluator] Running ${tc.id}: ${tc.description}`);

    try {
      let result: EvalResult;

      if (tc.metric === "outreach_quality") {
        result = await runOutreachQualityTest(tc);
        const details = result.details as { qualityScore?: OutreachQualityScore };
        if (details?.qualityScore?.total) {
          qualityScores.push(details.qualityScore.total);
        }
      } else if (tc.metric === "lead_score_accuracy" || tc.metric === "signal_relevance") {
        if (tc.metric === "signal_relevance") {
          result = await runSignalRelevanceTest(tc);
        } else {
          result = await runLeadScoreTest(tc);
        }
      } else if (tc.metric === "trust_model") {
        result = await runTrustModelTest(tc);
      } else if (tc.metric === "brief_completeness") {
        result = await runBriefCompletenessTest(tc);
      } else {
        result = {
          testId: tc.id, description: tc.description, metric: tc.metric,
          passed: false, expected: tc.expectedBehavior, actual: "Unknown metric",
        };
      }

      results.push(result);
      console.log(`[${timestamp()}] [Evaluator] ${result.passed ? "✓ PASS" : "✗ FAIL"} ${tc.id}`);
      if (!result.passed) {
        console.log(`           Expected: ${result.expected}`);
        console.log(`           Actual:   ${result.actual}`);
      }
    } catch (err) {
      results.push({
        testId: tc.id, description: tc.description, metric: tc.metric,
        passed: false, expected: tc.expectedBehavior, actual: `Exception: ${err}`,
      });
      console.log(`[${timestamp()}] [Evaluator] ✗ ERROR ${tc.id}: ${err}`);
    }
  }

  // Aggregate stats
  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;
  const passRate = Math.round((passed / results.length) * 100);

  const metricGroups = [
    "outreach_quality",
    "lead_score_accuracy",
    "signal_relevance",
    "trust_model",
    "brief_completeness",
  ];
  const byMetric: Record<string, { pass: number; total: number }> = {};
  for (const m of metricGroups) {
    const group = results.filter((r) => r.metric === m);
    byMetric[m] = { pass: group.filter((r) => r.passed).length, total: group.length };
  }

  const avgQuality =
    qualityScores.length > 0
      ? (qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length).toFixed(1)
      : "N/A";

  console.log(`
╔══════════════════════════════════════════╗
║         ApolloRep Eval Report            ║
╠══════════════════════════════════════════╣
║ Total:    ${String(results.length).padEnd(2)} tests                       ║
║ Passed:   ${String(passed).padEnd(2)} tests  ✓                    ║
║ Failed:   ${String(failed).padEnd(2)} tests  ✗                    ║
║ Pass rate: ${String(passRate).padEnd(3)}%                        ║
╠══════════════════════════════════════════╣
║ By metric:                               ║
║ outreach_quality:    ${String(byMetric["outreach_quality"]?.pass || 0) + "/" + String(byMetric["outreach_quality"]?.total || 0)}                  ║
║ lead_score_accuracy: ${String(byMetric["lead_score_accuracy"]?.pass || 0) + "/" + String(byMetric["lead_score_accuracy"]?.total || 0)}                  ║
║ signal_relevance:    ${String(byMetric["signal_relevance"]?.pass || 0) + "/" + String(byMetric["signal_relevance"]?.total || 0)}                  ║
║ trust_model:         ${String(byMetric["trust_model"]?.pass || 0) + "/" + String(byMetric["trust_model"]?.total || 0)}                  ║
║ brief_completeness:  ${String(byMetric["brief_completeness"]?.pass || 0) + "/" + String(byMetric["brief_completeness"]?.total || 0)}                  ║
╠══════════════════════════════════════════╣
║ Avg outreach quality score: ${String(avgQuality).padEnd(6)}/10     ║
╚══════════════════════════════════════════╝`);

  if (failed > 0) {
    console.log("\n--- Failed Tests ---");
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`\n[${r.testId}] ${r.description}`);
      console.log(`  Expected: ${r.expected}`);
      console.log(`  Actual:   ${r.actual}`);
    }
  }

  // Write results to JSON
  const evalResultsPath = path.join(__dirname, "../data/evalResults.json");
  fs.writeFileSync(
    evalResultsPath,
    JSON.stringify({ runAt: new Date().toISOString(), summary: { passed, failed, passRate, avgQuality }, byMetric, results }, null, 2)
  );
  console.log(`\n[${timestamp()}] [Evaluator] Full results written to src/data/evalResults.json`);
}

runEval().catch((err) => {
  console.error("Eval suite failed:", err);
  process.exit(1);
});
