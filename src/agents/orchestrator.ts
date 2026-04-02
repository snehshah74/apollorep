// Master controller that runs the full GTM agent pipeline in sequence.
// Wires together all agents and enforces trust model decisions at every action boundary.
// Also hosts the heartbeat scheduler for automated daily and intraday runs.

import * as cron from "node-cron";
import * as dotenv from "dotenv";

import { loadAllAccounts } from "../tools/crmLookup";
import { monitorSignals } from "./signalMonitor";
import { scoreLeads } from "./leadScorer";
import { draftOutreach } from "./outreachDrafter";
import { composeDailyBrief } from "./briefComposer";
import { sendEmail } from "../tools/emailSender";
import {
  getTrustLevel,
  requiresApproval,
  logAction,
} from "../trust/trustModel";
import {
  addToQueue,
  getPending,
} from "../trust/approvalQueue";

dotenv.config();

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8);
}

function generateRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export interface PipelineRun {
  runId: string;
  startedAt: string;
  completedAt: string;
  accountsMonitored: number;
  signalsDetected: number;
  leadsScored: number;
  draftsCreated: number;
  actionsQueued: number;
  actionsSentAutomatically: number;
  errors: string[];
}

export async function runPipeline(): Promise<PipelineRun> {
  const runId = generateRunId();
  const startedAt = new Date().toISOString();
  const errors: string[] = [];

  console.log(`\n[${timestamp()}] [Orchestrator] ${"=".repeat(58)}`);
  console.log(`[${timestamp()}] [Orchestrator] Pipeline run started | runId: ${runId}`);
  console.log(`[${timestamp()}] [Orchestrator] ${"=".repeat(58)}\n`);

  const trustLevel = getTrustLevel();
  let actionsQueued = 0;
  let actionsSentAutomatically = 0;

  // Step 1: Load accounts
  const accounts = await loadAllAccounts();
  console.log(`[${timestamp()}] [Orchestrator] Step 1: Loaded ${accounts.length} accounts`);

  // Step 2: Monitor signals
  const signalStart = Date.now();
  const signalMap = await monitorSignals(accounts);
  const signalsDetected = Array.from(signalMap.values()).reduce(
    (sum, sigs) => sum + sigs.length,
    0
  );
  console.log(
    `[${timestamp()}] [Orchestrator] Step 2: Signal monitoring done in ${Date.now() - signalStart}ms | ${signalsDetected} signals detected`
  );

  // Step 3: Score leads
  const scoreStart = Date.now();
  const scoredLeads = await scoreLeads(signalMap, accounts);
  console.log(
    `[${timestamp()}] [Orchestrator] Step 3: Lead scoring done in ${Date.now() - scoreStart}ms | ${scoredLeads.length} leads scored`
  );

  // Step 4: Draft outreach for top 3 leads
  const top3 = scoredLeads.slice(0, 3);
  const drafts = [];

  for (const lead of top3) {
    try {
      const draft = await draftOutreach(lead);
      drafts.push(draft);

      // Trust model decision: send cold email
      if (requiresApproval("send_cold_email", trustLevel)) {
        const actionId = await addToQueue(
          "send_cold_email",
          lead.accountId,
          lead.company,
          {
            contactEmail: draft.contactEmail,
            contactName: draft.contactName,
            subject: draft.subject,
            body: draft.body,
            htmlBody: draft.htmlBody,
            triggerSignal: draft.triggerSignal,
            confidence: draft.confidence,
          },
          `Send cold email to ${draft.contactName} at ${lead.company} | Subject: "${draft.subject}"`
        );
        actionsQueued++;
        await logAction(
          "send_cold_email",
          trustLevel,
          false,
          { actionId, company: lead.company },
          "Queued for approval"
        );
        console.log(
          `[${timestamp()}] [Orchestrator] Draft queued for approval | ${lead.company} | actionId: ${actionId}`
        );
      } else {
        // Autonomous: send directly
        const sent = await sendEmail(
          draft.contactEmail,
          draft.subject,
          draft.htmlBody,
          draft.id
        );
        actionsSentAutomatically++;
        await logAction(
          "send_cold_email",
          trustLevel,
          true,
          { company: lead.company, email: draft.contactEmail },
          sent ? "Email sent successfully" : "Email send failed"
        );
      }
    } catch (err) {
      const msg = `Failed to draft/queue outreach for ${lead.company}: ${err}`;
      console.error(`[${timestamp()}] [Orchestrator] ${msg}`);
      errors.push(msg);
    }
  }

  // Step 5: Get pending count
  const pending = await getPending();
  const pendingCount = pending.length;

  // Step 6: Compose daily brief
  let briefHtml = "";
  try {
    briefHtml = await composeDailyBrief(scoredLeads, drafts, pendingCount);

    // Trust model decision: send daily brief
    if (requiresApproval("send_daily_brief", trustLevel)) {
      const briefActionId = await addToQueue(
        "send_daily_brief",
        "system",
        "Daily Brief",
        {
          briefHtml,
          leadCount: scoredLeads.length,
          draftCount: drafts.length,
        },
        `Send daily brief to rep (${scoredLeads.length} leads, ${drafts.length} drafts ready)`
      );
      actionsQueued++;
      await logAction(
        "send_daily_brief",
        trustLevel,
        false,
        { briefActionId },
        "Brief queued for approval"
      );
      console.log(
        `[${timestamp()}] [Orchestrator] Daily brief queued for approval | actionId: ${briefActionId}`
      );
    } else {
      const repEmail = process.env.REP_EMAIL || "rep@yourcompany.com";
      const sent = await sendEmail(
        repEmail,
        `ApolloRep Daily Brief — ${new Date().toLocaleDateString()}`,
        briefHtml,
        `brief_${runId}`
      );
      actionsSentAutomatically++;
      await logAction(
        "send_daily_brief",
        trustLevel,
        true,
        { repEmail },
        sent ? "Brief sent successfully" : "Brief send failed"
      );
    }
  } catch (err) {
    const msg = `Failed to compose/send daily brief: ${err}`;
    console.error(`[${timestamp()}] [Orchestrator] ${msg}`);
    errors.push(msg);
  }

  const completedAt = new Date().toISOString();
  const durationMs =
    new Date(completedAt).getTime() - new Date(startedAt).getTime();

  const run: PipelineRun = {
    runId,
    startedAt,
    completedAt,
    accountsMonitored: accounts.length,
    signalsDetected,
    leadsScored: scoredLeads.length,
    draftsCreated: drafts.length,
    actionsQueued,
    actionsSentAutomatically,
    errors,
  };

  console.log(`\n[${timestamp()}] [Orchestrator] ${"=".repeat(58)}`);
  console.log(`[${timestamp()}] [Orchestrator] Pipeline complete in ${durationMs}ms`);
  console.log(`[${timestamp()}] [Orchestrator]   Accounts monitored:      ${run.accountsMonitored}`);
  console.log(`[${timestamp()}] [Orchestrator]   Signals detected:        ${run.signalsDetected}`);
  console.log(`[${timestamp()}] [Orchestrator]   Leads scored:            ${run.leadsScored}`);
  console.log(`[${timestamp()}] [Orchestrator]   Drafts created:          ${run.draftsCreated}`);
  console.log(`[${timestamp()}] [Orchestrator]   Actions queued:          ${run.actionsQueued}`);
  console.log(`[${timestamp()}] [Orchestrator]   Actions sent auto:       ${run.actionsSentAutomatically}`);
  console.log(`[${timestamp()}] [Orchestrator]   Errors:                  ${run.errors.length}`);
  console.log(`[${timestamp()}] [Orchestrator] ${"=".repeat(58)}\n`);

  return run;
}

export function startHeartbeat(): void {
  console.log(`[${timestamp()}] [Orchestrator] Starting heartbeat scheduler`);

  // Full pipeline at 7:30 AM weekdays
  cron.schedule("30 7 * * 1-5", async () => {
    console.log(`[${timestamp()}] [Orchestrator] Heartbeat: Full pipeline run triggered`);
    await runPipeline();
  });

  // Signal-only check every 2 hours, 9am-5pm weekdays
  cron.schedule("0 9-17/2 * * 1-5", async () => {
    console.log(
      `[${timestamp()}] [Orchestrator] Heartbeat: Intraday signal check triggered`
    );
    const accounts = await loadAllAccounts();
    const signalMap = await monitorSignals(accounts);
    const count = Array.from(signalMap.values()).reduce(
      (sum, sigs) => sum + sigs.length,
      0
    );
    console.log(
      `[${timestamp()}] [Orchestrator] Intraday check: ${count} signals across ${signalMap.size} accounts`
    );
  });

  console.log(`[${timestamp()}] [Orchestrator] Heartbeat active — full run at 7:30 AM weekdays, signal check every 2h (9am-5pm weekdays)`);
}
