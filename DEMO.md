# ApolloRep — Interview Demo Script

Total runtime: ~10 minutes. Keep a terminal and browser tab open side by side.

---

## Pre-demo checklist

- [ ] `.env` filled in with real `GEMINI_API_KEY` and `RESEND_API_KEY`
- [ ] `npm install` completed
- [ ] `TRUST_LEVEL=1` in `.env`
- [ ] `approvalQueue.json` and `auditLog.json` reset to `[]`
- [ ] Browser tab open at `http://localhost:3000` (after `npm start`)

---

## Scene 1 — Pipeline Run (2 minutes)

**Run:**
```bash
npm start
```

**What to say as it starts:**
> "This is ApolloRep — a lightweight autonomous GTM agent. It monitors 10 target accounts, detects buying signals, scores and prioritizes leads, drafts personalized outreach, and delivers a daily brief. Let me walk you through what's happening in real time."

**As signals load:**
> "The Signal Monitor is scanning each account. Notice it's making one batched Gemini call for all signals — not one per account. That's a deliberate rate limiting choice to stay within the free tier, but it also mirrors how you'd want to batch in production to minimize latency."

**The key insight to call out:**
> "Notice it detected 3 signals for Meridian Analytics — a Series B, new VP of Sales hired from Outreach, and 4 open sales roles. That multi-signal clustering is what the scorer weights most heavily. That's a product decision, not just a math decision. A single intent signal is noise. Three concurrent signals pointing at the same purchase window — that's a buying committee forming."

**As leads are scored:**
> "The scorer returns a 100-point breakdown: ICP fit, signal strength, signal count bonus, and recency. The breakdown is surfaced to the rep — not just the number — because trust in an AI system comes from interpretability."

**As outreach is drafted:**
> "Three drafts generated. Each one is under 75 words, references the specific signal that triggered it, and avoids the standard SDR clichés. I actually run an eval against all of these — which I'll show you in Scene 4."

---

## Scene 2 — Trust Model Demo (3 minutes)

**With `TRUST_LEVEL=1` (default), point to the terminal output:**
> "Every action that touches the outside world — sending an email, booking a meeting — gets routed to the approval queue. The agent earns the right to act. It doesn't start autonomous — it starts supervised and graduates based on rep comfort."

**Open `http://localhost:3000` in browser:**
> "Here's what the rep sees. Three cold email drafts and the daily brief are waiting for approval. Risk badges, the specific signal that triggered each draft, confidence score. One click to approve, with an inline rejection flow if the rep wants to push back with notes."

**Switch to `TRUST_LEVEL=2`:**
```bash
# Edit .env: TRUST_LEVEL=2
# Reset queue: echo '[]' > src/data/approvalQueue.json
npm start pipeline
```
> "Level 2 — Semi-Autonomous. The daily brief now sends automatically to the rep. But cold emails — direct contact with prospects — still need approval. The logic: low-risk actions that only touch internal systems run automatically; actions that put words in the company's mouth require a human signature."

**Switch to `TRUST_LEVEL=3`:**
```bash
# Edit .env: TRUST_LEVEL=3
# Reset queue: echo '[]' > src/data/approvalQueue.json
npm start pipeline
```
> "Level 3 — Fully Autonomous. Everything runs. No queue. The audit trail is still written for every action — you always have a complete record of what the agent did and why, even if no human was in the loop."

---

## Scene 3 — Approval UI Walkthrough (2 minutes)

*Return to `TRUST_LEVEL=1`, reset and re-run pipeline to repopulate the queue.*

**In the browser, walk through a pending card:**
> "Each card shows you the risk level, who the email is going to, and the specific signal that triggered the draft. You can expand the preview to read the full email before approving. If you reject, you add notes — those notes go into the audit trail and are visible in the All Actions tab."

**Click 'All Actions' tab:**
> "This is the full history — every action the agent took or proposed, with status and rep notes. This is your audit trail. If a compliance team ever asks 'did the agent send an email to this prospect?', the answer is here."

**Click approve on one card:**
> "That just triggered a real API call to Resend. The email is sending now. Watch the card fade out — the UI clears it immediately without a page reload."

---

## Scene 4 — Eval Results (2 minutes)

```bash
npm run eval
```

**As it runs:**
> "Eval infrastructure is a product problem, not just an engineering one. If I can't measure whether the agent is doing good work, I can't ship it with confidence, I can't catch regressions, and I can't improve it systematically."

**Walk through the output:**
> "12 test cases across 5 dimensions. Three of them — the outreach quality tests — use Gemini as a judge. The model scores each draft on personalization, brevity, tone, and CTA quality. The trust model tests are deterministic — they call `requiresApproval()` directly and check the boolean. And the brief completeness test parses the HTML and verifies all five required sections are present."

**Key talking point:**
> "The eval framework is the foundation you build before you scale. Every time I change a prompt or add a new signal type, I run evals. If pass rate drops, I don't ship. That's the product discipline that makes agentic systems trustworthy — not the model, not the prompts alone. The measurement layer."

---

## Scene 5 — What's Next (1 minute)

> "Four natural extensions I'd prioritize for a real product:
>
> First — real signal ingestion. Right now signals are JSON. In production you'd hook into Bombora for intent data, Crunchbase webhooks for funding events, and G2 review monitoring for competitor churn signals.
>
> Second — Slack delivery alongside email. Mobile-first reps don't live in their inbox.
>
> Third — a rep feedback loop. Every approval or rejection is a training signal. Thumbs up on a draft, the system learns what 'good' looks like for that rep. Thumbs down with notes, it adjusts. Over time the agent personalizes to each rep's voice and standards.
>
> Fourth — trust escalation. The system starts at Level 1. After 20 consecutive approvals with no edits, it automatically proposes moving to Level 2 — and the rep decides. The agent earns autonomy through demonstrated alignment. That's the right model for any AI system that acts on behalf of humans."

---

*Questions? The code is all here — every design decision is either in the comments or in the DEMO.*
