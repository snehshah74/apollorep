# ApolloRep — Autonomous GTM Agent Prototype

ApolloRep is a lightweight autonomous sales agent that monitors buying signals across a target account list, scores and prioritizes leads, drafts personalized outreach, and delivers a daily intelligence brief to the rep — all while enforcing a progressive trust model that requires human approval before any external action is taken. It was built as a portfolio project to demonstrate product thinking around agentic orchestration, multi-step AI pipelines, and the core tension in autonomous systems: how much should an agent do on its own, and when should it stop and ask?

---

## Architecture

```
accounts.json ──► Signal Monitor ──► Lead Scorer ──► Outreach Drafter
                       │                                     │
                       │                                     ▼
                       │                             Trust Model Decision
                       │                            /                   \
                       │                     Needs Approval          Autonomous
                       │                           │                     │
                       │                    Approval Queue         Send Email
                       │                           │                     │
                       ▼                           ▼                     ▼
              (intraday check)            Brief Composer ◄───────────────┘
                                                  │
                                          Trust Model Decision
                                         /                   \
                                  Needs Approval          Autonomous
                                        │                     │
                                 Approval Queue         Send Brief
                                        │
                                 Audit Log (all paths)
```

---

## Quick Start

### Prerequisites
- Node.js 18+
- Free Gemini API key: [aistudio.google.com](https://aistudio.google.com) → Get API Key (60 seconds, no credit card)
- Free Resend API key: [resend.com](https://resend.com) → Sign up → API Keys (3,000 emails/month free)

### Setup

```bash
# 1. Clone and install
cd apollorep
npm install

# 2. Configure environment
cp .env.example .env
# Open .env and fill in:
#   GEMINI_API_KEY=your_key_here
#   RESEND_API_KEY=your_key_here
#   REP_EMAIL=your@email.com
#   FROM_EMAIL=apollorep@yourdomain.com   # must be verified in Resend

# 3. Run (demo mode: pipeline + approval UI)
npm start
```

### Expected output

```
╔═══════════════════════════════════════════════════╗
║                  ApolloRep v1.0                   ║
║         Autonomous GTM Agent Prototype            ║
╠═══════════════════════════════════════════════════╣
║ Mode:         demo                                ║
║ Trust Level:  1 — All actions require approval    ║
║ Monitoring:   10 accounts                         ║
║ LLM:          Gemini 1.5 Flash (free tier)        ║
╚═══════════════════════════════════════════════════╝

[07:31:02] [Orchestrator] Pipeline run started | runId: run_...
[07:31:02] [WebSearch] Signal search for acc_001: found 3 signals
[07:31:02] [Gemini] Calling model | prompt: "[{id: sig_001..."
[07:31:05] [LeadScorer] Meridian Analytics: 91/100 — immediate_outreach
[07:31:05] [LeadScorer] ShieldLayer Security: 84/100 — immediate_outreach
[07:31:08] [OutreachDrafter] Draft for Meridian Analytics: "Following your Series B" (confidence: 9/10, 62 words)
[07:31:10] [ApprovalQueue] Added to queue | action: send_cold_email | company: Meridian Analytics
...
Pipeline complete. Approval UI running at http://localhost:3000
```

Open `http://localhost:3000` to review and approve pending actions.

---

## Run Modes

```bash
npm start              # demo: pipeline + approval server (default)
npm start pipeline     # run pipeline once, exit
npm start heartbeat    # start cron scheduler (7:30 AM daily + 2h intraday)
npm start server       # approval server only
npm run eval           # run eval suite
```

---

## Trust Levels

Control how autonomously the agent acts by setting `TRUST_LEVEL` in `.env`.

| Level | Name | score_lead | send_daily_brief | send_cold_email |
|-------|------|-----------|-----------------|-----------------|
| 1 | **Supervised** | Auto | Requires approval | Requires approval |
| 2 | **Semi-Autonomous** | Auto | Auto | Requires approval |
| 3 | **Autonomous** | Auto | Auto | Auto |

Change levels and re-run to see the agent's behavior shift in real time.

---

## Eval Infrastructure

```bash
npm run eval
```

Runs 12 test cases covering:
- **outreach_quality** (3 tests): Does the email reference a real signal? Is it under 75 words? Does it avoid banned phrases?
- **lead_score_accuracy** (4 tests): Does signal count affect scores correctly? Does ICP fit weight properly? Are no-signal accounts excluded?
- **signal_relevance** (1 test): Does funding round outrank intent data?
- **trust_model** (3 tests): Does each trust level correctly gate the right actions?
- **brief_completeness** (1 test): Does the HTML contain all 5 required sections?

**Why eval is a product concern, not just engineering:** If you can't measure whether the agent is doing good work, you can't ship it with confidence, you can't debug regressions, and you can't improve it systematically. Eval infrastructure is the foundation you build before scale — not after.

---

## Simulated vs Production-Ready

| Component | This Prototype | Production Version |
|-----------|---------------|-------------------|
| Signal data | Local JSON | Bombora intent API, Apollo signals, Crunchbase webhooks, LinkedIn alerts |
| CRM data | Local JSON | Salesforce REST API or HubSpot CRM API |
| Trust model logic | ✅ Production-ready | Same code, add DB persistence for trust history |
| Approval queue | ✅ Production-ready | Same logic, swap JSON → Postgres or Redis |
| Audit trail | ✅ Production-ready | Add structured logging (Datadog, CloudWatch) |
| Email delivery | ✅ Production-ready via Resend | Same API, add reply tracking, bounce handling |
| Eval framework | ✅ Production-ready | Add CI integration, regression alerts, score dashboards |
| Scheduling | node-cron (single process) | Production: Temporal, Inngest, or AWS EventBridge |

---

## Extension Ideas

- **Slack delivery**: Route daily brief to rep's Slack DM for mobile-first workflow
- **Webhook signal ingestion**: Real-time signal capture from Crunchbase, LinkedIn, G2
- **Rep feedback loop**: Thumbs up/down on outreach drafts trains a reward signal over time
- **Multi-rep support**: Partition accounts by rep, shared signal intelligence layer
- **CRM write-back**: On approval, write activity and next steps back to Salesforce opportunity
- **A/B outreach variants**: Draft 2 versions, auto-send the winner after rep picks one
- **Trust escalation**: Auto-promote trust level after N consecutive approvals with no edits
