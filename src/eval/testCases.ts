// Defines the 12 eval test cases covering outreach quality, scoring accuracy, and trust model behavior.
// Test cases are data — keeping them separate from the runner makes it easy to add new ones.
// Eval coverage is a product concern: if we can't measure quality, we can't ship or improve with confidence.

import { Account } from "../tools/crmLookup";
import { Signal } from "../tools/webSearch";

export interface EvalTestCase {
  id: string;
  description: string;
  metric:
    | "outreach_quality"
    | "lead_score_accuracy"
    | "signal_relevance"
    | "trust_model"
    | "brief_completeness";
  input: {
    account?: Partial<Account>;
    signals?: Partial<Signal>[];
    trustLevel?: number;
    action?: string;
  };
  expectedBehavior: string;
  mustContain?: string[];
  mustNotContain?: string[];
  scoreThreshold?: number;
}

export const TEST_CASES: EvalTestCase[] = [
  {
    id: "eval_001",
    description: "Outreach email references a specific signal, not a generic opener",
    metric: "outreach_quality",
    input: {
      account: {
        id: "acc_001",
        company: "Meridian Analytics",
        industry: "SaaS",
        employees: 320,
        mainContact: { name: "Sarah Chen", title: "VP of Revenue Operations", email: "s.chen@meridiananalytics.io", linkedin: "" },
        icpScore: 9,
        currentStack: ["Salesforce", "Outreach", "ZoomInfo"],
        lastContactedDaysAgo: 45,
      },
      signals: [
        {
          id: "sig_001",
          accountId: "acc_001",
          type: "funding_round",
          summary: "Meridian Analytics closed a $22M Series B earmarked for go-to-market expansion.",
          detectedAt: new Date().toISOString(),
          strength: 9,
          sourceUrl: "https://techcrunch.com/meridian",
        },
      ],
    },
    expectedBehavior: "Email body should reference the funding round or go-to-market expansion naturally",
    mustContain: [],
    mustNotContain: [
      "I hope this finds you well",
      "I wanted to reach out",
      "touching base",
      "circle back",
      "synergy",
      "leverage",
    ],
    scoreThreshold: 6,
  },
  {
    id: "eval_002",
    description: "Outreach avoids all banned phrases",
    metric: "outreach_quality",
    input: {
      account: {
        id: "acc_007",
        company: "ShieldLayer Security",
        industry: "CyberSecurity",
        employees: 430,
        mainContact: { name: "Ryan Kosta", title: "CRO", email: "r.kosta@shieldlayer.io", linkedin: "" },
        icpScore: 8,
        currentStack: ["Salesforce", "Outreach"],
        lastContactedDaysAgo: 30,
      },
      signals: [
        {
          id: "sig_006",
          accountId: "acc_007",
          type: "competitor_churn",
          summary: "ShieldLayer employees posted G2 reviews indicating dissatisfaction with Outreach.",
          detectedAt: new Date().toISOString(),
          strength: 8,
          sourceUrl: "https://g2.com/shieldlayer",
        },
      ],
    },
    expectedBehavior: "Email must not contain banned sales clichés",
    mustNotContain: [
      "I hope this finds you well",
      "I wanted to reach out",
      "touching base",
      "circle back",
      "synergy",
      "leverage",
      "quick call",
      "reach out",
    ],
    scoreThreshold: 6,
  },
  {
    id: "eval_003",
    description: "Outreach body stays under 75 words",
    metric: "outreach_quality",
    input: {
      account: {
        id: "acc_003",
        company: "Pulse Health Systems",
        industry: "HealthTech",
        employees: 750,
        mainContact: { name: "Dr. Priya Nair", title: "CGO", email: "p.nair@pulsehealthsystems.com", linkedin: "" },
        icpScore: 8,
        currentStack: ["Salesforce", "Marketo"],
        lastContactedDaysAgo: 12,
      },
      signals: [
        {
          id: "sig_004",
          accountId: "acc_003",
          type: "funding_round",
          summary: "Pulse Health raised $40M Series C to triple sales team.",
          detectedAt: new Date().toISOString(),
          strength: 8,
          sourceUrl: "https://businesswire.com/pulse",
        },
      ],
    },
    expectedBehavior: "Email body word count must be 75 or fewer words",
    scoreThreshold: 0, // word count check handled by evaluator
  },
  {
    id: "eval_004",
    description: "Lead with 3 signals scores higher than lead with 1 signal (same ICP)",
    metric: "lead_score_accuracy",
    input: {
      account: {
        id: "acc_001",
        company: "Meridian Analytics",
        industry: "SaaS",
        employees: 320,
        mainContact: { name: "Sarah Chen", title: "VP RevOps", email: "s.chen@meridiananalytics.io", linkedin: "" },
        icpScore: 8,
        currentStack: ["Salesforce", "Outreach"],
        lastContactedDaysAgo: 45,
      },
      signals: [
        { id: "sig_a", accountId: "acc_001", type: "funding_round", summary: "Raised Series B", detectedAt: new Date().toISOString(), strength: 7, sourceUrl: "https://example.com" },
        { id: "sig_b", accountId: "acc_001", type: "job_posting", summary: "Hiring sales roles", detectedAt: new Date().toISOString(), strength: 7, sourceUrl: "https://example.com" },
        { id: "sig_c", accountId: "acc_001", type: "leadership_change", summary: "New VP Sales hired", detectedAt: new Date().toISOString(), strength: 7, sourceUrl: "https://example.com" },
      ],
    },
    expectedBehavior: "Account with 3 signals should score at least 15 points higher than equivalent account with 1 signal (signal count bonus: 20 vs 5)",
    scoreThreshold: 60,
  },
  {
    id: "eval_005",
    description: "High ICP score (9) outranks low ICP (3) with same signal",
    metric: "lead_score_accuracy",
    input: {
      account: {
        id: "acc_001",
        company: "Meridian Analytics",
        industry: "SaaS",
        employees: 320,
        mainContact: { name: "Sarah Chen", title: "VP RevOps", email: "s.chen@meridiananalytics.io", linkedin: "" },
        icpScore: 9,
        currentStack: ["Salesforce", "Outreach"],
        lastContactedDaysAgo: 45,
      },
      signals: [
        { id: "sig_x", accountId: "acc_001", type: "intent_data", summary: "Researching sales tools", detectedAt: new Date().toISOString(), strength: 5, sourceUrl: "https://example.com" },
      ],
    },
    expectedBehavior: "High ICP account (score 9) with same signal should produce icpFit component near 22-25 out of 25",
    scoreThreshold: 50,
  },
  {
    id: "eval_006",
    description: "Funding round signal produces higher relevance score than intent_data signal",
    metric: "signal_relevance",
    input: {
      signals: [
        { id: "sig_fund", accountId: "acc_001", type: "funding_round", summary: "Raised $20M Series B for GTM expansion", detectedAt: new Date().toISOString(), strength: 9, sourceUrl: "https://example.com" },
        { id: "sig_intent", accountId: "acc_002", type: "intent_data", summary: "Some employees viewed sales tool comparison pages", detectedAt: new Date().toISOString(), strength: 4, sourceUrl: "https://example.com" },
      ],
    },
    expectedBehavior: "Funding round signal should have higher relevanceScore than intent_data signal with lower base strength",
    scoreThreshold: 7,
  },
  {
    id: "eval_007",
    description: "TRUST_LEVEL=1 queues all high-risk actions (never auto-sends)",
    metric: "trust_model",
    input: {
      trustLevel: 1,
      action: "send_cold_email",
    },
    expectedBehavior: "requiresApproval('send_cold_email', SUPERVISED) must return true",
  },
  {
    id: "eval_008",
    description: "TRUST_LEVEL=3 auto-executes all actions (nothing queued)",
    metric: "trust_model",
    input: {
      trustLevel: 3,
      action: "send_cold_email",
    },
    expectedBehavior: "requiresApproval('send_cold_email', AUTONOMOUS) must return false",
  },
  {
    id: "eval_009",
    description: "TRUST_LEVEL=2 queues high-risk, auto-executes low-risk",
    metric: "trust_model",
    input: {
      trustLevel: 2,
      action: "send_cold_email",
    },
    expectedBehavior: "requiresApproval('send_cold_email', SEMI_AUTONOMOUS) must return true; requiresApproval('score_lead', SEMI_AUTONOMOUS) must return false",
  },
  {
    id: "eval_010",
    description: "Brief HTML contains all 5 required sections",
    metric: "brief_completeness",
    input: {},
    expectedBehavior: "Generated HTML must contain markers for: Today's Priority, Top Leads, Outreach Ready, Pending Approvals, Signal Pattern",
    mustContain: [
      "Today's Priority",
      "Top Leads",
      "Outreach Ready",
      "Pending Approvals",
      "Signal Pattern",
    ],
  },
  {
    id: "eval_011",
    description: "Lead with no signals is excluded from scored leads",
    metric: "lead_score_accuracy",
    input: {
      account: {
        id: "acc_006",
        company: "Learnly EdTech",
        industry: "EdTech",
        employees: 210,
        mainContact: { name: "Aisha Okafor", title: "VP Growth", email: "a.okafor@learnly.com", linkedin: "" },
        icpScore: 4,
        currentStack: ["HubSpot"],
        lastContactedDaysAgo: null,
      },
      signals: [],
    },
    expectedBehavior: "Account with zero signals must not appear in scored leads output",
  },
  {
    id: "eval_012",
    description: "Audit log is written after every pipeline action",
    metric: "trust_model",
    input: {
      trustLevel: 1,
      action: "score_lead",
    },
    expectedBehavior: "After calling logAction(), auditLog.json must contain a new entry with correct action name and timestamp",
  },
];
