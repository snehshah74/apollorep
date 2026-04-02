// Assembles the daily intelligence brief combining AI narrative with structured lead data.
// Fourth pipeline stage — the deliverable the rep actually reads every morning.
// Gemini writes the narrative prose; we control the HTML structure for email compatibility.

import { callGemini } from "../lib/gemini";
import { ScoredLead } from "./leadScorer";
import { Draft } from "./outreachDrafter";
import { getTrustLevel, getTrustLevelDescription } from "../trust/trustModel";

interface BriefNarrative {
  priorityOpening: string;
  leadInsights: string[];
  patternOfDay: string;
}

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

const SYSTEM_PROMPT = `You are writing a daily intelligence brief for a B2B sales rep. Tone: sharp, direct, no fluff. Like a smart chief of staff briefing an executive. Write the narrative sections only — the data will be inserted programmatically. Write: (1) a 2-sentence 'Today's Priority' opening that tells the rep exactly where to focus and why, (2) a one-line insight for each top lead explaining the opportunity (return as array, one string per lead), (3) a 'Pattern of the Day' observation across all signals seen today. Return JSON with fields: priorityOpening (string), leadInsights (array of strings matching lead order), patternOfDay (string).`;

function getRecommendedActionLabel(action: string): string {
  const labels: Record<string, string> = {
    immediate_outreach: "🔥 Immediate Outreach",
    add_to_sequence: "📋 Add to Sequence",
    monitor: "👁 Monitor",
    deprioritize: "⬇ Deprioritize",
  };
  return labels[action] || action;
}

function getSignalTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    funding_round: "💰 Funding Round",
    job_posting: "📢 Job Posting",
    leadership_change: "👤 Leadership Change",
    competitor_churn: "🔄 Competitor Churn",
    tech_stack_change: "🔧 Tech Stack Change",
    intent_data: "📊 Intent Data",
  };
  return labels[type] || type;
}

