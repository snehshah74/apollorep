// Drafts personalized cold outreach emails grounded in specific buying signals.
// Third pipeline stage — converts scored leads into actionable, send-ready email copy.
// Quality bar: every draft must feel human, reference a real signal, and stay under 75 words.

import { callGemini } from "../lib/gemini";
import { ScoredLead } from "./leadScorer";

export interface Draft {
  id: string;
  accountId: string;
  companyName: string;
  contactEmail: string;
  contactName: string;
  subject: string;
  body: string;
  htmlBody: string;
  triggerSignal: string;
  confidence: number;
  wordCount: number;
  generatedAt: string;
}

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
}

const SYSTEM_PROMPT = `You are a world-class B2B sales copywriter who has closed enterprise deals. Your emails get replies because they prove you did real homework — not because they follow a template.

STRICT RULES:
- Open with the EXACT signal detail (dollar amount, role title, specific technology named) — not a vague reference to it
- Body must be under 60 words
- One sentence CTA only — make it dead simple to say yes
- Write like a peer talking to a peer, not a vendor pitching

BANNED PHRASES (instant fail if any appear):
- "I hope this finds you well"
- "I wanted to reach out"
- "touching base"
- "noticed the recent developments"
- "given where you are headed"
- "worth exploring"
- "synergy"
- "leverage"
- "circle back"
- "quick question"
- "just following up"

GOOD EXAMPLE (funding signal):
Subject: The $22M round + doubling sales headcount
Body: Sarah — congrats on the Series B. Companies that double sales headcount in 90 days usually hit a wall around month 4 when the tooling can't keep up with rep volume. Apollo solves exactly that. 15 minutes this week?

BAD EXAMPLE (do not write like this):
Subject: Quick thought on your growth trajectory
Body: Sarah — noticed the recent developments at your company. Given where you are headed there might be a fit worth exploring. Would a 15-minute call work?

Return JSON only: { subject, body, htmlBody (use <p> tags, bold the CTA line with <strong>), confidence (1-10), triggerSignal (one sentence) }`;

export async function draftOutreach(lead: ScoredLead): Promise<Draft> {
  const signal = lead.topSignal;

  // Build signal-specific details to force hyper-personalized output
  let signalDetail = signal.summary;
  const extraContext: string[] = [];

  if (signal.type === "funding_round") {
    const dollarMatch = signal.summary.match(/\$[\d.]+[MB]/i);
    if (dollarMatch) extraContext.push(`Exact funding amount: ${dollarMatch[0]}`);
    const roundMatch = signal.summary.match(/Series [A-Z]|Seed|Pre-Seed/i);
    if (roundMatch) extraContext.push(`Round type: ${roundMatch[0]}`);
  } else if (signal.type === "job_posting") {
    const titleMatch = signal.summary.match(/"([^"]+)"|'([^']+)'|hiring a? ?([A-Z][a-zA-Z ]+(?:Manager|Director|VP|Lead|Analyst|Engineer|Representative))/);
    if (titleMatch) extraContext.push(`Specific role being hired: ${titleMatch[0]}`);
  } else if (signal.type === "tech_stack_change") {
    const toolMatch = signal.summary.match(/(?:adopted|added|removed|dropped|switched to) ([A-Z][a-zA-Z]+)/i);
    if (toolMatch) extraContext.push(`Specific tool change: ${toolMatch[0]}`);
  } else if (signal.type === "competitor_churn") {
    const competitorMatch = signal.summary.match(/(Outreach|Salesloft|HubSpot|Salesforce|Apollo|Gong|ZoomInfo|Marketo)/i);
    if (competitorMatch) extraContext.push(`Competitor being churned: ${competitorMatch[0]}`);
  } else if (signal.type === "leadership_change") {
    const nameMatch = signal.summary.match(/hired ([A-Z][a-z]+ [A-Z][a-z]+)/);
    if (nameMatch) extraContext.push(`New hire name: ${nameMatch[1]}`);
  }

  const context = `
Contact name: ${lead.contact.name}
Contact title: ${lead.contact.title}
Company: ${lead.company}
Signal type: ${signal.type}
EXACT signal text (use specific details from this): ${signalDetail}
${extraContext.length > 0 ? "Key specifics to reference:\n" + extraContext.map(e => "- " + e).join("\n") : ""}
Current tech stack: ${lead.allSignals[0] ? lead.allSignals.map(s => s.type).join(", ") : "unknown"}
Buying stage: ${signal.buyingStageGuess}
Urgency: ${signal.urgency}
Scoring rationale: ${lead.scoringRationale}
  `.trim();

  const rawResponse = await callGemini(SYSTEM_PROMPT, context, true);

  let subject = "";
  let body = "";
  let htmlBody = "";
  let confidence = 7;
  let triggerSignal = lead.topSignal.aiSummary;

  if (rawResponse) {
    try {
      const parsed = JSON.parse(rawResponse);
      subject = parsed.subject || "";
      body = parsed.body || "";
      htmlBody = parsed.htmlBody || `<p>${body}</p>`;
      confidence = typeof parsed.confidence === "number" ? parsed.confidence : 7;
      triggerSignal = parsed.triggerSignal || lead.topSignal.aiSummary;
    } catch (parseError) {
      console.error(
        `[${timestamp()}] [OutreachDrafter] Failed to parse Gemini response for ${lead.company}. Raw: ${rawResponse.slice(0, 200)}`
      );
      // Fallback draft
      subject = `Quick thought on ${lead.company}'s growth trajectory`;
      body = `${lead.contact.name} — noticed the recent developments at ${lead.company}. Given the direction you're heading, thought there might be a fit worth a quick conversation. Would a 15-minute call this week make sense?`;
      htmlBody = `<p>${body}</p>`;
    }
  } else {
    subject = `Quick thought on ${lead.company}'s growth trajectory`;
    body = `${lead.contact.name} — noticed the recent developments at ${lead.company}. Given where you're headed, there might be a fit worth exploring. Would a 15-minute call this week work?`;
    htmlBody = `<p>${body}</p>`;
  }

  const wc = countWords(body);
  const draftId = `draft_${lead.accountId}_${Date.now()}`;

  const draft: Draft = {
    id: draftId,
    accountId: lead.accountId,
    companyName: lead.company,
    contactEmail: lead.contact.email,
    contactName: lead.contact.name,
    subject,
    body,
    htmlBody,
    triggerSignal,
    confidence,
    wordCount: wc,
    generatedAt: new Date().toISOString(),
  };

  console.log(
    `[${timestamp()}] [OutreachDrafter] Draft for ${lead.company}: "${subject}" (confidence: ${confidence}/10, ${wc} words)`
  );

  return draft;
}