function buildHtml(
  leads: ScoredLead[],
  drafts: Draft[],
  pendingCount: number,
  narrative: BriefNarrative,
  trustLevel: number,
  trustDesc: string
): string {
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const trustBadgeColor =
    trustLevel === 1 ? "#e67e22" : trustLevel === 2 ? "#2980b9" : "#27ae60";
  const trustLabel =
    trustLevel === 1 ? "Supervised" : trustLevel === 2 ? "Semi-Autonomous" : "Autonomous";

  const leadsTableRows = leads
    .map(
      (lead, i) => `
      <tr style="border-bottom: 1px solid #eee;">
        <td style="padding: 12px 8px; font-weight: bold; color: #1a1a2e;">#${i + 1}</td>
        <td style="padding: 12px 8px; font-weight: bold;">${lead.company}</td>
        <td style="padding: 12px 8px;">
          <span style="background: #e94560; color: white; padding: 3px 10px; border-radius: 12px; font-size: 13px; font-weight: bold;">${lead.totalScore}</span>
        </td>
        <td style="padding: 12px 8px; font-size: 13px; color: #555;">${getSignalTypeLabel(lead.topSignal.type)}</td>
        <td style="padding: 12px 8px; font-size: 13px;">${getRecommendedActionLabel(lead.recommendedAction)}</td>
        <td style="padding: 12px 8px; font-size: 13px; color: #333; font-style: italic;">${narrative.leadInsights[i] || "—"}</td>
      </tr>`
    )
    .join("");

  const outreachCards = drafts
    .map((draft) => {
      const bodyPreview = draft.body.split(" ").slice(0, 20).join(" ") + "...";
      const confidenceWidth = draft.confidence * 10;
      const confidenceColor =
        draft.confidence >= 8 ? "#27ae60" : draft.confidence >= 6 ? "#f39c12" : "#e74c3c";
      return `
      <div style="border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; margin-bottom: 12px; background: #fafafa;">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
          <span style="font-weight: bold; font-size: 15px; color: #1a1a2e;">${draft.companyName}</span>
          <span style="font-size: 12px; color: #777;">${draft.wordCount} words</span>
        </div>
        <div style="font-size: 14px; color: #333; margin-bottom: 6px;"><strong>Subject:</strong> ${draft.subject}</div>
        <div style="font-size: 13px; color: #555; margin-bottom: 10px;">${bodyPreview}</div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 12px; color: #777;">Confidence:</span>
          <div style="background: #e0e0e0; border-radius: 4px; height: 6px; width: 100px; overflow: hidden;">
            <div style="background: ${confidenceColor}; height: 6px; width: ${confidenceWidth}%;"></div>
          </div>
          <span style="font-size: 12px; color: ${confidenceColor}; font-weight: bold;">${draft.confidence}/10</span>
        </div>
      </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>ApolloRep Daily Brief</title></head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f4f7;">
  <div style="max-width: 700px; margin: 0 auto; background: white;">

    <!-- Header -->
    <div style="background: #1a1a2e; padding: 28px 32px; display: flex; justify-content: space-between; align-items: center;">
      <div>
        <div style="color: white; font-size: 22px; font-weight: bold; letter-spacing: 0.5px;">ApolloRep Daily Brief</div>
        <div style="color: #aab; font-size: 13px; margin-top: 4px;">${today}</div>
      </div>
      <div style="background: ${trustBadgeColor}; color: white; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px;">
        ${trustLabel}
      </div>
    </div>

    <!-- Section 1: Today's Priority -->
    <div style="padding: 28px 32px; border-bottom: 2px solid #f0f0f0;">
      <div style="font-size: 11px; font-weight: bold; color: #e94560; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">Today's Priority</div>
      <div style="font-size: 16px; line-height: 1.6; color: #1a1a2e;">${narrative.priorityOpening}</div>
    </div>

    <!-- Section 2: Top Leads -->
    <div style="padding: 28px 32px; border-bottom: 2px solid #f0f0f0;">
      <div style="font-size: 11px; font-weight: bold; color: #e94560; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px;">Top Leads</div>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr style="background: #f7f7f9; border-bottom: 2px solid #e0e0e0;">
            <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: #777; font-weight: 600;">#</th>
            <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: #777; font-weight: 600;">Company</th>
            <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: #777; font-weight: 600;">Score</th>
            <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: #777; font-weight: 600;">Top Signal</th>
            <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: #777; font-weight: 600;">Action</th>
            <th style="padding: 10px 8px; text-align: left; font-size: 12px; color: #777; font-weight: 600;">Insight</th>
          </tr>
        </thead>
        <tbody>
          ${leadsTableRows}
        </tbody>
      </table>
    </div>

    <!-- Section 3: Outreach Ready -->
    <div style="padding: 28px 32px; border-bottom: 2px solid #f0f0f0;">
      <div style="font-size: 11px; font-weight: bold; color: #e94560; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 16px;">Outreach Ready (${drafts.length})</div>
      ${outreachCards || '<div style="color: #999; font-size: 14px;">No drafts generated this run.</div>'}
    </div>

    <!-- Section 4: Pending Approvals -->
    <div style="padding: 28px 32px; border-bottom: 2px solid #f0f0f0; background: #fffaf0;">
      <div style="font-size: 11px; font-weight: bold; color: #e94560; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;">Pending Approvals</div>
      <div style="display: flex; align-items: center; gap: 12px;">
        <span style="background: #e94560; color: white; font-size: 22px; font-weight: bold; padding: 8px 16px; border-radius: 8px;">${pendingCount}</span>
        <div>
          <div style="font-size: 14px; color: #333;">actions waiting for your review</div>
          <a href="http://localhost:${process.env.PORT || 3000}" style="color: #e94560; font-size: 13px; text-decoration: none; font-weight: 600;">→ Open Approval Center</a>
        </div>
      </div>
    </div>

    <!-- Section 5: Signal Pattern -->
    <div style="padding: 28px 32px; border-bottom: 2px solid #f0f0f0;">
      <div style="font-size: 11px; font-weight: bold; color: #e94560; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 10px;">Signal Pattern of the Day</div>
      <div style="font-size: 14px; line-height: 1.7; color: #333; background: #f7f7f9; padding: 16px; border-left: 4px solid #16213e; border-radius: 0 8px 8px 0;">
        ${narrative.patternOfDay}
      </div>
    </div>

    <!-- Footer -->
    <div style="background: #1a1a2e; padding: 20px 32px; text-align: center;">
      <div style="color: #667; font-size: 12px;">Powered by ApolloRep &nbsp;|&nbsp; Trust Level: ${trustLevel} — ${trustDesc}</div>
      <div style="color: #445; font-size: 11px; margin-top: 4px;">Gemini 1.5 Flash &nbsp;|&nbsp; ${new Date().toISOString()}</div>
    </div>

  </div>
</body>
</html>`;
}

export async function composeDailyBrief(
  leads: ScoredLead[],
  drafts: Draft[],
  pendingCount: number
): Promise<string> {
  console.log(
    `[${timestamp()}] [BriefComposer] Composing daily brief for ${leads.length} leads, ${drafts.length} drafts`
  );

  const briefingData = {
    leads: leads.map((l) => ({
      company: l.company,
      score: l.totalScore,
      topSignal: l.topSignal.aiSummary,
      signalType: l.topSignal.type,
      urgency: l.topSignal.urgency,
      recommendedAction: l.recommendedAction,
      rationale: l.scoringRationale,
      signalCount: l.allSignals.length,
    })),
    draftsReady: drafts.length,
    pendingApprovals: pendingCount,
    totalSignalsToday: leads.reduce((sum, l) => sum + l.allSignals.length, 0),
  };

  const rawResponse = await callGemini(SYSTEM_PROMPT, JSON.stringify(briefingData), true);

  let narrative: BriefNarrative = {
    priorityOpening:
      leads.length > 0
        ? `Focus on ${leads[0].company} today — they show the strongest buying intent with ${leads[0].allSignals.length} active signal(s) and a score of ${leads[0].totalScore}/100. Their ${leads[0].topSignal.type} signal suggests a ${leads[0].topSignal.buyingStageGuess} buying stage requiring immediate attention.`
        : "No high-priority leads detected today. Monitor your target accounts for new signals.",
    leadInsights: leads.map(
      (l) => `Signal: ${l.topSignal.type} | Urgency: ${l.topSignal.urgency}`
    ),
    patternOfDay: "Multiple accounts showing concurrent job postings and funding events — a common pattern before a sales tech stack evaluation cycle begins.",
  };

  if (rawResponse) {
    try {
      const parsed = JSON.parse(rawResponse);
      narrative.priorityOpening = parsed.priorityOpening || narrative.priorityOpening;
      narrative.leadInsights =
        Array.isArray(parsed.leadInsights) && parsed.leadInsights.length > 0
          ? parsed.leadInsights
          : narrative.leadInsights;
      narrative.patternOfDay = parsed.patternOfDay || narrative.patternOfDay;
    } catch (parseError) {
      console.error(
        `[${timestamp()}] [BriefComposer] Failed to parse narrative from Gemini, using fallback. Raw: ${rawResponse.slice(0, 200)}`
      );
    }
  }

  const trustLevel = getTrustLevel();
  const trustDesc = getTrustLevelDescription(trustLevel);
  const html = buildHtml(leads, drafts, pendingCount, narrative, trustLevel, trustDesc);

  console.log(`[${timestamp()}] [BriefComposer] Brief composed | ${html.length} chars`);
  return html;
}
